/**
 * In-memory {@link CanonCommitStore} reference implementation.
 *
 * Pure TypeScript (no Convex runtime). Used by the commit and workflow tests, and usable
 * by local tooling. Mirrors the semantics of the Convex-backed store so the same
 * {@link commitProposedEvent} logic can be exercised without a deployment.
 */

import type { AcceptedEvent } from './model';
import type { CanonCommitStore } from './commit';

type IdempotencyRow = {
  worldId: string;
  idempotencyKey: string;
  eventId: string;
  sequenceNumber: number;
  createdAt: number;
};

export class InMemoryCanonStore implements CanonCommitStore {
  private readonly events: AcceptedEvent[] = [];
  private readonly idempotency: IdempotencyRow[] = [];

  /** All committed events across worlds, in insertion order. */
  committedEvents(): AcceptedEvent[] {
    return [...this.events];
  }

  findExistingCommit(
    worldId: string,
    idempotencyKey: string,
  ): Promise<{ eventId: string; sequenceNumber: number } | null> {
    const row = this.idempotency.find(
      (r) => r.worldId === worldId && r.idempotencyKey === idempotencyKey,
    );
    return Promise.resolve(row ? { eventId: row.eventId, sequenceNumber: row.sequenceNumber } : null);
  }

  loadAcceptedEvents(worldId: string): Promise<AcceptedEvent[]> {
    return Promise.resolve(
      this.events
        .filter((e) => e.worldId === worldId)
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber),
    );
  }

  appendAcceptedEvent(accepted: AcceptedEvent): Promise<void> {
    this.events.push(accepted);
    return Promise.resolve();
  }

  appendIdempotencyKey(
    worldId: string,
    idempotencyKey: string,
    eventId: string,
    sequenceNumber: number,
    createdAt: number,
  ): Promise<void> {
    this.idempotency.push({ worldId, idempotencyKey, eventId, sequenceNumber, createdAt });
    return Promise.resolve();
  }
}
