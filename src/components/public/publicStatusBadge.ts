/**
 * The public status vocabulary (FR-P003 / ART-131 AC#3, AC#7).
 *
 * One place that decides how a state is SAID, so five surfaces cannot each invent their own
 * wording for the same thing — which is the drift AC#4 is about. Pure: no React, no clock, no
 * network, so every branch is unit-testable without a renderer.
 *
 * THREE NON-COLOUR SIGNALS PER STATE (AC#7). Each descriptor carries a visible `label`, a
 * distinct `glyph`, and a `state` key the stylesheet turns into a distinct border-style. Remove
 * the colour and two signals remain; remove the stylesheet entirely and the label still says it
 * in words. This is the convention `timeStateLabel.ts` established for ART-121's replay
 * vocabulary, applied to a second one rather than reinvented — the two vocabularies are kept
 * SEPARATE on purpose, because "is this live or a replay?" and "is the feed fresh?" are different
 * questions and merging them would make a badge that answers neither.
 */

/**
 * The four verdicts `PublicRuntimeFreshness` (convex/publicRead/runtimeSnapshot.ts) can return.
 *
 * Restated here rather than imported: `src/` may not depend on the Convex read modules, and this
 * is a presentation vocabulary that happens to have the same members. `publicStatusBadge.test.ts`
 * asserts the two lists agree, so the restatement cannot silently drift.
 */
export const PUBLIC_FRESHNESS_STATES = ['live', 'delayed', 'paused', 'stale'] as const;
export type PublicFreshnessState = (typeof PUBLIC_FRESHNESS_STATES)[number];

export type PublicStatusDescriptor = {
  /** Keys the stylesheet's border-style. `null` for chips that carry no state (day, slot). */
  state: PublicFreshnessState | null;
  /** Shown, and the only signal that survives the stylesheet being off. */
  label: string;
  /** Decorative, `aria-hidden`: the label beside it already says the same thing in words. */
  glyph: string;
  /** A full sentence for assistive technology, since the visible chip reads as a fragment. */
  announcement: string;
};

const FRESHNESS: Record<PublicFreshnessState, PublicStatusDescriptor> = {
  live: {
    state: 'live',
    label: '直播中',
    glyph: '●',
    announcement: '這個世界正在即時推進,畫面是最新的。',
  },
  delayed: {
    state: 'delayed',
    label: '延遲',
    glyph: '◐',
    // Says what is true of the CONTENT, not of the connection: nothing is buffering, the world
    // simply has not produced anything recently.
    announcement: '畫面比世界目前的進度稍舊,世界仍在運作。',
  },
  paused: {
    state: 'paused',
    label: '已暫停',
    glyph: '‖',
    announcement: '這個世界目前暫停推進,顯示的是暫停前的最後狀態。',
  },
  stale: {
    state: 'stale',
    label: '資料過期',
    glyph: '✕',
    // The honest one. A stale snapshot means the capture path itself has not confirmed anything
    // for hours, so the state it claims is a claim nobody has checked — saying "paused" here
    // would assert something about the world that nothing currently knows.
    announcement: '這份畫面已有一段時間沒有更新,目前無法確認世界的實際狀態。',
  },
};

/** The descriptor for a freshness verdict, or `null` for an unknown one. */
export function freshnessDescriptor(state: string | null | undefined): PublicStatusDescriptor | null {
  if (state === null || state === undefined) return null;
  // Total by construction: an unrecognised value degrades to "no badge" rather than to a badge
  // that says something wrong about the world.
  return (FRESHNESS as Record<string, PublicStatusDescriptor | undefined>)[state] ?? null;
}

/**
 * The placeholder the page view models already use where the world clock is unknown
 * (`homeRoute.ts`'s `EM_DASH`). A chip reading "第 — 天" says less than no chip at all, so it is
 * filtered rather than rendered.
 */
const UNKNOWN_LABELS = new Set(['—', '-', '']);

/**
 * The world clock as a chip pair. Carries no state, so no border-style is keyed off it.
 *
 * Accepts a `string` as well as a `number` because the page view models disagree, and on purpose:
 * `homeRoute` already stringifies the day (substituting an em dash when it is unknown) while the
 * live projection hands over a raw number. Normalising here rather than making one of them change
 * keeps this a presentation concern and leaves both view models alone.
 */
export function worldClockDescriptors(
  worldDay: number | string | null | undefined,
  timeSlot: string | null | undefined,
): PublicStatusDescriptor[] {
  const chips: PublicStatusDescriptor[] = [];
  const day = typeof worldDay === 'number' && Number.isFinite(worldDay)
    ? String(worldDay)
    : typeof worldDay === 'string'
      ? worldDay.trim()
      : '';
  if (!UNKNOWN_LABELS.has(day)) {
    chips.push({
      state: null,
      label: `第 ${day} 天`,
      glyph: '☼',
      announcement: `世界時間第 ${day} 天。`,
    });
  }
  const slot = typeof timeSlot === 'string' ? timeSlot.trim() : '';
  if (!UNKNOWN_LABELS.has(slot)) {
    chips.push({
      state: null,
      label: slot,
      glyph: '◔',
      announcement: `時段:${slot}。`,
    });
  }
  return chips;
}
