import { readFileSync } from 'node:fs';
import { SUPPORTED_SCHEMA_VERSIONS } from '../shared/constants';
import { isCanonError } from '../shared/errors';
import { emptyProjection, type AcceptedEvent, type WorldProjection } from './model';
import { reduceWorldEvent } from './reducer';

function accepted(sequenceNumber = 0): AcceptedEvent {
  return {
    schemaVersion: 1,
    worldId: 'w',
    idempotencyKey: `event-${sequenceNumber}`,
    proposedBy: { type: 'system' },
    worldDay: 3,
    timeSlot: 'evening',
    eventType: 'world_event',
    locationId: 'square',
    participantIds: ['a', 'b'],
    causedByEventIds: ['prior'],
    stateChanges: [
      { type: 'character_location_changed', characterId: 'a', fromLocationId: 'station', toLocationId: 'square' },
      { type: 'relationship_changed', sourceCharacterId: 'a', targetCharacterId: 'b', trustDelta: 4, affectionDelta: -2, resentmentDelta: 1, fearDelta: 2, dependencyDelta: 3, familiarityDelta: 5, reason: 'witnessed event', visibility: 'private' },
      { type: 'fact_created', subjectType: 'world', subjectId: 'w', predicate: 'weather', value: 'rain', visibility: 'canon' },
      { type: 'character_life_changed', characterId: 'a', alive: false, reason: 'fatal event' },
      { type: 'character_knowledge_learned', characterId: 'b', factId: 'weather-rain', sourceType: 'observed', sourceEventId: 'prior' },
      { type: 'character_memory_formed', characterId: 'b', content: 'Rain began.', interpretation: 'The storm felt ominous.', importance: 0.7, emotionalWeight: -0.4, confidence: 0.8, visibility: 'private' },
      { type: 'item_transferred', itemId: 'ledger', fromOwnerId: 'a', toOwnerId: 'b', reason: 'entrusted' },
      { type: 'character_state_changed', characterId: 'b', field: 'availability', toValue: 'busy', reason: 'accepted duty' },
    ],
    eventId: `w#event#${sequenceNumber}`,
    sequenceNumber,
    acceptedAt: 1234,
    validationVersion: 'canon-v1',
    traceId: `trace-${sequenceNumber}`,
  };
}

function initial(): WorldProjection {
  return {
    ...emptyProjection('w'),
    characterLocations: { a: 'station', b: 'square' },
    characterAlive: { a: true, b: true },
    itemOwners: { ledger: 'a' },
  };
}

describe('FR-D005 reducer purity and version contract', () => {
  const FORBIDDEN_IN_A_PURE_FOLD = [
    /convex\/_generated/, /\bctx\.db\b/, /\bfetch\s*\(/, /\bDate(?:\.now|\s*\()/,
    /\bperformance\.now\s*\(/, /\bMath\.random\s*\(/, /\bprocess\.env\b/,
    /\bcrypto\.getRandomValues\s*\(/,
  ];

  const executableSourceOf = (path: string): string =>
    readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('has only pure local imports and no database, API, clock, environment, or random access', () => {
    const executable = executableSourceOf('convex/canon/reducer.ts');
    const imports = [...executable.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual([
      '../shared/constants', '../shared/errors', '../shared/ids', './model', './rumorChain',
    ]);
    for (const forbidden of FORBIDDEN_IN_A_PURE_FOLD) {
      expect(executable).not.toMatch(forbidden);
    }
  });

  /**
   * ART-28. The allowlist above grew, so the guarantee has to follow it.
   *
   * `rumorChain.ts` computes a rumor's objective truth and credibility, and the reducer calls it
   * on every event that touches a rumor. Widening the reducer's import list without scanning what
   * it now imports would have moved the impurity one file away rather than forbidding it — a
   * `Date.now()` in the credibility fold would make two replays of the same log disagree just as
   * surely as one in the reducer itself.
   */
  it('extends the same purity guarantee to the rumor derivations the reducer now calls', () => {
    const executable = executableSourceOf('convex/canon/rumorChain.ts');
    const imports = [...executable.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual(['./model']);
    for (const forbidden of FORBIDDEN_IN_A_PURE_FOLD) {
      expect(executable).not.toMatch(forbidden);
    }
  });

  it.each(SUPPORTED_SCHEMA_VERSIONS)('deterministically reduces every state-change variant for schema v%s', (schemaVersion) => {
    const event = accepted();
    (event as unknown as { schemaVersion: number }).schemaVersion = schemaVersion;
    const state = initial();
    const expected = reduceWorldEvent(state, event);
    for (let iteration = 0; iteration < 50; iteration++) {
      const stateCopy = JSON.parse(JSON.stringify(state)) as WorldProjection;
      const eventCopy = JSON.parse(JSON.stringify(event)) as AcceptedEvent;
      expect(reduceWorldEvent(stateCopy, eventCopy)).toEqual(expected);
      expect(stateCopy).toEqual(state);
      expect(eventCopy).toEqual(event);
    }
    expect(expected).toMatchObject({
      lastSequenceNumber: 0,
      characterLocations: { a: 'square' },
      characterAlive: { a: false },
      itemOwners: { ledger: 'b' },
      characterKnowledge: { b: [expect.objectContaining({ factId: 'weather-rain', sourceEventId: 'prior' })] },
      characterMemories: { b: [expect.objectContaining({ sourceEventId: 'w#event#0', interpretation: 'The storm felt ominous.' })] },
      characterStates: { b: { availability: 'busy' } },
    });
    expect(expected.relationships['a|b']).toEqual({ trust: 4, affection: -2, resentment: 1, fear: 2, dependency: 3, familiarity: 5, lastUpdatedEventId: 'w#event#0' });
    expect(expected.facts).toHaveLength(1);
  });

  it('fails explicitly for every unsupported neighboring schema version', () => {
    for (const schemaVersion of [0, Math.max(...SUPPORTED_SCHEMA_VERSIONS) + 1]) {
      const event = accepted();
      (event as unknown as { schemaVersion: number }).schemaVersion = schemaVersion;
      try {
        reduceWorldEvent(initial(), event);
        throw new Error('expected unsupported version rejection');
      } catch (error) {
        expect(isCanonError(error) && error.error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
      }
    }
  });
});
