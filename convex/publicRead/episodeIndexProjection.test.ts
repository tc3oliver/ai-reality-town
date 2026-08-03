/**
 * Unit tests for the Episode Index projection (ART-86, FR-I004).
 *
 * Pure jest (no Convex/DOM): the builder is a pure function.
 */

import {
  buildEpisodeIndex,
  ELIGIBLE_EPISODE_STATUSES,
  type EpisodeIndexEntryInput,
} from './episodeIndexProjection';

const WORLD_ID = 'w-index';

function ep(overrides: Partial<EpisodeIndexEntryInput>): EpisodeIndexEntryInput {
  return {
    worldDay: 1,
    episodeNumber: 1,
    title: '第一集',
    headline: '開端。',
    status: 'published',
    arcIds: ['arc-1'],
    characterIds: ['char-a'],
    sourceEventIds: ['evt-1'],
    ...overrides,
  };
}

describe('buildEpisodeIndex', () => {
  it('indexes eligible episodes ordered by world day ascending (AC#1)', () => {
    const result = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [ep({ worldDay: 3 }), ep({ worldDay: 1 }), ep({ worldDay: 2 })],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
    });
    expect(result.episodes.map((e) => e.worldDay)).toEqual([1, 2, 3]);
  });

  it('excludes non-eligible episodes (withheld/draft never indexed, AC#1)', () => {
    const result = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [
        ep({ worldDay: 1, status: 'published' }),
        ep({ worldDay: 2, status: 'withheld' }),
        ep({ worldDay: 3, status: 'draft' }),
        ep({ worldDay: 4, status: 'ready' }),
      ],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
    });
    expect(result.episodes.map((e) => e.worldDay)).toEqual([1, 4]);
    expect(ELIGIBLE_EPISODE_STATUSES).toEqual(['ready', 'published']);
  });

  it('marks recommended-entry episodes (AC#3, ART-67)', () => {
    const result = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [ep({ worldDay: 1 }), ep({ worldDay: 2 }), ep({ worldDay: 3 })],
      recommendedEntryWorldDays: new Set([2]),
      turningPointEventIds: new Set(),
    });
    const byDay = Object.fromEntries(result.episodes.map((e) => [e.worldDay, e]));
    expect(byDay[1].isRecommendedEntry).toBe(false);
    expect(byDay[2].isRecommendedEntry).toBe(true);
    expect(byDay[3].isRecommendedEntry).toBe(false);
  });

  it('marks turning-point episodes by source-event membership (AC#3)', () => {
    const result = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [
        ep({ worldDay: 1, sourceEventIds: ['evt-a'] }),
        ep({ worldDay: 2, sourceEventIds: ['evt-b', 'evt-tp'] }),
        ep({ worldDay: 3, sourceEventIds: ['evt-c'] }),
      ],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(['evt-tp']),
    });
    const byDay = Object.fromEntries(result.episodes.map((e) => [e.worldDay, e]));
    expect(byDay[1].isTurningPoint).toBe(false);
    expect(byDay[2].isTurningPoint).toBe(true);
    expect(byDay[3].isTurningPoint).toBe(false);
  });

  it('emits the union of arc and character ids for filters (AC#2)', () => {
    const result = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [
        ep({ worldDay: 1, arcIds: ['arc-2', 'arc-1'], characterIds: ['char-b', 'char-a'] }),
        ep({ worldDay: 2, arcIds: ['arc-1', 'arc-3'], characterIds: ['char-a', 'char-c'] }),
      ],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
    });
    expect(result.arcIds).toEqual(['arc-1', 'arc-2', 'arc-3']);
    expect(result.characterIds).toEqual(['char-a', 'char-b', 'char-c']);
  });

  it('degrades to an empty (but valid) index when no eligible episodes exist', () => {
    const result = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [ep({ status: 'withheld' })],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
    });
    expect(result.episodes).toEqual([]);
    expect(result.arcIds).toEqual([]);
    expect(result.characterIds).toEqual([]);
  });

  it('rejects an empty worldId', () => {
    expect(() => buildEpisodeIndex({
      worldId: '  ',
      episodes: [],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
    })).toThrow();
  });
});
