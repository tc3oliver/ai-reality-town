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
      withheldWorldDays: new Set(),
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
      withheldWorldDays: new Set(),
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
      withheldWorldDays: new Set(),
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
      withheldWorldDays: new Set(),
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
      withheldWorldDays: new Set(),
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
      withheldWorldDays: new Set(),
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
      withheldWorldDays: new Set(),
    })).toThrow();
  });
});

/**
 * The second gate (ART-174), and why `status` was never it.
 *
 * `status` is the SAFETY verdict `dailyEpisodes` recorded at generation. The publication record is
 * an administrator's editorial decision, moved independently since ART-171. Until then the two were
 * indistinguishable here — the only path to a withheld record fired exactly when the row was not
 * `ready` — so this index has never had to ask, and the moment an administrator could withhold a
 * `ready` Episode it went on quoting the day's title and headline while `episode:<day>` was gone.
 */
describe('an administrator withhold reaches the index too', () => {
  it('drops a withheld world day, title and headline included', () => {
    const result = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [
        ep({ worldDay: 1, title: '第一日', headline: '磨坊停工' }),
        ep({ worldDay: 2, title: '第二日', headline: '帳本消失了' }),
      ],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
      withheldWorldDays: new Set([2]),
    });
    expect(result.episodes.map((entry) => entry.worldDay)).toEqual([1]);
    // Not just absent from the list: the text is nowhere in the payload at all.
    expect(JSON.stringify(result)).not.toContain('帳本消失了');
    expect(JSON.stringify(result)).not.toContain('第二日');
  });

  it('drops the withheld day from the arc and character filters as well', () => {
    // The filters are unions over the INDEXED episodes. A withheld day that still contributed an
    // arc id would tell a viewer the day existed by the shape of the filter list.
    const result = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [
        ep({ worldDay: 1, arcIds: ['arc-1'], characterIds: ['char-a'] }),
        ep({ worldDay: 2, arcIds: ['arc-secret'], characterIds: ['char-secret'] }),
      ],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
      withheldWorldDays: new Set([2]),
    });
    expect(result.arcIds).toEqual(['arc-1']);
    expect(result.characterIds).toEqual(['char-a']);
  });

  it('is a SECOND gate, not a replacement for the safety one', () => {
    // Both still apply independently: a safety-withheld row is excluded with no publication
    // decision, and a publication-withheld day is excluded while its row is `ready`.
    const safetyOnly = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [ep({ worldDay: 1, status: 'withheld' })],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
      withheldWorldDays: new Set(),
    });
    expect(safetyOnly.episodes).toEqual([]);

    const publicationOnly = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [ep({ worldDay: 1, status: 'ready' })],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
      withheldWorldDays: new Set([1]),
    });
    expect(publicationOnly.episodes).toEqual([]);
  });

  it('indexes every day when nothing is withheld', () => {
    const result = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [ep({ worldDay: 1 }), ep({ worldDay: 2 })],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
      withheldWorldDays: new Set(),
    });
    expect(result.episodes.map((entry) => entry.worldDay)).toEqual([1, 2]);
  });
});

/**
 * The THIRD gate, and the one that decides what an operator's override actually does (ART-177).
 *
 * `status` here is now the EFFECTIVE safety label, not the frozen `dailyEpisodes.status`. The row
 * records the classifier's verdict at generation and is never rewritten — that immutability is the
 * ledger design's whole point — so it cannot see an override. Passing the frozen value would have
 * left an operator with a control that reported success and changed nothing, which is the exact
 * failure `safetyOverrideFunctions` guards against on its own path by re-reading the ledger.
 */
describe('an operator override of an episode-level decision reaches the index', () => {
  it('drops a day whose effective label is withheld, whatever the row says', () => {
    const result = buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [
        ep({ worldDay: 1, title: '第一日', headline: '磨坊停工' }),
        // The caller resolves the effective label; from the builder's side an overridden Episode
        // is indistinguishable from one the classifier refused at generation, which is correct.
        ep({ worldDay: 2, title: '第二日', headline: '帳本消失了', status: 'withheld' }),
      ],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
      withheldWorldDays: new Set(),
    });
    expect(result.episodes.map((entry) => entry.worldDay)).toEqual([1]);
    expect(JSON.stringify(result)).not.toContain('帳本消失了');
  });

  it('keeps the three gates independent', () => {
    // Safety-at-generation, safety-by-override and editorial publication are three different
    // decisions. Each alone removes the day; none stands in for another.
    const one = (over: { status?: string; withheld?: boolean }) => buildEpisodeIndex({
      worldId: WORLD_ID,
      episodes: [ep({ worldDay: 1, status: over.status ?? 'ready' })],
      recommendedEntryWorldDays: new Set(),
      turningPointEventIds: new Set(),
      withheldWorldDays: over.withheld === true ? new Set([1]) : new Set(),
    }).episodes.length;

    expect(one({})).toBe(1);
    expect(one({ status: 'withheld' })).toBe(0);
    expect(one({ withheld: true })).toBe(0);
  });
});
