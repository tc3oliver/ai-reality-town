import { validateCanon, validateEventStructure } from './validators';
import { emptyProjection, type ProposedEvent, type WorldProjection } from './model';

/** A structurally + canonically valid movement proposal against `projection`. */
function validMovement(projection: WorldProjection): ProposedEvent {
  // Character 'a' is at 'loc-1' in the projection, moving to 'loc-2'.
  return {
    schemaVersion: 1,
    worldId: projection.worldId,
    idempotencyKey: 'key-1',
    proposedBy: { type: 'character', id: 'a' },
    worldDay: 0,
    timeSlot: 'morning',
    eventType: 'movement',
    participantIds: ['a'],
    causedByEventIds: [],
    publicSummary: 'a moves',
    stateChanges: [
      {
        type: 'character_location_changed',
        characterId: 'a',
        fromLocationId: 'loc-1',
        toLocationId: 'loc-2',
      },
    ],
  };
}

function projectionWithAAt(worldId: string, location: string): WorldProjection {
  return {
    ...emptyProjection(worldId),
    characterLocations: { a: location },
  };
}

describe('validateEventStructure', () => {
  it('accepts a valid movement event', () => {
    const projection = projectionWithAAt('w', 'loc-1');
    const event = validMovement(projection);
    expect(validateEventStructure(event)).toBeNull();
    expect(validateCanon(event, projection)).toBeNull();
  });

  it('rejects an invalid event shape (not an object)', () => {
    expect(validateEventStructure(null)?.code).toBe('INVALID_EVENT_SHAPE');
    expect(validateEventStructure('nope')?.code).toBe('INVALID_EVENT_SHAPE');
  });

  it('rejects an unsupported schema version', () => {
    const event = { ...validMovement(projectionWithAAt('w', 'loc-1')), schemaVersion: 99 };
    expect(validateEventStructure(event)?.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('rejects an empty idempotency key', () => {
    const event = { ...validMovement(projectionWithAAt('w', 'loc-1')), idempotencyKey: '' };
    expect(validateEventStructure(event)?.code).toBe('INVALID_EVENT_SHAPE');
  });

  it('rejects empty stateChanges', () => {
    const event = { ...validMovement(projectionWithAAt('w', 'loc-1')), stateChanges: [] };
    expect(validateEventStructure(event)?.code).toBe('INVALID_EVENT_SHAPE');
  });

  it('rejects duplicate participants', () => {
    const event = {
      ...validMovement(projectionWithAAt('w', 'loc-1')),
      participantIds: ['a', 'a'],
    };
    expect(validateEventStructure(event)?.code).toBe('INVALID_EVENT_SHAPE');
  });

  it('rejects a too-long public summary', () => {
    const event = {
      ...validMovement(projectionWithAAt('w', 'loc-1')),
      publicSummary: 'x'.repeat(281),
    };
    expect(validateEventStructure(event)?.code).toBe('INVALID_EVENT_SHAPE');
  });
});

describe('validateCanon', () => {
  it('rejects a movement whose fromLocationId does not match the projection', () => {
    const projection = projectionWithAAt('w', 'loc-1');
    const event = validMovement(projection);
    // Claim a wrong origin.
    (event.stateChanges[0] as { fromLocationId: string }).fromLocationId = 'loc-3';
    expect(validateCanon(event, projection)?.code).toBe('LOCATION_PRECONDITION_FAILED');
  });

  it('allows placing a character that has no current location (spawn)', () => {
    const projection = emptyProjection('w');
    const event = validMovement(projectionWithAAt('w', 'loc-1'));
    expect(validateCanon(event, projection)).toBeNull();
  });

  it('rejects a duplicate movement for one character in a single event', () => {
    const projection = projectionWithAAt('w', 'loc-1');
    const event: ProposedEvent = {
      ...validMovement(projection),
      stateChanges: [
        { type: 'character_location_changed', characterId: 'a', fromLocationId: 'loc-1', toLocationId: 'loc-2' },
        { type: 'character_location_changed', characterId: 'a', fromLocationId: 'loc-2', toLocationId: 'loc-3' },
      ],
    };
    expect(validateCanon(event, projection)?.code).toBe('DUPLICATE_CHARACTER_MOVEMENT');
  });

  it('rejects a self relationship', () => {
    const projection = { ...emptyProjection('w'), characterLocations: { a: 'loc-1' } };
    const event: ProposedEvent = {
      schemaVersion: 1,
      worldId: 'w',
      idempotencyKey: 'k',
      proposedBy: { type: 'character', id: 'a' },
      worldDay: 0,
      timeSlot: 'noon',
      eventType: 'relationship_change',
      participantIds: ['a'],
      causedByEventIds: [],
      stateChanges: [
        {
          type: 'relationship_changed',
          sourceCharacterId: 'a',
          targetCharacterId: 'a',
          trustDelta: 1,
          affectionDelta: 0,
          resentmentDelta: 0,
          reason: 'self',
        },
      ],
    };
    expect(validateCanon(event, projection)?.code).toBe('INVALID_RELATIONSHIP_TARGET');
  });

  it('rejects an all-zero relationship delta', () => {
    const projection = { ...emptyProjection('w'), characterLocations: { a: 'l', b: 'l' } };
    const event: ProposedEvent = {
      schemaVersion: 1,
      worldId: 'w',
      idempotencyKey: 'k',
      proposedBy: { type: 'system' },
      worldDay: 0,
      timeSlot: 'noon',
      eventType: 'relationship_change',
      participantIds: ['a', 'b'],
      causedByEventIds: [],
      stateChanges: [
        {
          type: 'relationship_changed',
          sourceCharacterId: 'a',
          targetCharacterId: 'b',
          trustDelta: 0,
          affectionDelta: 0,
          resentmentDelta: 0,
          reason: 'noop',
        },
      ],
    };
    expect(validateCanon(event, projection)?.code).toBe('INVALID_RELATIONSHIP_DELTA');
  });

  it('rejects a participant mismatch (moved character not a participant)', () => {
    const projection = projectionWithAAt('w', 'loc-1');
    const event = { ...validMovement(projection), participantIds: ['b'] };
    expect(validateCanon(event, projection)?.code).toBe('PARTICIPANT_MISMATCH');
  });

  it('rejects an invalid (empty) fact subject', () => {
    const projection = { ...emptyProjection('w'), characterLocations: { a: 'l' } };
    const event: ProposedEvent = {
      schemaVersion: 1,
      worldId: 'w',
      idempotencyKey: 'k',
      proposedBy: { type: 'system' },
      worldDay: 0,
      timeSlot: 'afternoon',
      eventType: 'discovery',
      participantIds: ['a'],
      causedByEventIds: [],
      stateChanges: [
        {
          type: 'fact_created',
          subjectType: 'character',
          subjectId: '',
          predicate: 'knows',
          value: true,
          visibility: 'canon',
        },
      ],
    };
    expect(validateCanon(event, projection)?.code).toBe('INVALID_FACT_SUBJECT');
  });
});
