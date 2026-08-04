/**
 * Viewer spoiler-mode data compatibility (FR-H005, ART-70).
 *
 * Declares the three future spoiler perspectives and proves the existing
 * public-read content can be filtered into each one using ONLY the fields the
 * data model already carries — a revealability flag (`visibility`) and episode-
 * day provenance (`worldDay`) — so no destructive migration is needed when the
 * P2 spoiler UI lands (AC#1/#3). MVP declares the modes + the forward-compatible
 * viewer-progress schema ({@link ./schema.ts}) but does NOT implement the UI or
 * populate progress (AC#2).
 *
 * The three modes (PRD §FR-H005):
 *   - `full`         — Full Viewer Perspective (includes private content).
 *   - `publicOnly`   — Public Information Only (default; what ships today).
 *   - `watchedOnly`  — Watched Episodes Only (public content scoped to the
 *                      episodes the viewer has progressed past).
 *
 * Pure module — no Convex imports, no clock, no randomness, no mutation.
 */

export const SPOILER_MODES = ['full', 'publicOnly', 'watchedOnly'] as const;
export type SpoilerMode = (typeof SPOILER_MODES)[number];

export function isSpoilerMode(value: unknown): value is SpoilerMode {
  return typeof value === 'string' && (SPOILER_MODES as readonly string[]).includes(value);
}

/**
 * Revealability of a piece of content for spoiler purposes. `public` covers
 * everything the publication layer may reveal (public + canon visibility);
 * `private` is content withheld from the public read model today but retained
 * in canon so a future Full Viewer Perspective can surface it.
 */
export type SpoilerVisibility = 'private' | 'public';

/**
 * The minimal shape a content item must carry to be spoiler-filterable. Both
 * fields already exist on the published projections and canon records, which is
 * exactly what AC#1/#3 require: filtering needs no schema change.
 */
export type SpoilerFilterable = {
  visibility: SpoilerVisibility;
  /** Episode-day the content belongs to, or null when not episode-scoped. */
  worldDay: number | null;
};

/**
 * Whether a content item is visible under a spoiler mode, given the set of
 * world-days the viewer has watched (used only by `watchedOnly`).
 *
 *   - `full`        → everything, including private content.
 *   - `publicOnly`  → public content from any episode.
 *   - `watchedOnly` → public content whose episode-day the viewer has watched.
 *
 * Non-episode-scoped content (`worldDay === null`) is treated as world-level
 * context: visible under `full` and `publicOnly`, and under `watchedOnly` only
 * when the viewer has watched at least one episode (they have entered the world).
 */
export function isVisibleUnderMode(
  item: SpoilerFilterable,
  mode: SpoilerMode,
  watchedWorldDays: ReadonlySet<number>,
): boolean {
  if (mode === 'full') return true;
  if (item.visibility === 'private') return false;
  // Public content from here.
  if (mode === 'publicOnly') return true;
  // watchedOnly: scope to watched episodes (world-level context if watched anything).
  if (item.worldDay === null) return watchedWorldDays.size > 0;
  return watchedWorldDays.has(item.worldDay);
}

/**
 * Filter a list of content items to those visible under a mode. Pure: returns a
 * new array, never mutates the input. This is the compatibility proof — it runs
 * entirely over {@link SpoilerFilterable} fields the model already exposes.
 */
export function filterBySpoilerMode<T extends SpoilerFilterable>(
  items: readonly T[],
  mode: SpoilerMode,
  watchedWorldDays: ReadonlySet<number>,
): T[] {
  return items.filter((item) => isVisibleUnderMode(item, mode, watchedWorldDays));
}
