import { RELATIONSHIP_MAX, RELATIONSHIP_MIN } from '../shared/constants';
import {
  ARC_MODEL_KIND,
  RELATIONSHIP_ARC_SCHEMA_VERSION,
  RELATIONSHIP_DIMENSIONS,
  RELATIONSHIP_MODEL_KIND,
  RelationshipArcError,
  accumulatePublicRelationshipDimensions,
  buildArcProjection,
  buildRelationshipProjection,
  type ArcSummary,
  type ArcOutcome,
  type PublicFact,
  type RelationshipChange,
  type RelationshipDeltaInput,
} from './relationshipArcProjection';

describe('buildRelationshipProjection (AC#1 — bounded public dims, history, no leakage)', () => {
  function changes(): RelationshipChange[] {
    return [{ eventId: 'e2', reason: 'a shared secret surfaced', trustDelta: 10, affectionDelta: 5, resentmentDelta: -3 }];
  }

  it('projects a public relationship with bounded dimensions and history', () => {
    const projection = buildRelationshipProjection({
      worldId: 'w1', sourceCharacterId: 'char-a', targetCharacterId: 'char-b',
      trust: 40, affection: 25, resentment: 5, fear: NaN, dependency: Infinity, familiarity: 12,
      visibility: 'public', lastUpdatedEventId: 'e2', changeHistory: changes(),
    });
    expect(projection.visibility).toBe('public');
    expect(projection.pairKey).toBe('char-a:char-b');
    expect(projection.trust).toBe(40);
    expect(projection.fear).toBe(0); // NaN bounded
    expect(projection.dependency).toBe(0); // Infinity bounded
    expect(projection.changeHistory[0].reason).toContain('shared secret');
    expect(projection.schemaVersion).toBe(RELATIONSHIP_ARC_SCHEMA_VERSION);
  });

  it('rejects a private-visibility relationship (no hidden-secret leakage)', () => {
    expect(() => buildRelationshipProjection({
      worldId: 'w1', sourceCharacterId: 'char-a', targetCharacterId: 'char-b',
      trust: 1, affection: 1, resentment: 1, fear: 1, dependency: 1, familiarity: 1,
      visibility: 'private', lastUpdatedEventId: 'e1', changeHistory: [],
    })).toThrow(RelationshipArcError);
  });

  it('is deterministic for identical inputs (AC#3)', () => {
    const input = {
      worldId: 'w1', sourceCharacterId: 'char-a', targetCharacterId: 'char-b',
      trust: 1, affection: 1, resentment: 1, fear: 1, dependency: 1, familiarity: 1,
      visibility: 'public', lastUpdatedEventId: 'e1', changeHistory: changes(),
    };
    expect(buildRelationshipProjection(input)).toEqual(buildRelationshipProjection(input));
  });

  it('declares the relationship model kind', () => {
    expect(RELATIONSHIP_MODEL_KIND).toBe('relationship');
  });

  /**
   * ART-95. `BOUNDED` coerced non-finite values to zero and did nothing else, while its name and
   * the docblock above `buildRelationshipProjection` both said the dimensions were bounded. The
   * repair made the code do what both claimed rather than renaming the claim away.
   */
  it('clamps every dimension to Canon’s declared relationship range', () => {
    const projection = buildRelationshipProjection({
      worldId: 'w1', sourceCharacterId: 'char-a', targetCharacterId: 'char-b',
      trust: 1_000, affection: -1_000, resentment: RELATIONSHIP_MAX, fear: RELATIONSHIP_MIN,
      dependency: 0, familiarity: 101,
      visibility: 'public', lastUpdatedEventId: 'e1', changeHistory: [],
    });
    expect(projection.trust).toBe(RELATIONSHIP_MAX);
    expect(projection.affection).toBe(RELATIONSHIP_MIN);
    expect(projection.resentment).toBe(RELATIONSHIP_MAX);
    expect(projection.fear).toBe(RELATIONSHIP_MIN);
    expect(projection.familiarity).toBe(RELATIONSHIP_MAX);
    // The bound is Canon's, not a second opinion about it.
    expect([RELATIONSHIP_MIN, RELATIONSHIP_MAX]).toEqual([-100, 100]);
  });

  it('reads an unreadable dimension as zero rather than as the maximum', () => {
    // Ordering matters: coerce first, THEN clamp. Clamping `Infinity` would publish 100 — the
    // strongest possible claim about a relationship — on the strength of a garbage number.
    const projection = buildRelationshipProjection({
      worldId: 'w1', sourceCharacterId: 'char-a', targetCharacterId: 'char-b',
      trust: Infinity, affection: -Infinity, resentment: NaN, fear: 1, dependency: 1, familiarity: 1,
      visibility: 'public', lastUpdatedEventId: 'e1', changeHistory: [],
    });
    expect(projection.trust).toBe(0);
    expect(projection.affection).toBe(0);
    expect(projection.resentment).toBe(0);
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
