/**
 * In-memory {@link CanonCommitStore} reference implementation.
 *
 * Pure TypeScript (no Convex runtime). Used by the commit and workflow tests, and usable
 * by local tooling. Mirrors the semantics of the Convex-backed store so the same
 * {@link commitProposedEvent} logic can be exercised without a deployment.
 */

import type { AcceptedEvent, CanonRuleContext } from './model';
import type { CanonCommitStore } from './commit';
import { cloneAcceptedEvent } from './serialize';

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
  private readonly ruleContexts = new Map<string, CanonRuleContext>();
  private readonly worldLocks = new Map<string, Promise<void>>();

  /** All committed events across worlds, in insertion order. */
  committedEvents(): AcceptedEvent[] {
    return this.events.map(cloneAcceptedEvent);
  }

  async runExclusive<T>(worldId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.worldLocks.get(worldId) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.worldLocks.set(worldId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.worldLocks.get(worldId) === tail) this.worldLocks.delete(worldId);
    }
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
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
        .map(cloneAcceptedEvent),
    );
  }

  setCanonRuleContext(context: CanonRuleContext): void {
    this.ruleContexts.set(context.worldId, context);
  }

  loadCanonRuleContext(worldId: string): Promise<CanonRuleContext | null> {
    return Promise.resolve(this.ruleContexts.get(worldId) ?? null);
  }

  appendCommit(accepted: AcceptedEvent): Promise<void> {
    this.events.push(cloneAcceptedEvent(accepted));
    this.idempotency.push({
      worldId: accepted.worldId,
      idempotencyKey: accepted.idempotencyKey,
      eventId: accepted.eventId,
      sequenceNumber: accepted.sequenceNumber,
      createdAt: accepted.acceptedAt,
    });
    return Promise.resolve();
  }
}
