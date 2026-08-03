import type { StoryArcProjectionData } from './model';
import {
  EntryRecommendationError,
  RECOMMENDED_ENTRY_SCHEMA_VERSION,
  recommendArcEntry,
  validateRecommendedArcEntry,
  type ArcEpisodeRef,
  type RecommendedArcEntry,
} from './entryRecommendation';

function projection(over: Partial<StoryArcProjectionData> = {}): StoryArcProjectionData {
  return {
    schemaVersion: 1, worldId: 'w1', arcId: 'arc-1', title: 'Feud', premise: 'p',
    currentQuestion: 'Who backs down?', status: 'active', coreCharacterIds: ['char-a'],
    incitingEventId: 'evt-incite', latestTurningPointEventId: 'evt-turn',
    essentialFactIds: [], unresolvedQuestions: ['q'], resolvedQuestions: [],
    recommendedEntryEventId: null, heatScore: 70,
    lastProgressTime: { worldDay: 1, timeSlot: 'morning', sourceEventId: 'evt-incite' }, revision: 0,
    ...over,
  } as StoryArcProjectionData;
}

function episode(episodeNumber: number, sourceEventIds: string[], worldDay = episodeNumber): ArcEpisodeRef {
  return { episodeNumber, worldDay, sourceEventIds };
}

describe('recommendArcEntry (AC#1 — every major active arc gets an entry)', () => {
  it('chooses the episode covering the inciting event first', () => {
    const entry = recommendArcEntry({
      worldId: 'w1', arcId: 'arc-1', projection: projection(),
      arcEpisodes: [episode(1, ['evt-other']), episode(2, ['evt-incite', 'evt-mid'])],
      worldEpisodes: [episode(1, ['evt-other']), episode(2, ['evt-incite'])], latestSequenceNumber: 9,
    });
    expect(entry.episodeNumber).toBe(2);
    expect(entry.signals.basis).toBe('inciting');
    expect(entry.sourceEventId).toBe('evt-incite');
  });

  it('falls back to the turning-point episode when the inciting event is not covered', () => {
    const entry = recommendArcEntry({
      worldId: 'w1', arcId: 'arc-1', projection: projection(),
      arcEpisodes: [episode(1, ['evt-mid']), episode(3, ['evt-turn'])],
      worldEpisodes: [episode(1, ['evt-mid']), episode(3, ['evt-turn'])], latestSequenceNumber: 9,
    });
    expect(entry.episodeNumber).toBe(3);
    expect(entry.signals.basis).toBe('turning_point');
    expect(entry.sourceEventId).toBe('evt-turn');
  });

  it('falls back to the earliest arc episode when neither anchor is covered', () => {
    const entry = recommendArcEntry({
      worldId: 'w1', arcId: 'arc-1', projection: projection(),
      arcEpisodes: [episode(2, ['evt-mid']), episode(5, ['evt-late'])],
      worldEpisodes: [episode(1, ['evt-pre']), episode(2, ['evt-mid']), episode(5, ['evt-late'])], latestSequenceNumber: 9,
    });
    expect(entry.episodeNumber).toBe(2);
    expect(entry.signals.basis).toBe('earliest');
  });

  it('falls back to the world’s earliest episode when no arc episode exists (AC#1)', () => {
    const entry = recommendArcEntry({
      worldId: 'w1', arcId: 'arc-1', projection: projection(),
      arcEpisodes: [],
      worldEpisodes: [episode(1, ['evt-pre']), episode(2, ['evt-mid'])], latestSequenceNumber: 9,
    });
    expect(entry.episodeNumber).toBe(1);
    expect(entry.signals.basis).toBe('first_episode');
  });

  it('records an explainable, queryable reason and the reassess marker (AC#2/#3)', () => {
    const entry = recommendArcEntry({
      worldId: 'w1', arcId: 'arc-1', projection: projection({ heatScore: 42 }),
      arcEpisodes: [episode(2, ['evt-incite'])], worldEpisodes: [episode(1, ['x']), episode(2, ['evt-incite'])],
      latestSequenceNumber: 17,
    });
    expect(entry.reason).toContain('第 2 集');
    expect(entry.signals.heatScore).toBe(42);
    expect(entry.reassessedAtSequenceNumber).toBe(17);
    expect(entry.worldId).toBe('w1');
    expect(entry.arcId).toBe('arc-1');
  });

  it('is idempotent: identical inputs produce an identical entry', () => {
    const input = {
      worldId: 'w1', arcId: 'arc-1', projection: projection(),
      arcEpisodes: [episode(1, ['evt-incite'])], worldEpisodes: [episode(1, ['evt-incite'])], latestSequenceNumber: 5,
    };
    expect(recommendArcEntry(input)).toEqual(recommendArcEntry(input));
  });

  it('throws when no episode has been published yet', () => {
    expect(() => recommendArcEntry({
      worldId: 'w1', arcId: 'arc-1', projection: projection(),
      arcEpisodes: [], worldEpisodes: [], latestSequenceNumber: 0,
    })).toThrow(EntryRecommendationError);
  });

  it('rejects invalid inputs', () => {
    expect(() => recommendArcEntry({
      worldId: '', arcId: 'arc-1', projection: projection(),
      arcEpisodes: [], worldEpisodes: [episode(1, ['x'])], latestSequenceNumber: 1,
    })).toThrow(EntryRecommendationError);
    expect(() => recommendArcEntry({
      worldId: 'w1', arcId: 'arc-1', projection: projection(),
      arcEpisodes: [], worldEpisodes: [episode(1, ['x'])], latestSequenceNumber: -1,
    })).toThrow(EntryRecommendationError);
  });
});

describe('validateRecommendedArcEntry', () => {
  function validEntry(): RecommendedArcEntry {
    return recommendArcEntry({
      worldId: 'w1', arcId: 'arc-1', projection: projection(),
      arcEpisodes: [episode(1, ['evt-incite'])], worldEpisodes: [episode(1, ['evt-incite'])], latestSequenceNumber: 3,
    });
  }

  it('accepts a well-formed entry', () => {
    const entry = validEntry();
    expect(validateRecommendedArcEntry(entry)).toEqual(entry);
    expect(validateRecommendedArcEntry(entry).schemaVersion).toBe(RECOMMENDED_ENTRY_SCHEMA_VERSION);
  });

  it('rejects an unsupported schema version', () => {
    expect(() => validateRecommendedArcEntry({ ...validEntry(), schemaVersion: 2 as 1 })).toThrow(EntryRecommendationError);
  });

  it('rejects an unsupported basis', () => {
    const entry = validEntry();
    (entry.signals as { basis: string }).basis = 'bogus';
    expect(() => validateRecommendedArcEntry(entry)).toThrow(EntryRecommendationError);
  });

  it('rejects an empty required text field', () => {
    expect(() => validateRecommendedArcEntry({ ...validEntry(), reason: '' })).toThrow(EntryRecommendationError);
  });

  it('rejects an invalid episode number', () => {
    expect(() => validateRecommendedArcEntry({ ...validEntry(), episodeNumber: 0 })).toThrow(EntryRecommendationError);
  });
});
