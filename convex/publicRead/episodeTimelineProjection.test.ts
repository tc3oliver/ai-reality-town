import type { DailyEpisode } from '../editorial/episode';
import {
  ELIGIBLE_EPISODE_STATUSES,
  EPISODE_TIMELINE_SCHEMA_VERSION,
  EpisodeTimelineError,
  TIMELINE_MAJOR_IMPORTANCE,
  buildEpisodeProjection,
  buildTimelineProjection,
  type TimelineEntryInput,
} from './episodeTimelineProjection';

function episode(over: Partial<DailyEpisode> = {}): DailyEpisode {
  return {
    schemaVersion: 1, worldId: 'w1', worldDay: 2, episodeNumber: 5, title: 'The Truce',
    headline: 'A fragile peace.', oneLineSummary: 'Two families meet.',
    keyScenes: [{ title: 'Scene 1', summary: 'They talk.', sourceEventIds: ['e1'], publicFactIds: [] }],
    relationshipChanges: [{ summary: 'Trust grew.', sourceEventId: 'e1' }],
    newQuestions: ['Will it last?'], resolvedQuestions: ['Who started it?'],
    arcIds: ['arc-1', 'arc-1'], characterIds: ['char-a', 'char-b'],
    nextEpisodeTease: 'Tomorrow brings doubt.', sourceEventIds: ['e1', 'e2'], ...over,
  };
}

describe('buildEpisodeProjection (AC#1 — only eligible published content + all fields)', () => {
  it('projects an eligible published episode with detail + list fields', () => {
    const projection = buildEpisodeProjection({ worldId: 'w1', episode: episode(), status: 'ready' });
    expect(projection.worldDay).toBe(2);
    expect(projection.episodeNumber).toBe(5);
    expect(projection.title).toBe('The Truce');
    expect(projection.keyScenes[0]).toEqual({ title: 'Scene 1', summary: 'They talk.', sourceEventIds: ['e1'] });
    expect(projection.arcIds).toEqual(['arc-1']); // unique
    expect(projection.characterIds).toEqual(['char-a', 'char-b']);
    expect(projection.schemaVersion).toBe(EPISODE_TIMELINE_SCHEMA_VERSION);
  });

  it('rejects a withheld or failed episode (only eligible published content)', () => {
    expect(() => buildEpisodeProjection({ worldId: 'w1', episode: episode(), status: 'withheld' })).toThrow(EpisodeTimelineError);
    expect(() => buildEpisodeProjection({ worldId: 'w1', episode: episode(), status: 'failed' })).toThrow(EpisodeTimelineError);
    expect(ELIGIBLE_EPISODE_STATUSES).toEqual(['ready', 'published']);
  });

  it('is deterministic for identical inputs (AC#3)', () => {
    const a = buildEpisodeProjection({ worldId: 'w1', episode: episode(), status: 'published' });
    const b = buildEpisodeProjection({ worldId: 'w1', episode: episode(), status: 'published' });
    expect(a).toEqual(b);
  });
});

describe('buildTimelineProjection (AC#2 — major events, retains keys)', () => {
  function entry(over: Partial<TimelineEntryInput>): TimelineEntryInput {
    return {
      eventId: 'e1', worldDay: 1, timeSlot: 'morning', eventType: 'discovery',
      publicSummary: 'A clue surfaced.', importance: 0.5, arcIds: ['arc-1'], characterIds: ['char-a'],
      episodeNumber: 1, ...over,
    };
  }

  it('defaults to major events (importance >= threshold) and retains every key', () => {
    const projection = buildTimelineProjection({
      worldId: 'w1',
      entries: [
        entry({ eventId: 'e-minor', importance: 0.3 }),
        entry({ eventId: 'e-major', importance: TIMELINE_MAJOR_IMPORTANCE, arcIds: ['arc-1', 'arc-2'], characterIds: ['char-a'] }),
      ],
    });
    expect(projection.entries).toHaveLength(1);
    const only = projection.entries[0];
    expect(only.eventId).toBe('e-major');
    // AC#2 keys: Arc, Character, EventType, Episode-link
    expect(only.arcIds).toEqual(['arc-1', 'arc-2']);
    expect(only.characterIds).toEqual(['char-a']);
    expect(only.eventType).toBe('discovery');
    expect(only.episodeNumber).toBe(1);
    expect(only.publicSummary).toBe('A clue surfaced.');
  });

  it('orders entries by world day, time slot, then event id', () => {
    const projection = buildTimelineProjection({
      worldId: 'w1',
      entries: [
        entry({ eventId: 'b', worldDay: 1, timeSlot: 'evening', importance: 0.9 }),
        entry({ eventId: 'a', worldDay: 1, timeSlot: 'morning', importance: 0.9 }),
        entry({ eventId: 'c', worldDay: 2, timeSlot: 'morning', importance: 0.9 }),
      ],
    });
    expect(projection.entries.map((entryValue) => entryValue.eventId)).toEqual(['a', 'b', 'c']);
  });

  it('honours a custom importance threshold', () => {
    const projection = buildTimelineProjection({
      worldId: 'w1', entries: [entry({ eventId: 'e', importance: 0.4 })], minImportance: 0.3,
    });
    expect(projection.entries).toHaveLength(1);
  });

  it('is deterministic for identical inputs (AC#3)', () => {
    const input = { worldId: 'w1', entries: [entry({ importance: 0.9 })] };
    expect(buildTimelineProjection(input)).toEqual(buildTimelineProjection(input));
  });
});
