import { commitProposedEvent, type CommitResult } from './commit';
import { InMemoryCanonStore } from './inMemoryStore';
import { isCanonError } from '../shared/errors';
import type { ProposedEvent } from './model';

/** A valid movement proposal that spawns / moves character 'a'. */
function movementProposal(worldId: string, idempotencyKey: string, from: string, to: string): ProposedEvent {
  return {
    schemaVersion: 1,
    worldId,
    idempotencyKey,
    proposedBy: { type: 'character', id: 'a' },
    worldDay: 0,
    timeSlot: 'morning',
    eventType: 'movement',
    participantIds: ['a'],
    causedByEventIds: [],
    stateChanges: [
      { type: 'character_location_changed', characterId: 'a', fromLocationId: from, toLocationId: to },
    ],
  };
}

describe('commitProposedEvent (idempotency)', () => {
  it('commits once for a unique key', async () => {
    const store = new InMemoryCanonStore();
    const result: CommitResult = await commitProposedEvent(store, {
      proposed: movementProposal('w1', 'k1', 'loc-1', 'loc-2'),
      traceId: 't1',
    });
    expect(result.deduplicated).toBe(false);
    expect(result.sequenceNumber).toBe(0);
    expect(store.committedEvents()).toHaveLength(1);
  });

  it('returns the existing event for a duplicate key and is marked deduplicated', async () => {
    const store = new InMemoryCanonStore();
    const first = await commitProposedEvent(store, {
      proposed: movementProposal('w1', 'k1', 'loc-1', 'loc-2'),
      traceId: 't1',
    });
    const second = await commitProposedEvent(store, {
      proposed: movementProposal('w1', 'k1', 'loc-1', 'loc-2'),
      traceId: 't1',
    });
    expect(second.deduplicated).toBe(true);
    expect(second.eventId).toBe(first.eventId);
    expect(second.sequenceNumber).toBe(first.sequenceNumber);
    // Still only one event in the store.
    expect(store.committedEvents()).toHaveLength(1);
  });

  it('creates a new event for a different key', async () => {
    const store = new InMemoryCanonStore();
    await commitProposedEvent(store, { proposed: movementProposal('w1', 'k1', 'loc-1', 'loc-2'), traceId: 't1' });
    // Second proposal moves the now-placed character onward (canon-valid continuation).
    const second = await commitProposedEvent(store, {
      proposed: movementProposal('w1', 'k2', 'loc-2', 'loc-3'),
      traceId: 't2',
    });
    expect(second.deduplicated).toBe(false);
    expect(second.sequenceNumber).toBe(1);
    expect(store.committedEvents()).toHaveLength(2);
  });

  it('handles the same key in another world independently', async () => {
    const store = new InMemoryCanonStore();
    const inW1 = await commitProposedEvent(store, {
      proposed: movementProposal('w1', 'shared-key', 'loc-1', 'loc-2'),
      traceId: 't1',
    });
    const inW2 = await commitProposedEvent(store, {
      proposed: movementProposal('w2', 'shared-key', 'loc-1', 'loc-2'),
      traceId: 't2',
    });
    expect(inW1.deduplicated).toBe(false);
    expect(inW2.deduplicated).toBe(false);
    expect(inW1.eventId).not.toBe(inW2.eventId);
    expect(store.committedEvents()).toHaveLength(2);
  });

  it('allocates monotonically increasing sequence numbers', async () => {
    const store = new InMemoryCanonStore();
    const r1 = await commitProposedEvent(store, { proposed: movementProposal('w1', 'k1', 'loc-1', 'loc-2'), traceId: 't1' });
    const r2 = await commitProposedEvent(store, { proposed: movementProposal('w1', 'k2', 'loc-2', 'loc-3'), traceId: 't2' });
    const r3 = await commitProposedEvent(store, { proposed: movementProposal('w1', 'k3', 'loc-3', 'loc-4'), traceId: 't3' });
    expect([r1.sequenceNumber, r2.sequenceNumber, r3.sequenceNumber]).toEqual([0, 1, 2]);
  });

  it('rejects a canon-invalid proposal with a stable error code', async () => {
    const store = new InMemoryCanonStore();
    // Place 'a' at loc-1 first.
    await commitProposedEvent(store, { proposed: movementProposal('w1', 'k1', 'loc-1', 'loc-2'), traceId: 't1' });
    // Now claim a wrong origin — should be LOCATION_PRECONDITION_FAILED.
    try {
      await commitProposedEvent(store, {
        proposed: movementProposal('w1', 'k2', 'loc-9', 'loc-3'),
        traceId: 't2',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(isCanonError(e) && e.error.code).toBe('LOCATION_PRECONDITION_FAILED');
    }
    // Nothing was committed for the rejected proposal.
    expect(store.committedEvents()).toHaveLength(1);
  });

  it.each([
    ['missing required field', (event: Record<string, unknown>): void => { delete event.worldId; }],
    ['unknown event type', (event: Record<string, unknown>): void => { event.eventType = 'vendor'; }],
    ['non-finite value', (event: Record<string, unknown>): void => { event.stateChanges = [{ type: 'fact_created', subjectType: 'world', subjectId: 'w1', predicate: 'x', value: Number.NaN, visibility: 'canon' }]; }],
    ['invalid reference', (event: Record<string, unknown>): void => { event.participantIds = ['bad/ref']; }],
  ] as const)('performs no write when structural validation rejects %s', async (_name, mutate) => {
    const store = new InMemoryCanonStore();
    const raw = movementProposal('w1', 'atomic-reject', 'loc-1', 'loc-2') as unknown as Record<string, unknown>;
    mutate(raw);
    await expect(commitProposedEvent(store, {
      proposed: raw as unknown as ProposedEvent,
      traceId: 'trace-rejected',
    })).rejects.toMatchObject({ error: { code: 'INVALID_EVENT_SHAPE' } });
    expect(store.committedEvents()).toHaveLength(0);
    await expect(store.findExistingCommit('w1', 'atomic-reject')).resolves.toBeNull();
  });
});
