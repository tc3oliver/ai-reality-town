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
      { type: 'relationship_changed', sourceCharacterId: 'a', targetCharacterId: 'b', trustDelta: 4, affectionDelta: -2, resentmentDelta: 1, reason: 'witnessed event' },
      { type: 'fact_created', subjectType: 'world', subjectId: 'w', predicate: 'weather', value: 'rain', visibility: 'canon' },
      { type: 'character_life_changed', characterId: 'a', alive: false, reason: 'fatal event' },
      { type: 'character_knowledge_learned', characterId: 'b', factId: 'weather-rain', sourceType: 'observed', sourceEventId: 'prior' },
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
  it('has only pure local imports and no database, API, clock, environment, or random access', () => {
    const raw = readFileSync('convex/canon/reducer.ts', 'utf8');
    const executable = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const imports = [...executable.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual([
      '../shared/constants', '../shared/errors', '../shared/ids', './model',
    ]);
    for (const forbidden of [
      /convex\/_generated/, /\bctx\.db\b/, /\bfetch\s*\(/, /\bDate(?:\.now|\s*\()/,
      /\bperformance\.now\s*\(/, /\bMath\.random\s*\(/, /\bprocess\.env\b/,
      /\bcrypto\.getRandomValues\s*\(/,
    ]) {
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
      characterStates: { b: { availability: 'busy' } },
    });
    expect(expected.relationships['a|b']).toEqual({ trust: 4, affection: -2, resentment: 1 });
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
