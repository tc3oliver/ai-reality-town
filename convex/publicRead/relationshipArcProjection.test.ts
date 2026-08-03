import {
  ARC_MODEL_KIND,
  RELATIONSHIP_ARC_SCHEMA_VERSION,
  RELATIONSHIP_MODEL_KIND,
  RelationshipArcError,
  buildArcProjection,
  buildRelationshipProjection,
  type ArcSummary,
  type ArcOutcome,
  type PublicFact,
  type RelationshipChange,
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
