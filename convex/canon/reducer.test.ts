import { reduceWorldEvent } from './reducer';
import { CanonError, isCanonError } from '../shared/errors';
import { emptyProjection, type AcceptedEvent, type WorldProjection } from './model';
import { mistwoodEvents, mistwoodInitialProjection } from './mistwoodFixture';

function accepted(over: Partial<AcceptedEvent> & Pick<AcceptedEvent, 'sequenceNumber'>): AcceptedEvent {
  return {
    schemaVersion: 1,
    worldId: 'w',
    idempotencyKey: 'k',
    proposedBy: { type: 'system' },
    worldDay: 0,
    timeSlot: 'morning',
    eventType: 'movement',
    participantIds: ['a'],
    causedByEventIds: [],
    stateChanges: [
      { type: 'character_location_changed', characterId: 'a', fromLocationId: 'loc-1', toLocationId: 'loc-2' },
    ],
    eventId: 'w#event#0',
    acceptedAt: 1,
    validationVersion: 'canon-v1',
    traceId: 'trace-1',
    ...over,
  } as AcceptedEvent;
}

describe('reduceWorldEvent', () => {
  it('updates a character location on movement', () => {
    const start: WorldProjection = { ...emptyProjection('w'), characterLocations: { a: 'loc-1' } };
    const next = reduceWorldEvent(start, accepted({ sequenceNumber: 0 }));
    expect(next.characterLocations.a).toBe('loc-2');
    expect(next.lastSequenceNumber).toBe(0);
    expect(next.lastCharacterMovement.a).toEqual({ worldDay: 0, timeSlot: 'morning', eventId: 'w#event#0' });
  });

  it('deterministically projects life, sourced knowledge, and unique item ownership', () => {
    const start: WorldProjection = {
      ...emptyProjection('w'),
      characterAlive: { a: true },
      itemOwners: { ledger: 'a' },
    };
    const event = accepted({
      sequenceNumber: 0,
      eventType: 'world_event',
      participantIds: ['a', 'b'],
      causedByEventIds: ['prior-event'],
      stateChanges: [
        { type: 'character_life_changed', characterId: 'a', alive: false, reason: 'fatal event' },
        { type: 'character_knowledge_learned', characterId: 'b', factId: 'a-is-dead', sourceType: 'observed', sourceEventId: 'prior-event' },
        { type: 'item_transferred', itemId: 'ledger', fromOwnerId: 'a', toOwnerId: 'b', reason: 'inheritance' },
      ],
    });
    const next = reduceWorldEvent(start, event);
    expect(next.characterAlive.a).toBe(false);
    expect(next.characterKnowledge.b).toEqual([expect.objectContaining({
      factId: 'a-is-dead', sourceType: 'observed', sourceEventId: 'prior-event',
      truthStatus: 'unknown', confidence: 0.5, shareability: 'private',
    })]);
    expect(next.itemOwners.ledger).toBe('b');
  });

  it('applies a relationship delta and clamps to bounds', () => {
    const start: WorldProjection = {
      ...emptyProjection('w'),
      characterLocations: { a: 'l', b: 'l' },
      relationships: { 'a|b': { trust: 98, affection: 0, resentment: 0, fear: 99, dependency: -99, familiarity: 98, lastUpdatedEventId: 'prior' } },
    };
    const event = accepted({
      sequenceNumber: 0,
      eventType: 'relationship_change',
      stateChanges: [
        {
          type: 'relationship_changed',
          sourceCharacterId: 'a',
          targetCharacterId: 'b',
          trustDelta: 10,
          affectionDelta: 5,
          resentmentDelta: -3,
          fearDelta: 5,
          dependencyDelta: -5,
          familiarityDelta: 10,
          reason: 'bonded',
          visibility: 'private',
        },
      ],
    });
    const next = reduceWorldEvent(start, event);
    expect(next.relationships['a|b']).toEqual({ trust: 100, affection: 5, resentment: -3, fear: 100, dependency: -100, familiarity: 100, lastUpdatedEventId: event.eventId });
    expect(next.relationshipHistory['a|b']).toEqual([expect.objectContaining({
      reason: 'bonded', visibility: 'private', sourceEventId: event.eventId, sequenceNumber: 0,
    })]);
  });

  it('appends a canonical fact on a fact_created change', () => {
    const start: WorldProjection = { ...emptyProjection('w'), characterLocations: { a: 'l' } };
    const event = accepted({
      sequenceNumber: 0,
      eventType: 'discovery',
      stateChanges: [
        { type: 'fact_created', subjectType: 'character', subjectId: 'a', predicate: 'knows', value: true, visibility: 'canon' },
      ],
    });
    const next = reduceWorldEvent(start, event);
    expect(next.facts).toHaveLength(1);
    expect(next.facts[0]).toEqual({
      subjectType: 'character',
      subjectId: 'a',
      predicate: 'knows',
      value: true,
      visibility: 'canon',
      sourceEventId: event.eventId,
    });
  });

  it('does not mutate the input projection', () => {
    const start: WorldProjection = { ...emptyProjection('w'), characterLocations: { a: 'loc-1' } };
    const snapshot = JSON.parse(JSON.stringify(start)) as WorldProjection;
    reduceWorldEvent(start, accepted({ sequenceNumber: 0 }));
    expect(start).toEqual(snapshot);
  });

  it('does not mutate the input event', () => {
    const start: WorldProjection = { ...emptyProjection('w'), characterLocations: { a: 'loc-1' } };
    const event = accepted({ sequenceNumber: 0 });
    const snapshot = JSON.parse(JSON.stringify(event)) as AcceptedEvent;
    reduceWorldEvent(start, event);
    expect(event).toEqual(snapshot);
  });

  it('fails on an unsupported schema version', () => {
    const start: WorldProjection = { ...emptyProjection('w'), characterLocations: { a: 'loc-1' } };
    const event = accepted({ sequenceNumber: 0 });
    (event as unknown as { schemaVersion: number }).schemaVersion = 7;
    expect(() => reduceWorldEvent(start, event)).toThrow(CanonError);
    try {
      reduceWorldEvent(start, event);
    } catch (e) {
      expect(isCanonError(e) && e.error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    }
  });

  it('fails on a sequence gap', () => {
    const start: WorldProjection = { ...emptyProjection('w'), lastSequenceNumber: 1, characterLocations: { a: 'loc-1' } };
    const event = accepted({ sequenceNumber: 5 });
    expect(() => reduceWorldEvent(start, event)).toThrow();
    try {
      reduceWorldEvent(start, event);
    } catch (e) {
      expect(isCanonError(e) && e.error.code).toBe('SEQUENCE_GAP');
    }
  });

  it('fails on a duplicate sequence', () => {
    const start: WorldProjection = { ...emptyProjection('w'), lastSequenceNumber: 3, characterLocations: { a: 'loc-1' } };
    const event = accepted({ sequenceNumber: 2 });
    try {
      reduceWorldEvent(start, event);
      throw new Error('should have thrown');
    } catch (e) {
      expect(isCanonError(e) && e.error.code).toBe('DUPLICATE_SEQUENCE');
    }
  });

  it('fails when the world id does not match', () => {
    const start: WorldProjection = { ...emptyProjection('w'), characterLocations: { a: 'loc-1' } };
    const event = accepted({ sequenceNumber: 0, worldId: 'other' });
    try {
      reduceWorldEvent(start, event);
      throw new Error('should have thrown');
    } catch (e) {
      expect(isCanonError(e) && e.error.code).toBe('SEQUENCE_CONFLICT');
    }
  });

  it('applies the Mistwood movement event consistently', () => {
    const afterFirst = reduceWorldEvent(mistwoodInitialProjection, mistwoodEvents[0]);
    expect(afterFirst.characterLocations.cassia).toBe('mistwood-grove');
  });
});
