import { commitProposedEvent } from './commit';
import { InMemoryCanonStore } from './inMemoryStore';
import { emptyProjection, type AcceptedEvent, type ProposedEvent } from './model';
import { reduceWorldEvent } from './reducer';
import { replayWorldEvents } from './replay';
import { buildSnapshot, replayFromSnapshot } from './snapshots';
import { validateCanon } from './validators';

function proposal(key: string, fromOwnerId: string | null, toOwnerId: string): ProposedEvent {
  return {
    schemaVersion: 1, worldId: 'w', idempotencyKey: key, proposedBy: { type: 'system' },
    worldDay: 1, timeSlot: 'noon', eventType: 'world_event', participantIds: [toOwnerId],
    causedByEventIds: [], stateChanges: [{
      type: 'item_transferred', itemId: 'ledger', fromOwnerId, toOwnerId, reason: 'Evidence custody',
    }],
  };
}

function accepted(sequenceNumber: number, fromOwnerId: string | null, toOwnerId: string): AcceptedEvent {
  return {
    ...proposal(`k-${sequenceNumber}`, fromOwnerId, toOwnerId), eventId: `w#event#${sequenceNumber}`,
    sequenceNumber, acceptedAt: sequenceNumber + 1, validationVersion: 'canon-v1', traceId: `trace-${sequenceNumber}`,
  };
}

describe('ART-80 unique item and asset ownership projection', () => {
  it('records every previous/current owner and Accepted Event provenance across multi-hop replay', () => {
    const first = accepted(0, null, 'a');
    const second = accepted(1, 'a', 'b');
    const projection = replayWorldEvents(emptyProjection('w'), [first, second]);
    expect(projection.itemOwners).toEqual({ ledger: 'b' });
    expect(projection.itemOwnershipHistory.ledger).toEqual([
      expect.objectContaining({ fromOwnerId: null, toOwnerId: 'a', sourceEventId: first.eventId, sequenceNumber: 0 }),
      expect.objectContaining({ fromOwnerId: 'a', toOwnerId: 'b', sourceEventId: second.eventId, sequenceNumber: 1 }),
    ]);
  });

  it('rejects missing/wrong prior ownership, same target, and two transfers in one event', () => {
    const projection = { ...emptyProjection('w'), itemOwners: { ledger: 'a' } };
    expect(validateCanon(proposal('wrong', null, 'b'), projection)?.code).toBe('ITEM_OWNERSHIP_CONFLICT');
    expect(validateCanon(proposal('same', 'a', 'a'), projection)?.code).toBe('ITEM_OWNERSHIP_CONFLICT');
    const duplicate = proposal('duplicate', 'a', 'b');
    duplicate.stateChanges.push({ type: 'item_transferred', itemId: 'ledger', fromOwnerId: 'a', toOwnerId: 'c', reason: 'conflict' });
    expect(validateCanon(duplicate, projection)?.code).toBe('ITEM_OWNERSHIP_CONFLICT');
  });

  it('deduplicates retried commits and therefore appends one ownership history entry', async () => {
    const store = new InMemoryCanonStore();
    store.setCanonRuleContext({
      worldId: 'w', rules: [], characterIds: ['a', 'b'], itemIds: ['ledger'], initialItemOwners: { ledger: 'a' },
    });
    const transfer = proposal('retry-key', 'a', 'b');
    const first = await commitProposedEvent(store, { proposed: transfer, traceId: 'trace' });
    const retry = await commitProposedEvent(store, { proposed: transfer, traceId: 'trace' });
    expect(retry).toMatchObject({ deduplicated: true, eventId: first.eventId });
    const projection = replayWorldEvents(emptyProjection('w'), store.committedEvents());
    expect(projection.itemOwnershipHistory.ledger).toHaveLength(1);
    expect(projection.itemOwners.ledger).toBe('b');
  });

  it('keeps full and snapshot replay identical and isolates ownership history', () => {
    const first = accepted(0, null, 'a'); const second = accepted(1, 'a', 'b');
    const afterFirst = reduceWorldEvent(emptyProjection('w'), first);
    const snapshot = buildSnapshot(afterFirst, 1, 1);
    const full = replayWorldEvents(emptyProjection('w'), [first, second]);
    const resumed = replayFromSnapshot(snapshot, [second]);
    expect(resumed).toEqual(full);
    full.itemOwnershipHistory.ledger[0].reason = 'mutated';
    expect(snapshot.projection.itemOwnershipHistory.ledger[0].reason).toBe('Evidence custody');
  });
});
