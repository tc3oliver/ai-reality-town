/**
 * The day/night wash over the map (ART-120 / FR-O012).
 *
 * PRD 2.0 §9.1.3 lists lighting among the environmental animation that keeps the world from
 * reading as a still frame. This is the cheapest honest version of it: one full-map coloured
 * rectangle at low alpha, drawn above the tilemap and below the characters. No new art, no
 * Pixi filter, no per-frame work at all.
 *
 * ## Why the Canon slot and never a wall clock
 *
 * The obvious implementation is a clock-driven cycle: read the browser's time, fade towards
 * blue in the evening. It is also a RISK2-008 violation. Mistwood advances five slots a real
 * day on Canon's schedule, not on the viewer's; a wall-clock tint would show the town at dusk
 * while the last accepted event says it is noon, which is the map asserting a world fact
 * nobody accepted. So the tint is a pure function of `timeSlot` — published on the projection
 * from the last accepted event by ART-120's Phase 1 — and it changes only when Canon does.
 *
 * That also makes it free: `timeSlot` changes at most five times a day, so the overlay's draw
 * callback is stable for hours and Pixi repaints it never.
 *
 * Reduced Motion needs no branch here, and that is worth stating rather than leaving implicit:
 * the accessibility complaint is about motion, a static colour wash is not motion, and there
 * is no cross-fade to suppress because the tint only ever changes when Canon does. Removing
 * the wash under Reduced Motion would drop a legitimate signal about the world's state for
 * exactly the viewers least able to pick it up elsewhere.
 */

/** No wash at all. Returned for an unknown slot and for a world with no accepted history. */
export const NO_TINT = { colour: 0x000000, alpha: 0 } as const;

export type DayNightTint = {
  /** RGB, as Pixi wants it. */
  readonly colour: number;
  /** How much of the wash to apply. Deliberately small: this is weather-light, not a filter. */
  readonly alpha: number;
};

/**
 * One wash per Canon time slot.
 *
 * The alphas top out at 0.22 because the tileset is already low-contrast pixel art: anything
 * heavier stops being "it is evening in Mistwood" and starts being "the map failed to load".
 * Noon is deliberately absent of tint rather than washed white — midday is the light the art
 * was drawn in.
 */
const TINT_BY_SLOT: Readonly<Record<string, DayNightTint>> = {
  morning: { colour: 0xffd9a0, alpha: 0.1 },
  noon: NO_TINT,
  afternoon: { colour: 0xffc27a, alpha: 0.08 },
  evening: { colour: 0xff8a5c, alpha: 0.16 },
  night: { colour: 0x2b3f7a, alpha: 0.22 },
};

/**
 * The wash for a published slot.
 *
 * Total: an unrecognised slot — a Canon vocabulary change this build predates — returns no
 * tint rather than throwing. Refusing to draw the town because a fifth slot became a sixth
 * would be a far worse failure than drawing it in daylight, and it matches how
 * `timeBucketForSlot` treats the same situation in the Visual Runtime.
 */
export function dayNightTintFor(timeSlot: string | undefined): DayNightTint {
  if (timeSlot === undefined) return NO_TINT;
  return TINT_BY_SLOT[timeSlot] ?? NO_TINT;
}
