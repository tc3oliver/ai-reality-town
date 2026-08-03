/**
 * Unit tests for the public live-view pure logic (ART-68, FR-I002). Covers
 * hash-route resolution and view-model composition — including the AC#4
 * browsability requirement (the page stays usable from the last-known-good
 * snapshot when the simulation is paused or the projection is empty/missing)
 * and the AC#1 text-list shape (character positions resolve to a readable
 * location label, no map/animation).
 *
 * Pure jest (no jsdom): the module under test has no React/Convex/DOM deps.
 */

import { composeLiveViewModel, parseLiveRoute, type LiveProjection } from './liveRoute';

function fixture(overrides: Partial<LiveProjection> = {}): LiveProjection {
  return {
    worldTime: { worldDay: 7, timeSlot: 'evening' },
    locations: [
      { locationId: 'mistwood-market', name: '市集', description: '喧鬧的市集。', locationType: 'public', active: true },
      { locationId: 'mistwood-grove', name: '樹林', description: '幽靜的樹林。', locationType: 'outdoor', active: false },
    ],
    characters: [
      { characterId: 'cassia', locationId: 'mistwood-market', alive: true },
      { characterId: 'rowan', locationId: 'mistwood-grove', alive: true },
      { characterId: 'wanderer', locationId: null, alive: true },
    ],
    recentEvents: [
      { eventId: 'evt-2', summary: '休戰簽訂。', worldDay: 7, timeSlot: 'noon' },
      { eventId: 'evt-1', summary: null, worldDay: 6, timeSlot: 'night' },
    ],
    activeArcs: [{ arcId: 'arc-1', title: '兩家休戰', currentQuestion: '和平能維持多久?', status: 'active' }],
    activeScenes: [{ title: '簽約', summary: '眾人見證休戰。' }],
    publishedEpisodeStatus: 'ready',
    ...overrides,
  };
}

describe('parseLiveRoute', () => {
  it('resolves a #live/<worldId> route', () => {
    expect(parseLiveRoute('#live/mistwood')).toEqual({ worldId: 'mistwood' });
  });
  it('decodes an encoded worldId', () => {
    expect(parseLiveRoute('#live/two%20words')).toEqual({ worldId: 'two words' });
  });
  it('returns null for a bare #live', () => {
    expect(parseLiveRoute('#live')).toBeNull();
    expect(parseLiveRoute('#live/')).toBeNull();
  });
  it('returns null for unrelated hashes', () => {
    expect(parseLiveRoute('#home/mistwood')).toBeNull();
    expect(parseLiveRoute('')).toBeNull();
  });
});

describe('composeLiveViewModel', () => {
  it('composes the full view model from a published projection', () => {
    const vm = composeLiveViewModel({ live: fixture() });
    expect(vm.hasContent).toBe(true);
    expect(vm.worldTime).toEqual({ worldDay: 7, timeSlot: 'evening' });
    expect(vm.locations).toHaveLength(2);
    expect(vm.activeScenes).toEqual([{ title: '簽約', summary: '眾人見證休戰。' }]);
    expect(vm.activeArcs).toHaveLength(1);
  });

  it('renders a text location list — no map/animation data (AC#1)', () => {
    const vm = composeLiveViewModel({ live: fixture() });
    for (const location of vm.locations) {
      expect(typeof location.name).toBe('string');
      expect(location.active).toBeDefined();
    }
  });

  it('resolves character positions to a readable location label (AC#1)', () => {
    const vm = composeLiveViewModel({ live: fixture() });
    const byId = Object.fromEntries(vm.characterPositions.map((c) => [c.characterId, c]));
    expect(byId.cassia.locationLabel).toBe('市集');
    expect(byId.rowan.locationLabel).toBe('樹林');
    // A character with no location falls back to a readable placeholder.
    expect(byId.wanderer.locationLabel).toBe('未知位置');
  });

  it('keeps active scenes as summaries only (AC#2)', () => {
    const vm = composeLiveViewModel({ live: fixture() });
    const scene = vm.activeScenes[0];
    expect(Object.keys(scene).sort()).toEqual(['summary', 'title']);
  });

  it('fills a null event summary with a placeholder so the list never shows raw ids alone', () => {
    const vm = composeLiveViewModel({ live: fixture() });
    const noSummary = vm.recentEvents.find((e) => e.eventId === 'evt-1');
    expect(noSummary?.summary).toBe('(無摘要)');
  });

  it('stays browsable with empty arrays (AC#4 — paused/quiet world)', () => {
    const quiet = fixture({
      worldTime: { worldDay: 7, timeSlot: 'night' },
      characters: [], recentEvents: [], activeArcs: [], activeScenes: [],
      publishedEpisodeStatus: 'paused',
    });
    const vm = composeLiveViewModel({ live: quiet });
    // Locations still render; the page is browsable from the last snapshot.
    expect(vm.locations).toHaveLength(2);
    expect(vm.characterPositions).toEqual([]);
    expect(vm.hasContent).toBe(true);
  });

  it('stays browsable when the projection is null (AC#4 — never blanks the page)', () => {
    const vm = composeLiveViewModel({ live: null });
    expect(vm.hasContent).toBe(false);
    expect(vm.worldTime).toBeNull();
    expect(vm.locations).toEqual([]);
    expect(vm.characterPositions).toEqual([]);
    expect(vm.activeScenes).toEqual([]);
  });
});
