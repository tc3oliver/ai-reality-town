/**
 * Unit tests for the public episode-list pure logic (ART-86, FR-I004). Covers
 * route resolution, date ordering, arc/character filtering (AC#2), and the
 * recommended-entry / turning-point markers (AC#3), plus graceful states.
 *
 * Pure jest (no jsdom): the module under test has no React/Convex/DOM deps.
 */

import {
  composeEpisodeListViewModel,
  episodeMatchesFilters,
  parseEpisodeListRoute,
  type EpisodeFilter,
  type EpisodeListIndex,
} from './episodeListRoute';

function index(overrides: Partial<EpisodeListIndex> = {}): EpisodeListIndex {
  return {
    episodes: [
      { worldDay: 1, episodeNumber: 1, title: '開端', headline: '一切開始。', arcIds: ['arc-1'], characterIds: ['char-a'], isRecommendedEntry: false, isTurningPoint: false },
      { worldDay: 2, episodeNumber: 2, title: '轉折', headline: '風向改變。', arcIds: ['arc-1', 'arc-2'], characterIds: ['char-a', 'char-b'], isRecommendedEntry: true, isTurningPoint: true },
      { worldDay: 3, episodeNumber: 3, title: '餘波', headline: '餘韻未散。', arcIds: ['arc-2'], characterIds: ['char-b'], isRecommendedEntry: false, isTurningPoint: false },
    ],
    arcIds: ['arc-1', 'arc-2'],
    characterIds: ['char-a', 'char-b'],
    ...overrides,
  };
}

const NO_FILTER: EpisodeFilter = { arc: null, character: null };

describe('parseEpisodeListRoute', () => {
  it('resolves a #episodes/<worldId> route', () => {
    expect(parseEpisodeListRoute('#episodes/mistwood')).toEqual({ worldId: 'mistwood' });
  });
  it('decodes an encoded worldId', () => {
    expect(parseEpisodeListRoute('#episodes/two%20words')).toEqual({ worldId: 'two words' });
  });
  it('returns null for a bare #episodes', () => {
    expect(parseEpisodeListRoute('#episodes')).toBeNull();
    expect(parseEpisodeListRoute('#episodes/')).toBeNull();
  });
  it('returns null for unrelated hashes', () => {
    expect(parseEpisodeListRoute('#episode/mistwood/1')).toBeNull();
    expect(parseEpisodeListRoute('')).toBeNull();
  });
});

describe('episodeMatchesFilters', () => {
  const ep = { arcIds: ['arc-1', 'arc-2'], characterIds: ['char-a'] };
  it('matches when no filter is set', () => {
    expect(episodeMatchesFilters(ep, NO_FILTER)).toBe(true);
  });
  it('filters by arc', () => {
    expect(episodeMatchesFilters(ep, { arc: 'arc-1', character: null })).toBe(true);
    expect(episodeMatchesFilters(ep, { arc: 'arc-9', character: null })).toBe(false);
  });
  it('filters by character', () => {
    expect(episodeMatchesFilters(ep, { arc: null, character: 'char-a' })).toBe(true);
    expect(episodeMatchesFilters(ep, { arc: null, character: 'char-z' })).toBe(false);
  });
  it('combines arc + character with AND (AC#2)', () => {
    expect(episodeMatchesFilters(ep, { arc: 'arc-1', character: 'char-a' })).toBe(true);
    expect(episodeMatchesFilters(ep, { arc: 'arc-1', character: 'char-z' })).toBe(false);
  });
});

describe('composeEpisodeListViewModel', () => {
  it('lists all episodes ordered by world day with deep-links (AC#1)', () => {
    const vm = composeEpisodeListViewModel({ worldId: 'mistwood', index: index(), filter: NO_FILTER });
    expect(vm.episodes.map((e) => e.worldDay)).toEqual([1, 2, 3]);
    expect(vm.episodes[0].href).toBe('#episode/mistwood/1');
    expect(vm.hasContent).toBe(true);
  });

  it('exposes arc and character filter options (AC#2)', () => {
    const vm = composeEpisodeListViewModel({ worldId: 'w', index: index(), filter: NO_FILTER });
    expect(vm.arcOptions).toEqual(['arc-1', 'arc-2']);
    expect(vm.characterOptions).toEqual(['char-a', 'char-b']);
  });

  it('filters episodes by arc (AC#2)', () => {
    const vm = composeEpisodeListViewModel({ worldId: 'w', index: index(), filter: { arc: 'arc-2', character: null } });
    expect(vm.episodes.map((e) => e.worldDay)).toEqual([2, 3]);
  });

  it('filters episodes by character (AC#2)', () => {
    const vm = composeEpisodeListViewModel({ worldId: 'w', index: index(), filter: { arc: null, character: 'char-b' } });
    expect(vm.episodes.map((e) => e.worldDay)).toEqual([2, 3]);
  });

  it('combines arc + character filters (AC#2)', () => {
    const vm = composeEpisodeListViewModel({ worldId: 'w', index: index(), filter: { arc: 'arc-1', character: 'char-b' } });
    expect(vm.episodes.map((e) => e.worldDay)).toEqual([2]);
  });

  it('carries the recommended-entry and turning-point markers through (AC#3)', () => {
    const vm = composeEpisodeListViewModel({ worldId: 'w', index: index(), filter: NO_FILTER });
    const byDay = Object.fromEntries(vm.episodes.map((e) => [e.worldDay, e]));
    expect(byDay[2].isRecommendedEntry).toBe(true);
    expect(byDay[2].isTurningPoint).toBe(true);
    expect(byDay[1].isRecommendedEntry).toBe(false);
    expect(byDay[1].isTurningPoint).toBe(false);
  });

  it('degrades gracefully when the index is null', () => {
    const vm = composeEpisodeListViewModel({ worldId: 'w', index: null, filter: NO_FILTER });
    expect(vm.hasContent).toBe(false);
    expect(vm.episodes).toEqual([]);
    expect(vm.arcOptions).toEqual([]);
    expect(vm.characterOptions).toEqual([]);
  });

  it('shows an empty filtered result without error when no episode matches', () => {
    const vm = composeEpisodeListViewModel({ worldId: 'w', index: index(), filter: { arc: 'arc-9', character: null } });
    expect(vm.hasContent).toBe(true);
    expect(vm.episodes).toEqual([]);
  });
});
