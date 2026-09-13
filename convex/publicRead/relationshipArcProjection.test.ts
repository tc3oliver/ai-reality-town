import { RELATIONSHIP_MAX, RELATIONSHIP_MIN } from '../shared/constants';
import {
  ARC_MODEL_KIND,
  RELATIONSHIP_ARC_SCHEMA_VERSION,
  RELATIONSHIP_DIMENSIONS,
  RelationshipArcError,
  accumulatePublicRelationshipDimensions,
  buildArcProjection,
  type ArcSummary,
  type ArcOutcome,
  type PublicFact,
  type RelationshipDeltaInput,
} from './relationshipArcProjection';
// The whole namespace as well as the named imports: one test below asserts what is NOT exported,
// which a named import cannot do — it would fail to compile rather than fail as a test.
import * as relationshipArcProjection from './relationshipArcProjection';

/**
 * ART-182 removed the per-pair publication this file used to open with.
 *
 * `buildRelationshipProjection` shaped a `relationship:<pairKey>` read model that nothing read, and
 * the seven tests that stood here covered its payload: the pair key, the change history, the
 * private-visibility rejection, and ART-95's clamp. They are not moved, because their subject is
 * gone — but two of the things they protected are still live, and each has a home:
 *
 * - **The clamp** is tested below, through {@link accumulatePublicRelationshipDimensions}, which is
 *   now its only caller and is what the FR-I007 graph folds a pair's public history with.
 * - **The private-visibility rejection** is tested in `relationshipGraphProjection.test.ts`. It was
 *   asserted in two places while two builders enforced it; one builder is gone, so one assertion
 *   went with it rather than being retargeted at the survivor it was never about.
 */
describe('the per-pair relationship publication is gone, not merely unused (ART-182)', () => {
  it('exports no builder and no model kind for it', () => {
    const exported = Object.keys(relationshipArcProjection);
    expect(exported).not.toContain('buildRelationshipProjection');
    expect(exported).not.toContain('RELATIONSHIP_MODEL_KIND');
    // ...and the dimension rules the graph reuses are still here, which is the whole distinction:
    // the PRD asks for the public projection shape, not for a published model per pair.
    expect(exported).toContain('accumulatePublicRelationshipDimensions');
    expect(exported).toContain('RELATIONSHIP_DIMENSIONS');
  });

  /**
   * ART-95, re-anchored. `BOUNDED` coerced non-finite values to zero and did nothing else, while
   * its name and its docblock both said the dimensions were bounded. The repair made the code do
   * what both claimed. The claim is still live — Canon's reducer clamps to exactly this range, so a
   * published level outside it could not correspond to any state the world is in — so it is still
   * asserted, now against the surviving caller.
   */
  it('clamps an accumulated level to Canon’s declared relationship range', () => {
    const levels = accumulatePublicRelationshipDimensions([
      { trustDelta: 1_000, affectionDelta: -1_000, resentmentDelta: 0, familiarityDelta: 1_000 },
    ]);
    expect(levels.trust).toBe(RELATIONSHIP_MAX);
    expect(levels.affection).toBe(RELATIONSHIP_MIN);
    expect(levels.familiarity).toBe(RELATIONSHIP_MAX);
    // The bound is Canon's, not a second opinion about it.
    expect([RELATIONSHIP_MIN, RELATIONSHIP_MAX]).toEqual([-100, 100]);
  });

  it('reads an unreadable delta as zero rather than as the maximum', () => {
    // Ordering matters: coerce first, THEN clamp. Clamping `Infinity` would publish 100 — the
    // strongest possible claim about a relationship — on the strength of a garbage number.
    const levels = accumulatePublicRelationshipDimensions([
      { trustDelta: Infinity, affectionDelta: -Infinity, resentmentDelta: NaN },
    ]);
    expect(levels).toEqual({
      trust: 0, affection: 0, resentment: 0, fear: 0, dependency: 0, familiarity: 0,
    });
  });
});

/**
 * ART-95 — the published CURRENT dimensions are accumulated levels, not the last event's delta.
 *
 * `rebuildRelationshipProjection` assigned `trust: change.trustDelta` (and the same for the other
 * five dimensions) inside a loop that overwrote its accumulator on every match, so a pair that
 * moved +5, +5, +5 published `trust: 5`, and a pair that moved +50 then -1 published `trust: -1`.
 *
 * NO EXISTING TEST PINNED THAT BEHAVIOUR — the pure builder was always handed levels and had no
 * way to know it was being handed deltas, and there was no test file for the wiring at all. That
 * is why the defect survived: the seam it lived on was the one place nothing looked.
 *
 * Every case below fails on the delta-as-level implementation. The first two are the exact
 * numbers from the defect report.
 */
describe('accumulatePublicRelationshipDimensions (ART-95 — levels, not the last delta)', () => {
  const delta = (over: Partial<RelationshipDeltaInput> = {}): RelationshipDeltaInput => ({
    trustDelta: 0, affectionDelta: 0, resentmentDelta: 0,
    fearDelta: 0, dependencyDelta: 0, familiarityDelta: 0, ...over,
  });

  it('sums repeated gains instead of publishing the last one (+5,+5,+5 is 15, not 5)', () => {
    const levels = accumulatePublicRelationshipDimensions([
      delta({ trustDelta: 5 }), delta({ trustDelta: 5 }), delta({ trustDelta: 5 }),
    ]);
    expect(levels.trust).toBe(15);
  });

  it('a small setback after a large gain is a setback, not a reversal (+50 then -1 is 49, not -1)', () => {
    const levels = accumulatePublicRelationshipDimensions([
      delta({ trustDelta: 50 }), delta({ trustDelta: -1 }),
    ]);
    expect(levels.trust).toBe(49);
  });

  it('accumulates all six dimensions, not only the three the change type names first', () => {
    // The three additive v1 fields were as wrong as the original three, and would have stayed
    // wrong under a fix that only read `trustDelta`/`affectionDelta`/`resentmentDelta`.
    const levels = accumulatePublicRelationshipDimensions([
      delta({
        trustDelta: 1, affectionDelta: 2, resentmentDelta: 3,
        fearDelta: 4, dependencyDelta: 5, familiarityDelta: 6,
      }),
      delta({
        trustDelta: 1, affectionDelta: 2, resentmentDelta: 3,
        fearDelta: 4, dependencyDelta: 5, familiarityDelta: 6,
      }),
    ]);
    expect(levels).toEqual({
      trust: 2, affection: 4, resentment: 6, fear: 8, dependency: 10, familiarity: 12,
    });
    // Nothing is silently dropped: every declared dimension has an entry.
    expect(Object.keys(levels).sort()).toEqual([...RELATIONSHIP_DIMENSIONS].sort());
  });

  it('treats an omitted additive delta as zero, as the reducer does', () => {
    const levels = accumulatePublicRelationshipDimensions([
      { trustDelta: 3, affectionDelta: 0, resentmentDelta: 0 },
    ]);
    expect(levels).toEqual({
      trust: 3, affection: 0, resentment: 0, fear: 0, dependency: 0, familiarity: 0,
    });
  });

  it('clamps at every step, so a run past the ceiling and back reads the same as Canon', () => {
    // Clamping only the final sum would read 150 - 10 = 140 -> 100 here; clamping per step reads
    // 100 - 10 = 90, which is what `convex/canon/reducer.ts` produces.
    const levels = accumulatePublicRelationshipDimensions([
      delta({ trustDelta: 150 }), delta({ trustDelta: -10 }),
    ]);
    expect(levels.trust).toBe(90);
  });

  it('floors familiarity at zero — two people cannot know each other less than not at all', () => {
    const levels = accumulatePublicRelationshipDimensions([delta({ familiarityDelta: -20 })]);
    expect(levels.familiarity).toBe(0);
  });

  it('is the identity on an empty history', () => {
    expect(accumulatePublicRelationshipDimensions([])).toEqual({
      trust: 0, affection: 0, resentment: 0, fear: 0, dependency: 0, familiarity: 0,
    });
  });

  it('is deterministic and order-dependent in the way an append-only fold must be', () => {
    const history = [delta({ trustDelta: 7 }), delta({ trustDelta: -3 })];
    expect(accumulatePublicRelationshipDimensions(history))
      .toEqual(accumulatePublicRelationshipDimensions(history));
  });
});

describe('buildArcProjection (AC#2 — all FR-I006 fields; outcome when resolved)', () => {
  function arc(over: Partial<ArcSummary> = {}): ArcSummary {
    return {
      arcId: 'arc-1', title: 'The Feud', premise: 'Two families clash.', currentQuestion: 'Who backs down?',
      status: 'active', coreCharacterIds: ['char-a', 'char-b'], incitingEventId: 'e1',
      latestTurningPointEventId: 'e5', unresolvedQuestions: ['Will it last?'], ...over,
    };
  }
  function facts(): PublicFact[] {
    return [{ factId: 'f1', predicate: 'motive', value: 'revenge', sourceEventId: 'e1' }];
  }

  it('exposes every FR-I006 field and omits outcome for an unresolved arc', () => {
    const projection = buildArcProjection({
      worldId: 'w1', arc: arc(),
      essentialBackstory: facts(), recommendedEntry: { episodeNumber: 2, worldDay: 2 },
      relatedEpisodes: [{ episodeNumber: 3, worldDay: 3 }, { episodeNumber: 1, worldDay: 1 }],
      knownClues: facts(), outcome: null,
    });
    expect(projection.title).toBe('The Feud');
    expect(projection.coreCharacterIds).toEqual(['char-a', 'char-b']);
    expect(projection.incitingEventId).toBe('e1');
    expect(projection.latestTurningPointEventId).toBe('e5');
    expect(projection.recommendedEntry).toEqual({ episodeNumber: 2, worldDay: 2 });
    expect(projection.relatedEpisodes.map((e) => e.episodeNumber)).toEqual([1, 3]); // sorted
    expect(projection.outcome).toBeNull();
  });

  it('attaches the outcome when the arc is resolved', () => {
    const outcome: ArcOutcome = { summary: 'A fragile truce held.', sourceEventIds: ['e9'] };
    const projection = buildArcProjection({
      worldId: 'w1', arc: arc({ status: 'resolved' }),
      essentialBackstory: [], recommendedEntry: null, relatedEpisodes: [], knownClues: [], outcome,
    });
    expect(projection.outcome).toEqual({ summary: 'A fragile truce held.', sourceEventIds: ['e9'] });
  });

  it('is deterministic for identical inputs (AC#3)', () => {
    const input = { worldId: 'w1', arc: arc(), essentialBackstory: facts(), recommendedEntry: null, relatedEpisodes: [], knownClues: facts(), outcome: null };
    expect(buildArcProjection(input)).toEqual(buildArcProjection(input));
  });

  it('declares the arc model kind', () => {
    expect(ARC_MODEL_KIND).toBe('arc');
  });
});
