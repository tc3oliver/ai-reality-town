/**
 * Read a world projection as "latest snapshot + the accepted events after it" rather than
 * replaying the whole accepted-event log (ART-100).
 *
 * ## The baseline trap — read this before substituting it for a full replay
 *
 * Daily snapshots are NOT built from {@link emptyProjection}. `importWorld` persists an
 * `initial` snapshot holding the seeded world (`convex/canon/worldConfig.ts:305-321`, inserted
 * at `:364`), `resolveWorldBaseline` makes that snapshot the replay baseline, and
 * `createDailySnapshot` resumes from it. So a stored snapshot satisfies
 *
 *     snapshot.projection === replayWorldEvents(SEEDED_BASELINE, events through its sequence)
 *
 * whereas every `convex/publicRead` rebuild today computes
 *
 *     replayWorldEvents(emptyProjection(worldId), events)
 *
 * Those two disagree on exactly the fields the seed populates. A caller may substitute this
 * helper for a full replay only if it reads none of {@link SEED_BASELINE_FIELDS}.
 * `snapshotReplay.test.ts` enumerates what the seed actually writes and fails if that set ever
 * grows, so the precondition cannot rot silently as the seed gains fields.
 *
 * The substitution is otherwise exact rather than approximate: `reduceWorldEvent` is a pure
 * left fold whose purity is pinned by a source-scanning test
 * (`convex/canon/reducer.purity.test.ts`), so `reduce(events)` equals
 * `step(reduce(prefix), tail)` for any split point.
 *
 * ## What this bounds, and what it does not
 *
 * It removes the O(total canon) *document* read. It does not make the read O(1) in bytes: a
 * snapshot row holds a whole `WorldProjection`, and `projection.facts` accumulates one entry
 * per `fact_created` for the life of the world, so the single row still grows with history —
 * just with a far smaller constant than the event log it replaces. Convex's per-transaction
 * limit is a byte budget, not a document count, so a world old enough will eventually need
 * either fact compaction or a projection narrower than the full snapshot. That is a real
 * remaining ceiling and not something this helper solves.
 *
 * ## What this deliberately does not do
 *
 * It does not honour an active recovery head. Neither does any `convex/publicRead` rebuild
 * today — they all replay raw history — so honouring one here would be a behaviour change
 * wearing a performance change's clothes. `readOperationalWorldProjection`
 * (`convex/canon/snapshotOperations.ts:122`) remains the rollback-aware reader.
 */

import type { GenericQueryCtx } from 'convex/server';
import type { DataModel } from '../_generated/dataModel';
import { emptyProjection, type WorldProjection } from './model';
import { replayWorldEvents } from './replay';
import { rowToAcceptedEvent } from './serialize';
import { replayFromSnapshot, type CanonSnapshot } from './snapshots';

type ReadDb = GenericQueryCtx<DataModel>['db'];

/**
 * The projection fields a seeded `initial` snapshot populates, and therefore the fields on
 * which snapshot-resumed replay and replay-from-empty legitimately disagree.
 *
 * Sourced from `buildWorldImportPlan` (`convex/canon/worldConfig.ts:305-318`), which is the
 * only writer of an `initial` snapshot.
 */
export const SEED_BASELINE_FIELDS = [
  'locations',
  'locationOccupancy',
  'organizations',
  'organizationMembers',
] as const satisfies ReadonlyArray<keyof WorldProjection>;

export type SeedBaselineField = (typeof SEED_BASELINE_FIELDS)[number];

/**
 * How far back to look for a resumable snapshot before giving up and replaying in full.
 *
 * `by_world_and_sequence` has no `kind` column, so the newest row may be one this helper must
 * not resume from. Scanning a few rows keeps the read bounded while tolerating a run of them;
 * beyond that, falling back to a full replay is correct, just slower.
 */
const SNAPSHOT_SCAN_LIMIT = 8;

/** Snapshot kinds this helper will resume from. `manual` is excluded — see below. */
const RESUMABLE_KINDS = new Set(['daily', 'initial']);

/**
 * Whether a stored row can be resumed from at all.
 *
 * Three rejections, each for a different reason:
 *
 *  - `snapshotVersion` and `projectionHash` are `v.optional` in the schema
 *    (`convex/canon/schema.ts`), and `rowToCanonSnapshot` can only cast them. A row missing
 *    either would reach `validateSnapshot` and throw. Stage 19 is NOT failure-isolated
 *    (`convex/operations/postCommitLive.ts` — a throw there aborts everything after it), so an
 *    incomplete row must degrade to a full replay rather than take the pipeline down. Before
 *    ART-100 these rebuilds never read `canonSnapshots` at all, so this failure mode is new and
 *    is this helper's to contain.
 *  - `manual` snapshots are excluded because nothing constrains when an operator takes one or
 *    what history it corresponds to. No writer emits `manual` today, so this is a guard against
 *    a future one rather than a live defect.
 *  - `kind` itself is optional on the row; `snapshotOperations.ts` reads it as `?? 'initial'`,
 *    and the same default is applied here so the two readers agree.
 *
 * What this deliberately does NOT do is prove the snapshot matches accepted history the way
 * `assertSnapshotMatchesHistory` does. That check replays the whole prefix, which is precisely
 * the cost this helper exists to avoid, so trust in a row is delegated to whoever wrote it.
 * `readOperationalWorldProjection` remains the reader that proves rather than trusts.
 */
function isResumableSnapshotRow(row: SnapshotRow & { kind?: string }): boolean {
  return row.snapshotVersion !== undefined
    && row.projectionHash !== undefined
    && RESUMABLE_KINDS.has(row.kind ?? 'initial');
}

type SnapshotRow = {
  worldId: string;
  worldDay?: number;
  lastSequenceNumber: number;
  snapshotVersion?: number;
  projection: unknown;
  projectionHash?: string;
  createdAt: number;
};

function rowToCanonSnapshot(row: SnapshotRow): CanonSnapshot {
  return {
    snapshotVersion: row.snapshotVersion as 1,
    worldId: row.worldId,
    worldDay: row.worldDay as number,
    lastSequenceNumber: row.lastSequenceNumber,
    projection: row.projection as WorldProjection,
    projectionHash: row.projectionHash as string,
    createdAt: row.createdAt,
  };
}

/**
 * The newest snapshot for a world, or null when the world was never seeded and no daily
 * snapshot has been written yet.
 *
 * A single indexed row read. `by_world_and_sequence` orders by `lastSequenceNumber`, so
 * `.order('desc').first()` is the newest without reading the rest — the pattern
 * `convex/canon/queries.ts:89-98` already uses, and the one
 * `createSnapshotRecoveryStore.loadLatestSnapshot` should be using instead of collecting
 * every snapshot row and filtering in JS (`convex/canon/snapshotOperations.ts:67-72`).
 */
export async function readLatestSnapshot(db: ReadDb, worldId: string): Promise<CanonSnapshot | null> {
  // The overwhelmingly common case is one row: the newest snapshot, written by stage 20, is
  // resumable. Pay for exactly that, and only look further back when it is not.
  const newest = await db
    .query('canonSnapshots')
    .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId))
    .order('desc')
    .first();
  if (!newest) return null;
  if (isResumableSnapshotRow(newest as SnapshotRow)) return rowToCanonSnapshot(newest as SnapshotRow);

  const rows = await db
    .query('canonSnapshots')
    .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId))
    .order('desc')
    .take(SNAPSHOT_SCAN_LIMIT);
  const usable = rows.find((row) => isResumableSnapshotRow(row as SnapshotRow));
  return usable ? rowToCanonSnapshot(usable as SnapshotRow) : null;
}

/**
 * A world's current projection, resumed from its newest snapshot.
 *
 * Reads one snapshot row plus only the accepted events after it, so the cost is bounded by
 * how far the world has advanced since the last snapshot — one world day, because stage 20
 * writes a daily snapshot (`convex/operations/postCommitLive.ts:789-805`) — rather than by
 * total canon size.
 *
 * Falls back to a full replay from `emptyProjection` when no snapshot exists, which is the
 * pre-ART-100 behaviour and the correct answer for a world that has never been snapshotted.
 *
 * Callers must not read {@link SEED_BASELINE_FIELDS} from the result unless they intend the
 * seeded baseline to be included; see this module's docblock.
 */
export async function readProjectionViaSnapshot(db: ReadDb, worldId: string): Promise<WorldProjection> {
  const snapshot = await readLatestSnapshot(db, worldId);
  if (!snapshot) {
    const rows = await db
      .query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId))
      .collect();
    return replayWorldEvents(emptyProjection(worldId), rows.map(rowToAcceptedEvent));
  }
  const tailRows = await db
    .query('canonEvents')
    .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).gt('sequenceNumber', snapshot.lastSequenceNumber))
    .collect();
  return replayFromSnapshot(snapshot, tailRows.map(rowToAcceptedEvent));
}
