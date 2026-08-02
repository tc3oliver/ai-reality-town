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
      trustDelta: 1, affectionDelta: 2, resentmentDelta: 0, fearDelta: 0,
      dependencyDelta: 0, familiarityDelta: 3, reason: 'shared evidence', visibility: 'public',
    }];
    expect(normalizeProposedEventOutput(relationship).stateChanges[0].type).toBe('relationship_changed');
    const fact = movement();
    fact.eventType = 'discovery';
    fact.stateChanges = [{
      type: 'fact_created', subjectType: 'location', subjectId: 'station', predicate: 'sealed', value: true, visibility: 'canon',
    }];
    expect(normalizeProposedEventOutput(fact).stateChanges[0].type).toBe('fact_created');
    const life = movement();
    life.eventType = 'world_event';
    life.stateChanges = [{ type: 'character_life_changed', characterId: 'resident-1', alive: false, reason: 'fatal event' }];
    expect(normalizeProposedEventOutput(life).stateChanges[0].type).toBe('character_life_changed');
    const knowledge = movement();
    knowledge.eventType = 'discovery';
    knowledge.stateChanges = [{
      type: 'character_knowledge_learned', characterId: 'resident-1', factId: 'ledger-location',
      sourceType: 'evidence', sourceEventId: 'prior-event',
    }];
    expect(normalizeProposedEventOutput(knowledge).stateChanges[0].type).toBe('character_knowledge_learned');
    const item = movement();
    item.eventType = 'world_event';
    item.participantIds = ['resident-1', 'resident-2'];
    item.stateChanges = [{
      type: 'item_transferred', itemId: 'ledger', fromOwnerId: 'resident-1',
      toOwnerId: 'resident-2', reason: 'handed over',
    }];
    expect(normalizeProposedEventOutput(item).stateChanges[0].type).toBe('item_transferred');
    const state = movement();
    state.eventType = 'world_event';
    state.stateChanges = [{
      type: 'character_state_changed', characterId: 'resident-1', field: 'health',
      fromValue: 'healthy', toValue: 'injured', reason: 'accepted scene consequence',
    }];
    expect(normalizeProposedEventOutput(state).stateChanges[0].type).toBe('character_state_changed');
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
