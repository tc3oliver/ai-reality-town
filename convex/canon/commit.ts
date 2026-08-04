/**
 * Idempotent canon event commit.
 *
 * The commit pipeline is implemented as a pure-ish helper over a {@link CanonCommitStore}
 * repository interface, so the SAME logic runs:
 *   - inside the server-only Convex mutation {@link validateAndCommitProposedEvent}, and
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

import { internalMutation } from '../_generated/server';
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
  /** Serialize the complete read-validate-append transaction for one world. */
  runExclusive<T>(worldId: string, operation: () => Promise<T>): Promise<T>;
  findExistingCommit(
    worldId: string,
    idempotencyKey: string,
  ): Promise<{ eventId: string; sequenceNumber: number } | null>;
  loadAcceptedEvents(worldId: string): Promise<AcceptedEvent[]>;
  loadCanonRuleContext(worldId: string): Promise<CanonRuleContext | null>;
  /** Atomically append the accepted event and its idempotency record. */
  appendCommit(accepted: AcceptedEvent): Promise<void>;
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

  return store.runExclusive(proposed.worldId, async () => {
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
    const persistedContext = await store.loadCanonRuleContext(proposed.worldId);
    const ruleContext: CanonRuleContext = {
      ...(persistedContext ?? { worldId: proposed.worldId, rules: [] }),
      knownEventIds: events.map((event) => event.eventId),
    };

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
      traceId,
    };

    // 6. Append event + idempotency record as one repository operation.
    await store.appendCommit(accepted);

    return { eventId, sequenceNumber, deduplicated: false };
  });
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
    runExclusive: (_worldId, operation) => operation(),
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
      const [rules, characters, locations, items, organizations] = await Promise.all([
        db.query('worldImmutableRules').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
        db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
        db.query('worldLocations').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
        db.query('worldAssets').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
        db.query('worldOrganizations').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
      ]);
      if (rules.length === 0 && characters.length === 0 && locations.length === 0 && items.length === 0 && organizations.length === 0) return null;
      const activeLocations = locations.filter((row) => (row.payload as { active?: unknown }).active === true);
      return {
        worldId,
        rules: rules.map((row) => row.payload as CanonImmutableRule),
        characterIds: characters.map((row) => row.characterId),
        locationIds: activeLocations.map((row) => row.locationId),
        itemIds: items.map((row) => row.assetId),
        organizationIds: organizations.map((row) => row.organizationId),
        initialCharacterAlive: Object.fromEntries(characters.map((row) => [row.characterId, true])),
        initialItemOwners: Object.fromEntries(items.map((row) => [row.assetId, row.ownerCharacterId])),
        locationConnections: Object.fromEntries(activeLocations.map((row) => {
          const connected = (row.payload as { connectedLocationIds?: unknown }).connectedLocationIds;
          return [row.locationId, Array.isArray(connected)
            ? connected.filter((id): id is string => typeof id === 'string')
            : []];
        })),
      };
    },
    async appendCommit(accepted) {
      // Split the envelope off the accepted event: the proposed event is stored as
      // `payload`, the envelope as top-level columns.
      const {
        eventId: _eventId,
        acceptedAt: _acceptedAt,
        sequenceNumber: _sequenceNumber,
        validationVersion: _validationVersion,
        traceId: _traceId,
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
        traceId: accepted.traceId,
        acceptedAt: accepted.acceptedAt,
      });
      await db.insert('canonIdempotencyKeys', {
        worldId: accepted.worldId,
        idempotencyKey: accepted.idempotencyKey,
        eventId: accepted.eventId,
        sequenceNumber: accepted.sequenceNumber,
        createdAt: accepted.acceptedAt,
      });
    },
  };
}

/**
 * Server-only Convex mutation: the canonical commit entry point. Server callers (the
 * director, the scheduler, post-commit orchestration) commit proposals through this.
 * The foundation workflow reuses the same {@link commitProposedEvent} helper directly
 * so it stays within one transaction.
 *
 * SECURITY (ART-62, NFR-005): this is an `internalMutation`, never a public one. Canon
 * is the trusted, append-only record of the world; a client-reachable commit entry
 * point would let any anonymous caller holding the deployment URL forge canonical
 * history, since this pipeline authenticates nothing and validates only the SHAPE of a
 * proposal. Keeping it internal means only server-side Convex functions can reach it.
 * Do not widen this back to `mutation` — add an authorized server caller instead.
 */
export const validateAndCommitProposedEvent = internalMutation({
  args: { proposed: proposedEventArgs, traceId: v.string() },
  handler: async (ctx, args): Promise<CommitResult> => {
    // Convex validators use `v.string()` for the literal-union fields, so args arrive
    // typed loosely. validateEventStructure re-checks the literal unions at runtime.
    return commitProposedEvent(createConvexCanonStore(ctx.db), args as unknown as CommitArgs);
  },
});
