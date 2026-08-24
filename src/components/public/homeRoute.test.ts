import { readFileSync } from 'node:fs';

import { MISTWOOD_CHARACTER_VISUALS } from '../../../data/mistwoodCharacters';

/**
 * Unit tests for the pure homepage logic (ART-41, FR-I001). Covers hash-route
 * resolution and view-model composition — including every graceful-fallback
 * state so the P0 homepage never breaks when a published model is missing
 * (AC#5) and the newcomer disclosure stays bounded (AC#4/UX-002).
 *
 * Pure jest (no jsdom): the module under test has no React/Convex/DOM deps.
 */

import {
  HOME_ARC_STATUS_PRIORITY,
  HOME_MAX_CHARACTERS,
  HOME_MAX_FACTS,
  HOME_MAX_SCENES,
  composeHomepageViewModel,
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

/** The deployment prefix Vite builds with (`vite.config.ts` sets `base: '/ai-town'`). */
const BASE = '/ai-town/';
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
    const vm = composeHomepageViewModel({ worldId: 'mistwood', summary: summary(), world, live, base: BASE });
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
    const vm = composeHomepageViewModel({ worldId: 'w', summary: summary(), world, live, base: BASE });
    expect(vm.majorEvent).not.toBeNull();
  });

  it('bounds newcomer disclosure to at most four characters (UX-002/AC#4)', () => {
    const many = summary({
      structured: {
        ...summary().structured,
        characters: Array.from({ length: 8 }, (_, i) => ({ characterId: `c${i}`, name: `角色${i}` })),
      },
    });
    const vm = composeHomepageViewModel({ worldId: 'w', summary: many, world, live, base: BASE });
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
    const vm = composeHomepageViewModel({ worldId: 'w', summary: many, world, live, base: BASE });
    expect(vm.facts).toHaveLength(HOME_MAX_FACTS);
    expect(HOME_MAX_FACTS).toBe(3);
  });

  it('votes are always unavailable (ART-45 not built) without blocking (AC#5)', () => {
    const vm = composeHomepageViewModel({ worldId: 'w', summary: summary(), world, live, base: BASE });
    expect(vm.voteAvailable).toBe(false);
  });

  it('degrades gracefully when the onboarding summary is missing (AC#5)', () => {
    const vm = composeHomepageViewModel({ worldId: 'w', summary: null, world, live, base: BASE });
    expect(vm.majorEvent).toBeNull();
    expect(vm.currentSituation).toBe('摘要尚不可用。');
    expect(vm.characters).toEqual([]);
    expect(vm.facts).toEqual([]);
    expect(vm.recommendedEpisode).toBeNull();
  });

  it('degrades gracefully when the world projection is missing (AC#5)', () => {
    const vm = composeHomepageViewModel({ worldId: 'w', summary: summary(), world: null, live, base: BASE });
    expect(vm.worldName).toBe('這個世界');
    expect(vm.worldDay).toBe('—');
    expect(vm.timeSlot).toBe('—');
  });

  it('degrades gracefully when the live projection is missing (AC#5)', () => {
    const vm = composeHomepageViewModel({ worldId: 'w', summary: summary(), world, live: null, base: BASE });
    expect(vm.live).toBeNull();
  });

  it('omits a recommended-episode link when none is published', () => {
    const noRec = summary({ structured: { ...summary().structured, recommendedEpisode: null } });
    const vm = composeHomepageViewModel({ worldId: 'w', summary: noRec, world, live, base: BASE });
    expect(vm.recommendedEpisode).toBeNull();
  });

  it('renders safely with every projection missing', () => {
    const vm = composeHomepageViewModel({ worldId: 'w', summary: null, world: null, live: null, base: BASE });
    expect(vm.worldName).toBe('這個世界');
    expect(vm.majorEvent).toBeNull();
    expect(vm.live).toBeNull();
    expect(vm.characters).toEqual([]);
  });
});

/**
 * The homepage first screen (FR-P001 / ART-129).
 */
describe('the first screen (FR-P001 / ART-129)', () => {
  const WORLD = 'mistwood';

  function vm(live?: Partial<Parameters<typeof composeHomepageViewModel>[0]['live']>) {
    return composeHomepageViewModel({
      worldId: WORLD,
      summary: {
        summaryText: '磨坊之爭正在升溫。',
        structured: {
          majorEvent: { eventId: 'e1', publicSummary: '審計被要求公開。' },
          importance: 4,
          characters: [
            { characterId: 'he-jun', name: '何俊' },
            { characterId: 'lin-yingxue', name: '林映雪' },
          ],
          facts: [],
          question: null,
          recommendedEpisode: { episodeNumber: 3, worldDay: 2 },
        },
      },
      world: { name: '霧林鎮', currentWorldDay: 5, currentTimeSlot: '午後' },
      live: { worldTime: { worldDay: 5, timeSlot: '午後' }, ...live } as never,
      base: '/ai-town/',
    });
  }

  test('AC#4 — a character carries the sprite key the live map draws them with', () => {
    // Read from the SAME binding table the map resolves, so the two surfaces cannot disagree
    // about who draws with what. Compared against the table rather than against a literal 'f4',
    // which would keep passing if the binding were reassigned.
    for (const character of vm().characters) {
      const binding = MISTWOOD_CHARACTER_VISUALS
        .find((visual) => visual.characterId === character.characterId);
      expect(character.spriteKey).toBe(binding?.spriteKey);
      expect(character.spriteKey).toBeTruthy();
    }
  });

  test('AC#5 — a character links to their own page', () => {
    expect(vm().characters.map((c) => c.href)).toEqual([
      `#character/${WORLD}/he-jun`,
      `#character/${WORLD}/lin-yingxue`,
    ]);
  });

  test('AC#2 — the primary arc is the highest-priority one, not the first published', () => {
    const model = vm({
      activeArcs: [
        { arcId: 'arc-b', title: '收束', currentQuestion: '?', status: 'resolving' },
        { arcId: 'arc-a', title: '高潮', currentQuestion: '撐得過冬天嗎?', status: 'climax' },
      ],
    });
    expect(model.primaryArc?.arcId).toBe('arc-a');
    expect(model.primaryArc?.statusLabel).toBe('高潮');
    expect(model.primaryArc?.href).toBe(`#arc/${WORLD}/arc-a`);
  });

  test('the arc choice is deterministic and total', () => {
    // Ties broken by arcId, so the same payload always yields the same lead arc regardless of
    // the order the backend published them in.
    const tied = vm({
      activeArcs: [
        { arcId: 'b', title: 'B', currentQuestion: '', status: 'active' },
        { arcId: 'a', title: 'A', currentQuestion: '', status: 'active' },
      ],
    });
    expect(tied.primaryArc?.arcId).toBe('a');
    // An unknown status ranks last but stays ELIGIBLE: a lifecycle stage added later must degrade
    // to "sorted last", never to "disappears from the homepage".
    const unknown = vm({ activeArcs: [{ arcId: 'x', title: 'X', currentQuestion: '', status: 'brand-new' }] });
    expect(unknown.primaryArc?.arcId).toBe('x');
    expect(unknown.primaryArc?.statusLabel).toBe('brand-new');
  });

  test('a malformed live payload degrades the first screen instead of blanking the page', () => {
    // The payload is an untyped published model. `Array.isArray` rather than `?? []` because a
    // non-array would throw on `.slice` and take the whole homepage down with it.
    for (const broken of [{ activeArcs: 'nope' }, { activeScenes: 42 }, { activeArcs: null }]) {
      const model = vm(broken as never);
      expect(model.primaryArc).toBeNull;
      expect(Array.isArray(model.activeScenes)).toBe(true);
      // ...and the rest of the screen survived.
      expect(model.currentSituation).toContain('磨坊');
    }
  });

  test('scenes are bounded and link to the day they belong to', () => {
    const model = vm({
      activeScenes: [
        { title: 'A', summary: 'a', sceneId: '5:午後:mill' },
        { title: 'B', summary: 'b', sceneId: '5:午後:hall' },
        { title: 'C', summary: 'c', sceneId: '5:午後:inn' },
      ],
    });
    expect(model.activeScenes).toHaveLength(HOME_MAX_SCENES);
    expect(model.activeScenes[0].href).toBe(`#episode/${WORLD}/5`);
  });

  test('the arc ordering is IDENTICAL to the live overlay’s, which it restates', () => {
    // `clientPublic` may not depend on `clientLive`, and the reverse edge already exists — so the
    // table is restated rather than imported. A restatement that drifted would have the homepage
    // and the live overlay naming DIFFERENT arcs as "the" story, which is worse than either
    // naming none. Read as source text, which costs no dependency.
    const overlay = readFileSync(
      new URL('../live/storyOverlayModel.ts', import.meta.url),
      'utf8',
    );
    const priority = overlay.match(/STORY_ARC_STATUS_PRIORITY: readonly string\[\] = \[([^\]]*)\]/);
    expect(priority).not.toBeNull();
    const theirs = [...(priority as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(theirs.length).toBeGreaterThan(0);
    expect([...HOME_ARC_STATUS_PRIORITY]).toEqual(theirs);

    // ...and so are the labels, so the same arc is not called 「高潮」 on one page and something
    // else on the other.
    const labels = overlay.match(/ARC_STATUS_LABELS: Readonly<Record<string, string>> = \{([^}]*)\}/);
    for (const [, status, label] of (labels as RegExpMatchArray)[1].matchAll(/(\w+):\s*'([^']+)'/g)) {
      const model = vm({ activeArcs: [{ arcId: 'a', title: 'T', currentQuestion: '', status }] });
      expect(model.primaryArc?.statusLabel).toBe(label);
    }
  });
});
