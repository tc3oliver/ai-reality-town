import { commitProposedEvent } from './commit';
import { InMemoryCanonStore } from './inMemoryStore';
import {
  emptyProjection,
  type CanonRuleContext,
  type ProposedEvent,
  type WorldProjection,
} from './model';
import { validateCanon, validateEventStructure } from './validators';

const context: CanonRuleContext = {
  worldId: 'w',
  rules: [],
  characterIds: ['a', 'b'],
  locationIds: ['l1', 'l2', 'l3'],
  itemIds: ['item1'],
  locationConnections: { l1: ['l2'], l2: ['l1', 'l3'], l3: ['l2'] },
  initialCharacterAlive: { a: true, b: true },
  initialItemOwners: { item1: 'a' },
  knownEventIds: ['w#event#0'],
};

function projection(overrides: Partial<WorldProjection> = {}): WorldProjection {
  return {
    ...emptyProjection('w'),
    characterLocations: { a: 'l1', b: 'l2' },
    ...overrides,
  };
}

function movement(overrides: Partial<ProposedEvent> = {}): ProposedEvent {
  return {
    schemaVersion: 1,
    worldId: 'w',
    idempotencyKey: 'move-1',
    proposedBy: { type: 'character', id: 'a' },
    worldDay: 1,
    timeSlot: 'morning',
    eventType: 'movement',
    locationId: 'l1',
    participantIds: ['a'],
    causedByEventIds: [],
    stateChanges: [{
      type: 'character_location_changed', characterId: 'a', fromLocationId: 'l1', toLocationId: 'l2',
    }],
    ...overrides,
  };
}

function expectCanonCode(event: ProposedEvent, state: WorldProjection, code: string): void {
  expect(validateEventStructure(event)).toBeNull();
  expect(validateCanon(event, state, context)).toMatchObject({ code });
}

describe('FR-D004 Canon continuity rules', () => {
  it('rejects teleportation between unconnected locations', () => {
    expectCanonCode(movement({
      stateChanges: [{ type: 'character_location_changed', characterId: 'a', fromLocationId: 'l1', toLocationId: 'l3' }],
    }), projection(), 'TELEPORTATION_NOT_ALLOWED');
  });

  it('rejects a second location in the same world time slot', () => {
    expectCanonCode(movement(), projection({
      lastCharacterMovement: { a: { worldDay: 1, timeSlot: 'morning', eventId: 'w#event#0' } },
    }), 'CHARACTER_ALREADY_MOVED_THIS_SLOT');
  });

  it('rejects dead characters from normal participation', () => {
    expectCanonCode(movement(), projection({ characterAlive: { a: false } }), 'DEAD_CHARACTER_ACTION');
  });

  it('rejects knowledge without an existing causal source', () => {
    expectCanonCode(movement({
      eventType: 'discovery',
      stateChanges: [{
        type: 'character_knowledge_learned', characterId: 'a', factId: 'secret-ledger',
        sourceType: 'evidence', sourceEventId: 'w#event#0',
      }],
    }), projection(), 'KNOWLEDGE_SOURCE_MISSING');
  });

  it('accepts sourced knowledge when the causal event exists and is cited', () => {
    const event = movement({
      eventType: 'discovery',
      causedByEventIds: ['w#event#0'],
      stateChanges: [{
        type: 'character_knowledge_learned', characterId: 'a', factId: 'secret-ledger',
        sourceType: 'evidence', sourceEventId: 'w#event#0',
      }],
    });
    expect(validateEventStructure(event)).toBeNull();
    expect(validateCanon(event, projection(), context)).toBeNull();
  });

  it('rejects a transfer from anyone except the unique current owner', () => {
    expectCanonCode(movement({
      eventType: 'world_event',
      participantIds: ['a', 'b'],
      stateChanges: [{
        type: 'item_transferred', itemId: 'item1', fromOwnerId: 'b', toOwnerId: 'a', reason: 'claimed',
      }],
    }), projection(), 'ITEM_OWNERSHIP_CONFLICT');
  });

  it('rejects two transfers of one item in a single event', () => {
    expectCanonCode(movement({
      eventType: 'world_event',
      participantIds: ['a', 'b'],
      stateChanges: [
        { type: 'item_transferred', itemId: 'item1', fromOwnerId: 'a', toOwnerId: 'b', reason: 'gift' },
        { type: 'item_transferred', itemId: 'item1', fromOwnerId: 'a', toOwnerId: 'b', reason: 'duplicate' },
      ],
    }), projection(), 'ITEM_OWNERSHIP_CONFLICT');
  });

  it.each([
    ['unknown participant', movement({ participantIds: ['ghost'] }), 'UNKNOWN_CHARACTER_REFERENCE'],
    ['unknown location', movement({ locationId: 'missing' }), 'UNKNOWN_LOCATION_REFERENCE'],
    ['unknown causal event', movement({ causedByEventIds: ['w#event#999'] }), 'UNKNOWN_EVENT_REFERENCE'],
    ['self relationship', movement({ eventType: 'relationship_change', stateChanges: [{ type: 'relationship_changed', sourceCharacterId: 'a', targetCharacterId: 'a', trustDelta: 1, affectionDelta: 0, resentmentDelta: 0, reason: 'invalid' }] }), 'INVALID_RELATIONSHIP_TARGET'],
    ['unexplained numeric change', movement({ eventType: 'relationship_change', participantIds: ['a', 'b'], stateChanges: [{ type: 'relationship_changed', sourceCharacterId: 'a', targetCharacterId: 'b', trustDelta: 0, affectionDelta: 0, resentmentDelta: 0, reason: 'none' }] }), 'INVALID_RELATIONSHIP_DELTA'],
  ] as const)('rejects %s with a stable reason', (_name, event, code) => {
    expectCanonCode(event, projection(), code);
  });

  it('rejects repeated invalid attempts without appending or reserving the key', async () => {
    const store = new InMemoryCanonStore();
    store.setCanonRuleContext({
      ...context,
      initialCharacterAlive: { a: false, b: true },
    });
    const invalid = movement();
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(commitProposedEvent(store, { proposed: invalid, traceId: `retry-${attempt}` }))
        .rejects.toMatchObject({ error: { code: 'DEAD_CHARACTER_ACTION' } });
    }
    expect(store.committedEvents()).toHaveLength(0);
    await expect(store.findExistingCommit('w', invalid.idempotencyKey)).resolves.toBeNull();
  });
});
