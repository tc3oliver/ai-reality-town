/**
 * Unit tests for the public timeline pure logic (ART-87, FR-I008). Covers route
 * resolution, the arc/character/event-type filters (AC#2, independent + AND),
 * episode deep-links (AC#3), and graceful states. AC#1 (major-events default)
 * is upheld by rendering the projection verbatim — tested as "never widens".
 *
 * Pure jest (no jsdom): the module under test has no React/Convex/DOM deps.
 */

import {
  composeTimelineViewModel,
  parseTimelineRoute,
  timelineEntryMatchesFilters,
  type TimelineFilter,
  type TimelineProjection,
} from './timelineRoute';

const NO_FILTER: TimelineFilter = { arc: null, character: null, eventType: null };

function projection(overrides: Partial<TimelineProjection> = {}): TimelineProjection {
  return {
    entries: [
      { eventId: 'e1', worldDay: 1, timeSlot: 'morning', eventType: 'meeting', publicSummary: '初次會面。', arcIds: ['arc-1'], characterIds: ['char-a'], episodeNumber: 1 },
      { eventId: 'e2', worldDay: 2, timeSlot: 'noon', eventType: 'conflict', publicSummary: '衝突爆發。', arcIds: ['arc-1', 'arc-2'], characterIds: ['char-a', 'char-b'], episodeNumber: 2 },
      { eventId: 'e3', worldDay: 3, timeSlot: 'night', eventType: 'meeting', publicSummary: null, arcIds: ['arc-2'], characterIds: ['char-b'], episodeNumber: null },
    ],
    ...overrides,
  };
}

describe('parseTimelineRoute', () => {
  it('resolves a #timeline/<worldId> route', () => {
    expect(parseTimelineRoute('#timeline/mistwood')).toEqual({ worldId: 'mistwood' });
  });
  it('returns null for a bare #timeline or unrelated hash', () => {
    expect(parseTimelineRoute('#timeline')).toBeNull();
    expect(parseTimelineRoute('#home/mistwood')).toBeNull();
    expect(parseTimelineRoute('')).toBeNull();
  });
});

describe('timelineEntryMatchesFilters', () => {
  const entry = { arcIds: ['arc-1'], characterIds: ['char-a'], eventType: 'meeting' };
  it('matches when no filter is set', () => {
    expect(timelineEntryMatchesFilters(entry, NO_FILTER)).toBe(true);
  });
  it('filters independently by arc, character, and event type (AC#2)', () => {
    expect(timelineEntryMatchesFilters(entry, { arc: 'arc-1', character: null, eventType: null })).toBe(true);
    expect(timelineEntryMatchesFilters(entry, { arc: 'arc-9', character: null, eventType: null })).toBe(false);
    expect(timelineEntryMatchesFilters(entry, { arc: null, character: 'char-a', eventType: null })).toBe(true);
    expect(timelineEntryMatchesFilters(entry, { arc: null, character: 'char-z', eventType: null })).toBe(false);
    expect(timelineEntryMatchesFilters(entry, { arc: null, character: null, eventType: 'meeting' })).toBe(true);
    expect(timelineEntryMatchesFilters(entry, { arc: null, character: null, eventType: 'conflict' })).toBe(false);
  });
  it('combines all three filters with AND (AC#2)', () => {
    expect(timelineEntryMatchesFilters(entry, { arc: 'arc-1', character: 'char-a', eventType: 'meeting' })).toBe(true);
    expect(timelineEntryMatchesFilters(entry, { arc: 'arc-1', character: 'char-a', eventType: 'conflict' })).toBe(false);
  });
});

describe('composeTimelineViewModel', () => {
  it('lists entries (rendered verbatim — AC#1 never widens beyond the major-event projection)', () => {
    const vm = composeTimelineViewModel({ worldId: 'w', projection: projection(), filter: NO_FILTER });
    expect(vm.hasContent).toBe(true);
    expect(vm.entries.map((e) => e.eventId)).toEqual(['e1', 'e2', 'e3']);
  });

  it('exposes arc, character, and event-type filter options (AC#2)', () => {
    const vm = composeTimelineViewModel({ worldId: 'w', projection: projection(), filter: NO_FILTER });
    expect(vm.arcOptions).toEqual(['arc-1', 'arc-2']);
    expect(vm.characterOptions).toEqual(['char-a', 'char-b']);
    expect(vm.eventTypeOptions).toEqual(['conflict', 'meeting']);
  });

  it('filters by arc (AC#2)', () => {
    const vm = composeTimelineViewModel({ worldId: 'w', projection: projection(), filter: { arc: 'arc-2', character: null, eventType: null } });
    expect(vm.entries.map((e) => e.eventId)).toEqual(['e2', 'e3']);
  });

  it('filters by character (AC#2)', () => {
    const vm = composeTimelineViewModel({ worldId: 'w', projection: projection(), filter: { arc: null, character: 'char-b', eventType: null } });
    expect(vm.entries.map((e) => e.eventId)).toEqual(['e2', 'e3']);
  });

  it('filters by event type (AC#2)', () => {
    const vm = composeTimelineViewModel({ worldId: 'w', projection: projection(), filter: { arc: null, character: null, eventType: 'meeting' } });
    expect(vm.entries.map((e) => e.eventId)).toEqual(['e1', 'e3']);
  });

  it('combines arc + character + event type (AC#2)', () => {
    const vm = composeTimelineViewModel({ worldId: 'w', projection: projection(), filter: { arc: 'arc-1', character: 'char-a', eventType: 'meeting' } });
    expect(vm.entries.map((e) => e.eventId)).toEqual(['e1']);
  });

  it('links entries with an episode; leaves others without a link (AC#3)', () => {
    const vm = composeTimelineViewModel({ worldId: 'mistwood', projection: projection(), filter: NO_FILTER });
    const byId = Object.fromEntries(vm.entries.map((e) => [e.eventId, e]));
    expect(byId.e1.episodeHref).toBe('#episode/mistwood/1');
    expect(byId.e2.episodeHref).toBe('#episode/mistwood/2');
    expect(byId.e3.episodeHref).toBeNull();
  });

  it('fills a null summary with a placeholder', () => {
    const vm = composeTimelineViewModel({ worldId: 'w', projection: projection(), filter: NO_FILTER });
    expect(vm.entries.find((e) => e.eventId === 'e3')?.publicSummary).toBe('(無摘要)');
  });

  it('degrades gracefully when the projection is null', () => {
    const vm = composeTimelineViewModel({ worldId: 'w', projection: null, filter: NO_FILTER });
    expect(vm.hasContent).toBe(false);
    expect(vm.entries).toEqual([]);
    expect(vm.arcOptions).toEqual([]);
  });
});
