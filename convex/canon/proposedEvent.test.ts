import { normalizeProposedEventOutput } from './proposedEvent';
import type { ProposedEvent } from './model';

function movement(): ProposedEvent {
  return {
    schemaVersion: 1,
    worldId: 'mistwood',
    idempotencyKey: 'proposal-1',
    proposedBy: { type: 'director', id: 'director-1' },
    worldDay: 1,
    timeSlot: 'morning',
    eventType: 'movement',
    locationId: 'square',
    participantIds: ['resident-1'],
    causedByEventIds: ['prior-event'],
    publicSummary: 'A fictional resident moves.',
    stateChanges: [{
      type: 'character_location_changed',
      characterId: 'resident-1',
      fromLocationId: 'station',
      toLocationId: 'square',
    }],
    metadata: { providerTrace: { attempt: 1, labels: ['fake'], safe: true }, nullable: null },
  };
}

function expectContractError(value: unknown, code: string, path?: string): void {
  try {
    normalizeProposedEventOutput(value);
    throw new Error('expected proposal normalization to fail');
  } catch (error) {
    expect(error).toMatchObject({ error: { code, ...(path === undefined ? {} : { path }) } });
  }
}

describe('ProposedEvent v1 contract', () => {
  it('normalizes provider JSON into an isolated versioned event', () => {
    const raw = movement();
    const normalized = normalizeProposedEventOutput(JSON.parse(JSON.stringify(raw)) as unknown);
    expect(normalized).toEqual(raw);
    expect(normalized).not.toBe(raw);
    expect(normalized.participantIds).not.toBe(raw.participantIds);
    expect(normalized.stateChanges[0]).not.toBe(raw.stateChanges[0]);
    expect(normalized.metadata).not.toBe(raw.metadata);
  });

  it('accepts every defined state-change union variant', () => {
    const relationship = movement();
    relationship.eventType = 'relationship_change';
    relationship.participantIds = ['resident-1', 'resident-2'];
    relationship.stateChanges = [{
      type: 'relationship_changed', sourceCharacterId: 'resident-1', targetCharacterId: 'resident-2',
      trustDelta: 1, affectionDelta: 2, resentmentDelta: 0, reason: 'shared evidence',
    }];
    expect(normalizeProposedEventOutput(relationship).stateChanges[0].type).toBe('relationship_changed');
    const fact = movement();
    fact.eventType = 'discovery';
    fact.stateChanges = [{
      type: 'fact_created', subjectType: 'location', subjectId: 'station', predicate: 'sealed', value: true, visibility: 'canon',
    }];
    expect(normalizeProposedEventOutput(fact).stateChanges[0].type).toBe('fact_created');
  });

  it('rejects unsupported schema versions', () => {
    expectContractError({ ...movement(), schemaVersion: 2 }, 'UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  });

  it.each(['idempotencyKey', 'proposedBy', 'participantIds', 'causedByEventIds'] as const)(
    'rejects missing required provenance field %s',
    (field) => {
      const raw: Record<string, unknown> = { ...movement() };
      delete raw[field];
      expectContractError(raw, 'INVALID_EVENT_SHAPE', field);
    },
  );

  it('rejects undefined, empty, and unknown state-change payloads', () => {
    expectContractError({ ...movement(), stateChanges: undefined }, 'INVALID_EVENT_SHAPE', 'stateChanges');
    expectContractError({ ...movement(), stateChanges: [] }, 'INVALID_EVENT_SHAPE', 'stateChanges');
    expectContractError({ ...movement(), stateChanges: [{ type: 'undefined_payload' }] }, 'INVALID_EVENT_SHAPE', 'stateChanges[0]');
  });

  it('rejects extra envelope, source, and union fields', () => {
    expectContractError({ ...movement(), vendorPayload: { secret: true } }, 'INVALID_EVENT_SHAPE', '$');
    expectContractError({ ...movement(), proposedBy: { type: 'system', vendor: 'x' } }, 'INVALID_EVENT_SHAPE', 'proposedBy');
    const raw = movement();
    raw.stateChanges = [{ ...raw.stateChanges[0], vendorResult: true } as never];
    expectContractError(raw, 'INVALID_EVENT_SHAPE', 'stateChanges[0]');
  });

  it('rejects non-JSON metadata values', () => {
    expectContractError({ ...movement(), metadata: { callback: () => true } }, 'INVALID_EVENT_SHAPE', 'metadata.callback');
    expectContractError({ ...movement(), metadata: { invalid: Number.NaN } }, 'INVALID_EVENT_SHAPE', 'metadata.invalid');
  });
});
