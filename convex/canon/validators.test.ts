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

  it.each<{
    name: string;
    mutate: (event: Record<string, unknown>) => void;
    code: 'INVALID_EVENT_SHAPE' | 'UNSUPPORTED_SCHEMA_VERSION';
    path: string;
  }>([
    { name: 'missing required world', mutate: (event) => { delete event.worldId; }, code: 'INVALID_EVENT_SHAPE', path: 'worldId' },
    { name: 'unsupported version', mutate: (event) => { event.schemaVersion = 2; }, code: 'UNSUPPORTED_SCHEMA_VERSION', path: 'schemaVersion' },
    { name: 'unknown event type', mutate: (event) => { event.eventType = 'vendor_event'; }, code: 'INVALID_EVENT_SHAPE', path: 'eventType' },
    { name: 'unknown state union', mutate: (event) => { event.stateChanges = [{ type: 'vendor_change' }]; }, code: 'INVALID_EVENT_SHAPE', path: 'stateChanges[0]' },
    { name: 'duplicate participant', mutate: (event) => { event.participantIds = ['a', 'a']; }, code: 'INVALID_EVENT_SHAPE', path: 'participantIds' },
    { name: 'non-finite delta', mutate: (event) => { event.stateChanges = [{ type: 'relationship_changed', sourceCharacterId: 'a', targetCharacterId: 'b', trustDelta: Number.NaN, affectionDelta: 0, resentmentDelta: 0, fearDelta: 0, dependencyDelta: 0, familiarityDelta: 0, reason: 'x', visibility: 'private' }]; }, code: 'INVALID_EVENT_SHAPE', path: 'stateChanges[0].trustDelta' },
    { name: 'non-finite fact value', mutate: (event) => { event.stateChanges = [{ type: 'fact_created', subjectType: 'world', subjectId: 'w', predicate: 'x', value: Number.POSITIVE_INFINITY, visibility: 'canon' }]; }, code: 'INVALID_EVENT_SHAPE', path: 'stateChanges[0].value' },
    { name: 'invalid idempotency key', mutate: (event) => { event.idempotencyKey = 'contains spaces'; }, code: 'INVALID_EVENT_SHAPE', path: 'idempotencyKey' },
    { name: 'unsafe world day', mutate: (event) => { event.worldDay = Number.MAX_SAFE_INTEGER + 1; }, code: 'INVALID_EVENT_SHAPE', path: 'worldDay' },
    { name: 'long summary', mutate: (event) => { event.publicSummary = 'x'.repeat(281); }, code: 'INVALID_EVENT_SHAPE', path: 'publicSummary' },
    { name: 'invalid participant reference', mutate: (event) => { event.participantIds = ['bad/ref']; }, code: 'INVALID_EVENT_SHAPE', path: 'participantIds' },
    { name: 'unknown envelope key', mutate: (event) => { event.vendorPayload = true; }, code: 'INVALID_EVENT_SHAPE', path: '$' },
    { name: 'unknown proposal-source key', mutate: (event) => { event.proposedBy = { type: 'system', vendor: true }; }, code: 'INVALID_EVENT_SHAPE', path: 'proposedBy' },
    { name: 'unknown union key', mutate: (event) => { event.stateChanges = [{ ...(event.stateChanges as Record<string, unknown>[])[0], vendor: true }]; }, code: 'INVALID_EVENT_SHAPE', path: 'stateChanges[0]' },
    { name: 'non-JSON metadata', mutate: (event) => { event.metadata = { callback: () => true }; }, code: 'INVALID_EVENT_SHAPE', path: 'metadata.callback' },
    { name: 'non-finite metadata', mutate: (event) => { event.metadata = { score: Number.NaN }; }, code: 'INVALID_EVENT_SHAPE', path: 'metadata.score' },
  ])('returns stable code/path for $name', ({ mutate, code, path }) => {
    const event = validMovement(projectionWithAAt('w', 'loc-1')) as unknown as Record<string, unknown>;
    mutate(event);
    const error = validateEventStructure(event);
    expect(error).toMatchObject({ code, path });
  });

  it('rejects cyclic metadata with a stable path instead of recursing indefinitely', () => {
    const metadata: Record<string, unknown> = {};
    metadata.self = metadata;
    const error = validateEventStructure({
      ...validMovement(projectionWithAAt('w', 'loc-1')),
      metadata,
    });
    expect(error).toMatchObject({ code: 'INVALID_EVENT_SHAPE', path: 'metadata.self' });
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
          fearDelta: 0,
          dependencyDelta: 0,
          familiarityDelta: 0,
          reason: 'self',
          visibility: 'private',
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
          fearDelta: 0,
          dependencyDelta: 0,
          familiarityDelta: 0,
          reason: 'noop',
          visibility: 'private',
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
