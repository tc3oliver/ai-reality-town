/**
 * Unit tests for the pure homepage logic (ART-41, FR-I001). Covers hash-route
 * resolution and view-model composition — including every graceful-fallback
 * state so the P0 homepage never breaks when a published model is missing
 * (AC#5) and the newcomer disclosure stays bounded (AC#4/UX-002).
 *
 * Pure jest (no jsdom): the module under test has no React/Convex/DOM deps.
 */

import {
  composeHomepageViewModel,
  HOME_MAX_CHARACTERS,
  HOME_MAX_FACTS,
  parseHomeRoute,
  type HomeLiveProjection,
  type HomeOnboardingSummary,
  type HomeWorldProjection,
} from './homeRoute';

function summary(overrides: Partial<HomeOnboardingSummary> = {}): HomeOnboardingSummary {
  return {
    summaryText: '近期大事:休戰協議簽訂。',
    structured: {
      majorEvent: { eventId: 'evt-1', publicSummary: '兩大家族簽下休戰協議。' },
      importance: 0.9,
      characters: [
        { characterId: 'char-a', name: '艾拉' },
        { characterId: 'char-b', name: '布萊恩' },
        { characterId: 'char-c', name: '茜拉' },
      ],
      facts: [
        { factId: 'f1', predicate: '休戰', value: '締結' },
        { factId: 'f2', predicate: '河岸', value: '封鎖' },
      ],
      question: '和平能維持多久?',
      recommendedEpisode: { episodeNumber: 3, worldDay: 3 },
    },
    ...overrides,
  };
}

const world: HomeWorldProjection = { name: '迷霧鎮', currentWorldDay: 7, currentTimeSlot: 'evening' };
const live: HomeLiveProjection = { worldTime: { worldDay: 7, timeSlot: 'evening' } };

describe('parseHomeRoute', () => {
  it('resolves a #home/<worldId> route', () => {
    expect(parseHomeRoute('#home/mistwood')).toEqual({ worldId: 'mistwood' });
  });

  it('decodes an encoded worldId', () => {
    expect(parseHomeRoute('#home/two%20words')).toEqual({ worldId: 'two words' });
  });

  it('returns null for a bare #home (no world discovery yet)', () => {
    expect(parseHomeRoute('#home')).toBeNull();
    expect(parseHomeRoute('#home/')).toBeNull();
  });

  it('returns null for unrelated hashes', () => {
    expect(parseHomeRoute('#episode/mistwood/3')).toBeNull();
    expect(parseHomeRoute('')).toBeNull();
    expect(parseHomeRoute('#character/char-a')).toBeNull();
  });
});

describe('composeHomepageViewModel', () => {
  it('composes the full view model from published projections', () => {
    const vm = composeHomepageViewModel({ worldId: 'mistwood', summary: summary(), world, live });
    expect(vm.worldName).toBe('迷霧鎮');
    expect(vm.worldDay).toBe('7');
    expect(vm.timeSlot).toBe('evening');
    expect(vm.majorEvent).toBe('兩大家族簽下休戰協議。');
    expect(vm.currentSituation).toBe('近期大事:休戰協議簽訂。');
    expect(vm.characters).toHaveLength(3);
    expect(vm.facts.map((f) => f.label)).toEqual(['休戰:締結', '河岸:封鎖']);
    expect(vm.recommendedEpisode).toEqual({
      episodeNumber: 3, worldDay: 3, href: '#episode/mistwood/3',
    });
    expect(vm.live).toEqual({ worldDay: 7, timeSlot: 'evening' });
  });

  it('prioritises the major event as a discrete field (UX-001/AC#2)', () => {
    const vm = composeHomepageViewModel({ worldId: 'w', summary: summary(), world, live });
    expect(vm.majorEvent).not.toBeNull();
  });

  it('bounds newcomer disclosure to at most four characters (UX-002/AC#4)', () => {
    const many = summary({
      structured: {
        ...summary().structured,
        characters: Array.from({ length: 8 }, (_, i) => ({ characterId: `c${i}`, name: `角色${i}` })),
      },
    });
    const vm = composeHomepageViewModel({ worldId: 'w', summary: many, world, live });
    expect(vm.characters).toHaveLength(HOME_MAX_CHARACTERS);
    expect(HOME_MAX_CHARACTERS).toBe(4);
  });

  it('bounds newcomer disclosure to at most three facts (UX-002/AC#4)', () => {
    const many = summary({
      structured: {
        ...summary().structured,
        facts: Array.from({ length: 6 }, (_, i) => ({ factId: `f${i}`, predicate: `p${i}`, value: i })),
      },
    });
    const vm = composeHomepageViewModel({ worldId: 'w', summary: many, world, live });
    expect(vm.facts).toHaveLength(HOME_MAX_FACTS);
    expect(HOME_MAX_FACTS).toBe(3);
  });

  it('votes are always unavailable (ART-45 not built) without blocking (AC#5)', () => {
    const vm = composeHomepageViewModel({ worldId: 'w', summary: summary(), world, live });
    expect(vm.voteAvailable).toBe(false);
  });

  it('degrades gracefully when the onboarding summary is missing (AC#5)', () => {
    const vm = composeHomepageViewModel({ worldId: 'w', summary: null, world, live });
    expect(vm.majorEvent).toBeNull();
    expect(vm.currentSituation).toBe('摘要尚不可用。');
    expect(vm.characters).toEqual([]);
    expect(vm.facts).toEqual([]);
    expect(vm.recommendedEpisode).toBeNull();
  });

  it('degrades gracefully when the world projection is missing (AC#5)', () => {
    const vm = composeHomepageViewModel({ worldId: 'w', summary: summary(), world: null, live });
    expect(vm.worldName).toBe('這個世界');
    expect(vm.worldDay).toBe('—');
    expect(vm.timeSlot).toBe('—');
  });

  it('degrades gracefully when the live projection is missing (AC#5)', () => {
    const vm = composeHomepageViewModel({ worldId: 'w', summary: summary(), world, live: null });
    expect(vm.live).toBeNull();
  });

  it('omits a recommended-episode link when none is published', () => {
    const noRec = summary({ structured: { ...summary().structured, recommendedEpisode: null } });
    const vm = composeHomepageViewModel({ worldId: 'w', summary: noRec, world, live });
    expect(vm.recommendedEpisode).toBeNull();
  });

  it('renders safely with every projection missing', () => {
    const vm = composeHomepageViewModel({ worldId: 'w', summary: null, world: null, live: null });
    expect(vm.worldName).toBe('這個世界');
    expect(vm.majorEvent).toBeNull();
    expect(vm.live).toBeNull();
    expect(vm.characters).toEqual([]);
  });
});
