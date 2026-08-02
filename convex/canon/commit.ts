/**
 * Idempotent canon event commit.
 *
 * The commit pipeline is implemented as a pure-ish helper over a {@link CanonCommitStore}
 * repository interface, so the SAME logic runs:
 *   - inside the public Convex mutation {@link validateAndCommitProposedEvent}, and
 *   - inside the foundation simulation workflow (sharing one transaction), and
 *   - inside unit tests, backed by an in-memory store.
 *
 * Pipeline: structural validation → idempotency check → load current projection →
 * canon validation → allocate sequence → append accepted event → append idempotency
 * record → return result.
 *
 * All of this happens inside a single Convex mutation/transaction, so there is no
 * "action-then-mutation" race. The reducer used to build the projection is the same pure
 * function tested elsewhere. `acceptedAt` uses the wall clock here (commit step only);
 * the reducer never reads it.
 */

import { mutation } from '../_generated/server';
import { v } from 'convex/values';
import { CANON_VALIDATION_VERSION } from '../shared/constants';
import { CanonError } from '../shared/errors';
import { deriveEventId } from '../shared/ids';
import { emptyProjection, type AcceptedEvent, type CanonImmutableRule, type CanonRuleContext, type ProposedEvent } from './model';
import { proposedEventArgs } from './proposedEvent';
import { replayWorldEvents } from './replay';
import { rowToAcceptedEvent } from './serialize';
import { validateCanon, validateEventStructure } from './validators';

/** Result of a commit attempt. `deduplicated` is true when an identical key already committed. */
export type CommitResult = {
  eventId: string;
  sequenceNumber: number;
  deduplicated: boolean;
};

/** Commit arguments accepted by {@link commitProposedEvent} and the public mutation. */
export type CommitArgs = {
  proposed: ProposedEvent;
  traceId: string;
};

/**
 * Minimal repository surface the commit pipeline needs. The Convex mutation adapts
 * `ctx.db` to this interface; tests supply an in-memory implementation.
 */
export interface CanonCommitStore {
  findExistingCommit(
    worldId: string,
    idempotencyKey: string,
  ): Promise<{ eventId: string; sequenceNumber: number } | null>;
  loadAcceptedEvents(worldId: string): Promise<AcceptedEvent[]>;
  loadCanonRuleContext(worldId: string): Promise<CanonRuleContext | null>;
  appendAcceptedEvent(accepted: AcceptedEvent, traceId: string): Promise<void>;
  appendIdempotencyKey(
    worldId: string,
    idempotencyKey: string,
    eventId: string,
    sequenceNumber: number,
    createdAt: number,
  ): Promise<void>;
}

/** Commit a proposed event. Throws {@link CanonError} on validation failure. */
export async function commitProposedEvent(
  store: CanonCommitStore,
  args: CommitArgs,
): Promise<CommitResult> {
  const { proposed, traceId } = args;

  // 1. Structural validation.
  const structErr = validateEventStructure(proposed);
  if (structErr) throw new CanonError(structErr);

  // 2. Idempotency — a repeated proposal returns the existing event, never a second one.
  const existing = await store.findExistingCommit(proposed.worldId, proposed.idempotencyKey);
  if (existing) {
    return {
      eventId: existing.eventId,
      sequenceNumber: existing.sequenceNumber,
      deduplicated: true,
    };
  }

  // 3. Load current projection by replaying all accepted events for this world.
  const events = await store.loadAcceptedEvents(proposed.worldId);
  const projection = replayWorldEvents(emptyProjection(proposed.worldId), events);
  const ruleContext = await store.loadCanonRuleContext(proposed.worldId);

  // 4. Canon validation against the current projection.
  const canonErr = validateCanon(proposed, projection, ruleContext);
  if (canonErr) throw new CanonError(canonErr);

  // 5. Allocate the next sequence number (deterministic within this transaction).
  const sequenceNumber = projection.lastSequenceNumber + 1;
  const eventId = deriveEventId(proposed.worldId, sequenceNumber);
  const acceptedAt = Date.now();

  const accepted: AcceptedEvent = {
    ...proposed,
    eventId,
    acceptedAt,
    sequenceNumber,
    validationVersion: CANON_VALIDATION_VERSION,
  };

  // 6. Append the immutable accepted event, then the idempotency record.
  await store.appendAcceptedEvent(accepted, traceId);
  await store.appendIdempotencyKey(
    proposed.worldId,
    proposed.idempotencyKey,
    eventId,
    sequenceNumber,
    acceptedAt,
  );

  return { eventId, sequenceNumber, deduplicated: false };
}

// --- Convex wiring ---------------------------------------------------------

import type { GenericMutationCtx } from 'convex/server';
import type { DataModel } from '../_generated/dataModel';

/**
 * Adapt a Convex mutation's `db` to the {@link CanonCommitStore} interface. Shared by
 * the public commit mutation and the foundation workflow so both run the same
 * {@link commitProposedEvent} logic.
 */
export function createConvexCanonStore(
  db: GenericMutationCtx<DataModel>['db'],
): CanonCommitStore {
  return {
    async findExistingCommit(worldId, idempotencyKey) {
      const row = await db
        .query('canonIdempotencyKeys')
        .withIndex('by_world_and_key', (q) =>
          q.eq('worldId', worldId).eq('idempotencyKey', idempotencyKey),
        )
        .unique();
      return row ? { eventId: row.eventId, sequenceNumber: row.sequenceNumber } : null;
    },
    async loadAcceptedEvents(worldId) {
      const rows = await db
        .query('canonEvents')
        .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId))
        .collect();
      return rows.map(rowToAcceptedEvent);
    },
    async loadCanonRuleContext(worldId) {
      const rows = await db
        .query('worldImmutableRules')
        .withIndex('by_world_id', (q) => q.eq('worldId', worldId))
        .collect();
      return rows.length === 0
        ? null
        : { worldId, rules: rows.map((row) => row.payload as CanonImmutableRule) };
    },
    async appendAcceptedEvent(accepted, traceId) {
      // Split the envelope off the accepted event: the proposed event is stored as
      // `payload`, the envelope as top-level columns.
      const {
        eventId: _eventId,
        acceptedAt: _acceptedAt,
        sequenceNumber: _sequenceNumber,
        validationVersion: _validationVersion,
        ...proposed
      } = accepted;
      await db.insert('canonEvents', {
        worldId: accepted.worldId,
        sequenceNumber: accepted.sequenceNumber,
        schemaVersion: accepted.schemaVersion,
        eventType: accepted.eventType,
        worldDay: accepted.worldDay,
        timeSlot: accepted.timeSlot,
        locationId: accepted.locationId,
        participantIds: accepted.participantIds,
        causedByEventIds: accepted.causedByEventIds,
        publicSummary: accepted.publicSummary,
        payload: proposed,
        validationVersion: accepted.validationVersion,
        idempotencyKey: accepted.idempotencyKey,
        traceId,
        acceptedAt: accepted.acceptedAt,
      });
    },
    async appendIdempotencyKey(worldId, idempotencyKey, eventId, sequenceNumber, createdAt) {
      await db.insert('canonIdempotencyKeys', {
        worldId,
        idempotencyKey,
        eventId,
        sequenceNumber,
        createdAt,
      });
    },
  };
}

/**
 * Public Convex mutation: the canonical commit entry point. Future callers (frontend,
 * director) commit proposals through this. The foundation workflow reuses the same
 * {@link commitProposedEvent} helper directly so it stays within one transaction.
 */
export const validateAndCommitProposedEvent = mutation({
  args: { proposed: proposedEventArgs, traceId: v.string() },
  handler: async (ctx, args): Promise<CommitResult> => {
    // Convex validators use `v.string()` for the literal-union fields, so args arrive
    // typed loosely. validateEventStructure re-checks the literal unions at runtime.
    return commitProposedEvent(createConvexCanonStore(ctx.db), args as unknown as CommitArgs);
  },
});
