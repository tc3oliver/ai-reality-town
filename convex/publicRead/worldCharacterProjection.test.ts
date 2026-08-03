import {
  assertNoForbiddenCharacterFields,
  buildCharacterProjection,
  buildWorldProjection,
  CHARACTER_ALLOWED_FIELDS,
  CHARACTER_FORBIDDEN_FIELDS,
  ProjectionError,
  WORLD_ALLOWED_FIELDS,
  type PublicFact,
} from './worldCharacterProjection';

describe('buildWorldProjection (AC#1 — publication-safe day/time/environment/public facts)', () => {
  it('projects only allowed World fields and attaches public facts', () => {
    const source = {
      name: 'Mistwood', description: 'A foggy town', status: 'running',
      currentWorldDay: 7, currentTimeSlot: 'evening', simulationMode: 'public',
      publicLaunchDay: 1, createdAt: 100, updatedAt: 200,
      adminNotes: 'secret ops', internalSeed: 42,
    };
    const facts: PublicFact[] = [
      { factId: 'f1', subjectType: 'world', subjectId: 'w1', predicate: 'mood', value: 'tense', validFromEventId: 'e1' },
    ];
    const projection = buildWorldProjection({ worldId: 'w1', source, publicFacts: facts });
    expect(projection.name).toBe('Mistwood');
    expect(projection.currentWorldDay).toBe(7);
    expect(projection.publicFacts).toEqual(facts);
    expect(Object.keys(projection)).not.toContain('adminNotes');
    expect(Object.keys(projection)).not.toContain('internalSeed');
  });

  it('is deterministic for identical inputs (AC#3)', () => {
    const source = { name: 'X', currentWorldDay: 1 };
    const a = buildWorldProjection({ worldId: 'w1', source, publicFacts: [] });
    const b = buildWorldProjection({ worldId: 'w1', source, publicFacts: [] });
    expect(a).toEqual(b);
  });

  it('rejects an empty worldId', () => {
    expect(() => buildWorldProjection({ worldId: ' ', source: {}, publicFacts: [] })).toThrow(ProjectionError);
  });

  it('declares exactly the §13.1 World allowlist', () => {
    expect(WORLD_ALLOWED_FIELDS).toEqual([
      'name', 'description', 'status', 'currentWorldDay', 'currentTimeSlot',
      'simulationMode', 'publicLaunchDay', 'createdAt', 'updatedAt',
    ]);
  });
});

describe('buildCharacterProjection (AC#2 — every allowed field in, every forbidden field out)', () => {
  function fullSource(): Record<string, unknown> {
    return {
      id: 'char-a',
      name: 'Elara',
      age: 34,
      occupation: 'Innkeeper',
      publicProfile: 'Warm and watchful.',
      privateProfile: 'SECRET: fears the river.',
      personality: 'guarded',
      values: 'loyalty',
      publicGoal: 'Keep the inn safe.',
      privateGoal: 'SECRET: find her missing brother.',
      fear: 'drowning',
      behaviorRules: 'greets every guest',
      currentLocationId: 'loc-1',
      healthState: 'healthy',
      emotionalState: 'wary',
      financialState: 'stable',
      alive: true,
      active: true,
      knowledge: { factReference: 'SECRET private knowledge' },
      memory: { content: 'SECRET raw memory' },
    };
  }

  it('exposes every allowed field', () => {
    const projection = buildCharacterProjection({ worldId: 'w1', source: fullSource() });
    for (const field of CHARACTER_ALLOWED_FIELDS) {
      expect(projection).toHaveProperty(field);
    }
    expect(projection.name).toBe('Elara');
    expect(projection.publicGoal).toBe('Keep the inn safe.');
    expect(projection.alive).toBe(true);
  });

  it('excludes every forbidden field server-side (AC#2)', () => {
    const projection = buildCharacterProjection({ worldId: 'w1', source: fullSource() }) as unknown as Record<string, unknown>;
    for (const forbidden of CHARACTER_FORBIDDEN_FIELDS) {
      expect(projection[forbidden]).toBeUndefined();
    }
    expect(projection.privateProfile).toBeUndefined();
    expect(projection.privateGoal).toBeUndefined();
    expect(projection.knowledge).toBeUndefined();
    expect(projection.memory).toBeUndefined();
    expect(() => assertNoForbiddenCharacterFields(projection)).not.toThrow();
  });

  it('defaults alive/active to true when absent', () => {
    const projection = buildCharacterProjection({ worldId: 'w1', source: { id: 'char-b' } });
    expect(projection.alive).toBe(true);
    expect(projection.active).toBe(true);
  });

  it('is deterministic for identical inputs (AC#3)', () => {
    const a = buildCharacterProjection({ worldId: 'w1', source: fullSource() });
    const b = buildCharacterProjection({ worldId: 'w1', source: fullSource() });
    expect(a).toEqual(b);
  });

  it('rejects a source without a character id', () => {
    expect(() => buildCharacterProjection({ worldId: 'w1', source: { name: 'x' } })).toThrow(ProjectionError);
  });

  it('declares the §13.2 Character allowlist minus private fields', () => {
    expect(CHARACTER_ALLOWED_FIELDS).toEqual([
      'name', 'age', 'occupation', 'publicProfile', 'personality', 'values',
      'publicGoal', 'fear', 'behaviorRules', 'currentLocationId', 'healthState',
      'emotionalState', 'financialState', 'alive', 'active',
    ]);
    expect(CHARACTER_FORBIDDEN_FIELDS).toEqual(['privateProfile', 'privateGoal', 'knowledge', 'memory']);
  });
});
