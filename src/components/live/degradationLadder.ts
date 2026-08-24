/**
 * The dynamic view degradation ladder (FR-O010 / ART-127).
 *
 * ## What was already here, and what was actually missing
 *
 * Two of the four rungs shipped long ago, one was BUILT BUT NEVER WIRED, and one did not
 * exist:
 *
 * - **`stream`** — `getPublicDynamicProjection` driving the animated map (ART-118 / ART-119).
 * - **`snapshot`** — ART-116 already publishes `characterStates` / `activeSceneStates` and a
 *   server-adjudicated `freshness` from `getPublicRuntimeSnapshot`, and the live map has
 *   never read it. Its only reader was the homepage, and only for the freshness chip.
 * - **`static-map`** — did not exist.
 * - **`informational`** — `LiveMapFallback` existed, but as a CLIFF rather than a rung: one
 *   false `webglSupported` dropped the viewer straight to a signpost page and skipped both
 *   middle rungs.
 *
 * So this module is not a degradation switch bolted onto a working page. It is the cliff
 * turned into a staircase.
 *
 * ## Why the level is DERIVED and never latched (this is what makes AC#5 free)
 *
 * `resolveDegradationLevel` is a pure function of conditions that are already observable on
 * every render. When the projection comes back, the function returns `stream` again on the
 * next render — there is no recovery mechanism, no polling, no timer and no retry, because
 * there is nothing to recover FROM. A `useState('degraded')` latch would have needed a
 * second mechanism to decide when to try climbing back, and that mechanism is exactly the
 * retry loop AC#4 exists to forbid.
 *
 * The one condition that genuinely must latch is a renderer that THREW — re-mounting a
 * renderer that just crashed is a crash loop. That latch is owned by
 * {@link ./LiveMapErrorBoundary} and it latches the RENDERER, not the data: the rungs below
 * it keep rising and falling with the data underneath, and the latch clears when the map
 * identity changes rather than on a clock.
 *
 * ## Why the level is decided on the client
 *
 * Most of what forces degradation is a fact about the browser — no WebGL, a renderer that
 * threw, a driver that lost its context. A server-declared level would be a claim about a
 * client the server cannot see. What the server can honestly contribute is how much to
 * trust the content it served, and it already does: `PublicRuntimeFreshness`. The ladder
 * combines that verdict with the client's own capability, which is why this module needs no
 * new Convex function and leaves `publicReadOnlyGuarantee.test.ts`'s enumeration untouched.
 *
 * Pure: no React, no Convex, no DOM, no clock, no randomness. `nowMs` is always a parameter.
 */

import type { PublicStatusDescriptor } from '../public/publicStatusBadge';

/**
 * The four rungs, highest first. Order is meaningful and is asserted against
 * {@link resolveDegradationLevel}: a test walks the array and requires that removing each
 * capability in turn moves the verdict DOWN by at least one index, so the ladder cannot
 * silently become a set.
 */
export const DEGRADATION_LEVELS = ['stream', 'snapshot', 'static-map', 'informational'] as const;
export type DegradationLevel = (typeof DEGRADATION_LEVELS)[number];

/** Which data the rung draws. `none` is the informational rung: there are no positions. */
export type DegradationSource = 'stream' | 'snapshot' | 'none';

/**
 * Why the viewer is not one rung higher. `null` at the top.
 *
 * Reported rather than inferred from the level, because two different causes can produce
 * `static-map` — a browser with no WebGL and a renderer that died — and they are different
 * things to tell a person. `LiveMapFallback` already drew this distinction for its own two
 * cases and was right to.
 */
export type DegradationReason =
  | 'renderer-unsupported'
  | 'renderer-failed'
  | 'stream-unavailable'
  | 'no-positions';

export type DegradationVerdict = {
  level: DegradationLevel;
  source: DegradationSource;
  reason: DegradationReason | null;
};

export type DegradationInput = {
  /**
   * The projection read is still in flight.
   *
   * Kept apart from "absent" deliberately. Collapsing them makes every first paint flash the
   * informational rung before the data lands, which reads as a broken page and, worse,
   * trains a viewer to distrust a label that is supposed to mean something.
   */
  readonly loading: boolean;
  /** The live projection resolved and has at least one character to place. */
  readonly streamContent: boolean;
  /** The runtime snapshot resolved and has at least one character to place. */
  readonly snapshotContent: boolean;
  /** WebGL is present. Probed once per mount by `detectWebGLSupport`. */
  readonly webglSupported: boolean;
  /** The renderer threw after starting. Latched by the error boundary, not by this module. */
  readonly rendererFailed: boolean;
  /** This world has an authored floor plan, so a static map is drawable at all. */
  readonly mapAvailable: boolean;
};

/**
 * Which rung the viewer is on.
 *
 * First-match-wins, in the order FR-O010 states the ladder:
 *
 * 1. Animated map on live data.
 * 2. Animated map on the last valid snapshot — the renderer is fine, the feed is not.
 * 3. Static floor plan with last known positions — the renderer is not fine, but we still
 *    know where everyone was, and where they were is information a text list throws away.
 * 4. Informational view — we do not know where anyone is, so there is nothing spatial to
 *    draw and pretending otherwise would be drawing a map of nothing.
 *
 * While `loading`, the verdict is `stream` with reason `null`. A pending read is not a
 * degraded state and must not be labelled as one.
 */
export function resolveDegradationLevel(input: DegradationInput): DegradationVerdict {
  const rendererAvailable = input.webglSupported && !input.rendererFailed;
  // A renderer that threw is reported as such even when the browser also lacks WebGL: the
  // failure is the more specific and more recent fact about this page.
  const rendererReason: DegradationReason = input.rendererFailed
    ? 'renderer-failed'
    : 'renderer-unsupported';

  if (input.loading) {
    return { level: 'stream', source: 'stream', reason: null };
  }
  if (rendererAvailable && input.streamContent) {
    return { level: 'stream', source: 'stream', reason: null };
  }
  if (rendererAvailable && input.snapshotContent) {
    return { level: 'snapshot', source: 'snapshot', reason: 'stream-unavailable' };
  }
  if (input.mapAvailable && (input.streamContent || input.snapshotContent)) {
    return {
      level: 'static-map',
      // Prefer live positions even here. The renderer is what failed, not the feed, and a
      // static plan drawn from a stale snapshot when a current projection is in hand would
      // be discarding good data for no reason.
      source: input.streamContent ? 'stream' : 'snapshot',
      reason: rendererAvailable ? 'stream-unavailable' : rendererReason,
    };
  }
  return {
    level: 'informational',
    source: 'none',
    // Ordered by what the viewer can act on. "No positions" is the binding constraint here —
    // a working renderer would still have nothing to draw — so it outranks a renderer note.
    reason: 'no-positions',
  };
}

/**
 * The rung, said in words.
 *
 * THREE NON-COLOUR SIGNALS, the convention `timeStateLabel.ts` established for ART-121 and
 * `publicStatusBadge.ts` continued for ART-131: a visible `label`, a distinct `glyph`, and a
 * `state` key the stylesheet turns into a distinct border-style. Strip the colour and two
 * remain; strip the stylesheet and the words still say it.
 *
 * `state` reuses the freshness vocabulary rather than inventing a fifth set of style keys,
 * because the stylesheet already draws those four and a rung maps onto them honestly: a
 * snapshot rung IS delayed content, and an informational rung IS content nobody can vouch
 * for the currency of.
 */
const LEVEL_DESCRIPTORS: Record<DegradationLevel, PublicStatusDescriptor> = {
  stream: {
    state: 'live',
    label: '即時畫面',
    glyph: '▶',
    announcement: '目前顯示的是即時的世界畫面。',
  },
  snapshot: {
    state: 'delayed',
    label: '最後有效快照',
    glyph: '◧',
    // Says which of the two things broke. "The world is still running" is the part a viewer
    // most needs and the part a generic error message never tells them.
    announcement: '即時畫面暫時無法取得,顯示的是最後一份有效的世界快照。世界本身仍在運作。',
  },
  'static-map': {
    state: 'paused',
    label: '靜態地圖',
    glyph: '▣',
    announcement: '動態地圖無法繪製,改以靜態平面圖顯示每個人最後已知的位置。',
  },
  informational: {
    state: 'stale',
    label: '文字檢視',
    glyph: '☰',
    announcement: '目前沒有可顯示的位置資料,改以地點、角色與場景的文字列表呈現。',
  },
};

export function degradationDescriptor(level: DegradationLevel): PublicStatusDescriptor {
  return LEVEL_DESCRIPTORS[level];
}

/**
 * Why we are on this rung, as a sentence, or `null` at the top.
 *
 * Separate from the level descriptor because the level says WHAT the viewer is looking at
 * and this says WHY — and only the second one can be absent. Folding them together would
 * force a "no reason" string into the top rung's label.
 */
const REASON_SENTENCES: Record<DegradationReason, string> = {
  'renderer-unsupported': '這個瀏覽器沒有可用的 WebGL,無法繪製動態地圖。',
  'renderer-failed': '動態地圖在繪製過程中失敗了。',
  'stream-unavailable': '即時投影目前無法取得。',
  'no-positions': '目前沒有任何可用的角色位置資料。',
};

export function degradationReasonSentence(reason: DegradationReason | null): string | null {
  return reason === null ? null : REASON_SENTENCES[reason];
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "When was this last updated", as a chip, at every rung (AC#3).
 *
 * Relative rather than absolute on purpose: an absolute timestamp makes the reader do the
 * subtraction, and the question they actually have is "how old is this", not "what time was
 * it". A future timestamp (clock skew between the server that stamped it and the browser
 * reading it) clamps to "just now" rather than rendering a negative age — the skew is not
 * the viewer's problem and "-3 minutes ago" reads as a bug.
 *
 * Returns `null` for an unknown or non-finite timestamp, so an absent value renders NO chip
 * rather than a chip claiming an age nobody knows. That is the same fail-quiet direction
 * `freshnessDescriptor` takes for an unrecognised state.
 */
export function lastUpdatedDescriptor(
  updatedAt: number | null | undefined,
  nowMs: number,
): PublicStatusDescriptor | null {
  if (updatedAt === null || updatedAt === undefined) return null;
  if (!Number.isFinite(updatedAt) || !Number.isFinite(nowMs)) return null;
  // `updatedAt === 0` is the documented "world with no accepted events" sentinel that
  // `runtimeSnapshot.ts` calls out; measuring an age from the Unix epoch would report a
  // world seeded minutes ago as decades old.
  if (updatedAt <= 0) return null;

  const ageMs = Math.max(0, nowMs - updatedAt);
  const label = ageMs < MINUTE_MS
    ? '剛剛更新'
    : ageMs < HOUR_MS
      ? `${Math.floor(ageMs / MINUTE_MS)} 分鐘前更新`
      : ageMs < DAY_MS
        ? `${Math.floor(ageMs / HOUR_MS)} 小時前更新`
        : `${Math.floor(ageMs / DAY_MS)} 天前更新`;

  return {
    // No state key: an age is not a verdict, and giving it one would draw a border-style
    // that claims a status the chip is not making.
    state: null,
    label,
    glyph: '⟳',
    announcement: `這份畫面的內容${label}。`,
  };
}
