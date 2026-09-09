/**
 * Pure, testable logic for the public world-timeline page (FR-I008, ART-87).
 *
 * Mirrors {@link ./episodeListRoute}: the React component is a thin render
 * layer and the correctness boundaries — route resolution, arc/character/
 * event-type filtering, and episode deep-links — live here as pure functions,
 * unit-tested without a DOM.
 *
 * AC#1 (defaults to major events) is satisfied upstream: the published
 * `timeline:<worldId>` projection only contains major events (importance ≥
 * threshold), so the page renders whatever the projection publishes. This
 * module never widens that set.
 *
 * Pure module — no React, no Convex, no DOM, no clock, no randomness.
 */

/** Published major-event timeline (§13.8) — fields the page reads. */
export type TimelineProjection = {
  entries: Array<{
    eventId: string;
    worldDay: number;
    timeSlot: string;
    eventType: string;
    publicSummary: string | null;
    arcIds: string[];
    characterIds: string[];
    episodeNumber: number | null;
  }>;
};

export type TimelineFilter = {
  arc: string | null;
  character: string | null;
  eventType: string | null;
};

export type TimelineItem = {
  eventId: string;
  worldDay: number;
  timeSlot: string;
  eventType: string;
  publicSummary: string;
  episodeHref: string | null;
};

export type TimelineViewModel = {
  hasContent: boolean;
  entries: TimelineItem[];
  arcOptions: string[];
  characterOptions: string[];
  eventTypeOptions: string[];
};

const NO_SUMMARY = '(無摘要)';

/**
 * Resolve the public world from the `#timeline/<worldId>` hash route. Returns
 * null for a bare/unknown route so the component can surface a format hint.
 */
export function parseTimelineRoute(hash: string): { worldId: string } | null {
  const stripped = hash.replace(/^#/, '');
  const match = stripped.match(/^timeline\/([^/]+)$/);
  if (!match) return null;
  const worldId = decodeURIComponent(match[1]);
  return worldId.length > 0 ? { worldId } : null;
}

/**
 * Apply the arc + character + event-type filters to a timeline entry (AC#2). A
 * null filter matches everything; all three filters combine with AND.
 */
export function timelineEntryMatchesFilters(
  entry: { arcIds: string[]; characterIds: string[]; eventType: string },
  filter: TimelineFilter,
): boolean {
  if (filter.arc !== null && !entry.arcIds.includes(filter.arc)) return false;
  if (filter.character !== null && !entry.characterIds.includes(filter.character)) return false;
  if (filter.eventType !== null && entry.eventType !== filter.eventType) return false;
  return true;
}

const unique = (values: readonly string[]): string[] => [...new Set(values)].sort();

/**
 * Distinct, sorted filter options, with anything that would render as a nameless choice removed.
 *
 * Typed as `unknown[]` on purpose. These values come out of a published read-model payload, which
 * reaches the client as JSON that no client-side validator has narrowed, so an entry whose
 * `eventType` was never set arrives as `undefined` and not as `''`. The first version of this
 * filter assumed the declared type and called `.trim()` on it, which threw during render and blanked
 * the whole timeline — a worse bug than the nameless option it was fixing. The browser suite caught
 * it; the jsdom one could not, because its fixtures are built from the declared type.
 */
const namedOptions = (values: readonly unknown[]): string[] =>
  unique(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0));

/**
 * Compose the timeline render model from the published projection and the
 * active filters (AC#2). Entries are filtered and each carries a deep-link to
 * its episode when one exists (AC#3). Degrades to an empty model when the
 * projection is null.
 */
export function composeTimelineViewModel(input: {
  worldId: string;
  projection: TimelineProjection | null;
  filter: TimelineFilter;
}): TimelineViewModel {
  const entries = input.projection?.entries ?? [];
  const filtered = entries
    .filter((entry) => timelineEntryMatchesFilters(entry, input.filter))
    .map((entry) => ({
      eventId: entry.eventId,
      worldDay: entry.worldDay,
      timeSlot: entry.timeSlot,
      eventType: entry.eventType,
      publicSummary: entry.publicSummary ?? NO_SUMMARY,
      episodeHref: entry.episodeNumber != null ? `#episode/${input.worldId}/${entry.worldDay}` : null,
    }));

  return {
    hasContent: entries.length > 0,
    entries: filtered,
    // Empty values are dropped rather than offered (ART-94). An event with no arc, or with an
    // empty `eventType`, produced an `<option></option>` with no value and no text — a choice a
    // screen reader announces as nothing, and one that filters the list down to zero if taken.
    // axe does not flag it, because an option with no accessible name is not a rule violation;
    // it is simply an offer the page should not be making.
    arcOptions: namedOptions(entries.flatMap((entry) => entry.arcIds)),
    characterOptions: namedOptions(entries.flatMap((entry) => entry.characterIds)),
    eventTypeOptions: namedOptions(entries.map((entry) => entry.eventType)),
  };
}
