/**
 * Honest time-state labelling (FR-O014 / ART-121 AC#9).
 *
 * RISK2-009 is the risk that a viewer mistakes replay for live. Every other part of this
 * feature reduces the chance of that; this module is the part that makes it impossible to
 * claim we did not say. Three states, always named in words:
 *
 * - `replay` — what is on the screen right now is a recording.
 * - `earlier` — the Canon day and slot the recording happened in.
 * - `now` — the Canon day and slot the world is actually at.
 *
 * ## Not by colour alone
 *
 * Each badge carries three independent signals: visible **text** (`label`), a distinct
 * **glyph** rendered `aria-hidden` beside it, and a `data-time-state` attribute the stylesheet
 * keys a distinct **border style** off. Strip the stylesheet and the three rows are still
 * distinguishable; view them in greyscale and they still are; read them with a screen reader
 * and `announcement` says the whole thing in a sentence. Colour is the fourth signal, never
 * the first. This follows the convention `docs/accessibility.md` records for the freshness
 * vocabulary ART-116 introduced.
 *
 * Pure: no React, no clock, no DOM. `TimeStateBanner.tsx` renders what this returns.
 */

export const TIME_STATES = ['replay', 'earlier', 'now'] as const;
export type TimeState = (typeof TIME_STATES)[number];

export type TimeStateBadge = {
  readonly state: TimeState;
  /** Visible text. The primary signal — never abbreviated to a colour or an icon. */
  readonly label: string;
  /** A distinct shape per state, rendered `aria-hidden` so it is never read out twice. */
  readonly glyph: string;
  /** Which day and slot this row is talking about. */
  readonly detail: string;
  /** The whole row as one sentence, for the `role="status"` region. */
  readonly announcement: string;
};

/** Distinct shapes, not distinct hues. Each reads differently in a monochrome screenshot. */
const GLYPHS: Record<TimeState, string> = {
  replay: '⟲',
  earlier: '◷',
  now: '◉',
};

const LABELS: Record<TimeState, string> = {
  replay: '重播',
  earlier: '稍早',
  now: '現在',
};

export type TimeStateContext = {
  /** The replay in flight, or `null` when the map is showing live state. */
  readonly replay: {
    readonly worldDay: number;
    readonly timeSlot: string;
    readonly sceneIndex: number;
    readonly sceneCount: number;
  } | null;
  /** The Canon day and slot of the last accepted event, from the live projection. */
  readonly worldDay?: number;
  readonly timeSlot?: string;
};

/**
 * A world day and slot as a phrase, or an admission that we do not know one.
 *
 * The raw `timeSlot` is printed rather than translated, deliberately: Canon's slot vocabulary
 * is a plain string the runtime already treats as extensible, and a lookup table here would
 * turn adding a sixth slot into a blank label.
 */
function worldTimeText(worldDay: number | undefined, timeSlot: string | undefined): string {
  if (worldDay === undefined || timeSlot === undefined) return '世界時間未知';
  return `第 ${worldDay} 天 · ${timeSlot}`;
}

/**
 * The rows the banner shows.
 *
 * During playback all three are present, because the honest statement needs all three: what
 * you are watching, when it happened, and what the world is at. Otherwise there is exactly one
 * row — `now` — and no `replay` row is rendered at all, so the word "重播" is never on screen
 * while live state is.
 */
export function composeTimeStateBadges(context: TimeStateContext): TimeStateBadge[] {
  const nowDetail = worldTimeText(context.worldDay, context.timeSlot);
  const nowBadge: TimeStateBadge = {
    state: 'now',
    label: LABELS.now,
    glyph: GLYPHS.now,
    detail: nowDetail,
    announcement: `現在:世界目前在 ${nowDetail}。`,
  };

  if (!context.replay) return [nowBadge];

  const { worldDay, timeSlot, sceneIndex, sceneCount } = context.replay;
  const earlierDetail = worldTimeText(worldDay, timeSlot);
  return [
    {
      state: 'replay',
      label: LABELS.replay,
      glyph: GLYPHS.replay,
      detail: `第 ${sceneIndex + 1} / ${sceneCount} 個場景`,
      announcement: `重播:正在播放第 ${sceneIndex + 1} 個場景,共 ${sceneCount} 個。這是紀錄,不是現在發生的事。`,
    },
    {
      state: 'earlier',
      label: LABELS.earlier,
      glyph: GLYPHS.earlier,
      detail: earlierDetail,
      announcement: `稍早:這段紀錄發生在 ${earlierDetail}。`,
    },
    nowBadge,
  ];
}
