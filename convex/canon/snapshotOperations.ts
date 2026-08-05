import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel, Id } from '../_generated/dataModel';
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';
import type { WorldProjection } from './model';
import { replayWorldEvents } from './replay';
import { rowToAcceptedEvent } from './serialize';
import {
  activateRecoveryHead,
  assertSnapshotMatchesHistory,
  clearRecoveryHead,
  createDailySnapshot,
  resolveWorldBaseline,
  type RecoveryHead,
  type SnapshotKind,
  type SnapshotRecoveryStore,
  type StoredCanonSnapshot,
} from './snapshotManager';
import { cloneProjection, type CanonSnapshot } from './snapshots';

type SnapshotRow = {
  _id: Id<'canonSnapshots'>;
  snapshotVersion?: number;
  worldId: string;
  worldDay?: number;
  lastSequenceNumber: number;
  projection: unknown;
  projectionHash?: string;
  kind?: SnapshotKind;
  createdAt: number;
};

function rowToSnapshot(row: SnapshotRow): StoredCanonSnapshot {
  return {
    snapshotId: row._id,
    snapshotVersion: row.snapshotVersion as 1,
    worldId: row.worldId,
    worldDay: row.worldDay as number,
    lastSequenceNumber: row.lastSequenceNumber,
    projection: row.projection as WorldProjection,
    projectionHash: row.projectionHash as string,
    kind: row.kind ?? 'initial',
    createdAt: row.createdAt,
  };
}

/**
 * Adapt Convex `db` to the snapshot/recovery store.
 *
 * Exported so the authorized operations console (FR-K001) creates snapshots through
 * the SAME store as the internal mutations below rather than reimplementing the
 * snapshot rules. Callers reachable by an unauthenticated client MUST authorize first.
 */
export function createSnapshotRecoveryStore(db: GenericMutationCtx<DataModel>['db']): SnapshotRecoveryStore {
  return {
    async loadAcceptedEvents(worldId) {
      const rows = await db.query('canonEvents')
        .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect();
      return rows.map(rowToAcceptedEvent);
    },
    async findDailySnapshot(worldId, worldDay) {
      const row = await db.query('canonSnapshots')
        .withIndex('by_world_day_and_kind', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay).eq('kind', 'daily'))
        .unique();
      return row ? rowToSnapshot(row) : null;
    },
    async loadLatestSnapshot(worldId, throughWorldDay) {
      const rows = await db.query('canonSnapshots')
        .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).order('desc').collect();
      const row = rows.find((candidate) => candidate.worldDay !== undefined && candidate.worldDay <= throughWorldDay);
      return row ? rowToSnapshot(row) : null;
    },
    async loadSnapshot(worldId, snapshotId) {
      const row = await db.get(snapshotId as Id<'canonSnapshots'>);
      return row?.worldId === worldId ? rowToSnapshot(row) : null;
    },
    async loadInitialSnapshot(worldId) {
      const row = await db.query('canonSnapshots')
        .withIndex('by_world_day_and_kind', (q) => q.eq('worldId', worldId).eq('worldDay', 0).eq('kind', 'initial'))
        .unique();
      return row ? rowToSnapshot(row) : null;
    },
    async saveSnapshot(snapshot: CanonSnapshot, kind: SnapshotKind) {
      const snapshotId = await db.insert('canonSnapshots', { ...snapshot, kind });
      return { ...snapshot, snapshotId, kind };
    },
    async loadRecoveryHead(worldId) {
      const row = await db.query('canonRecoveryHeads').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique();
      return row ? {
        worldId: row.worldId,
        targetSnapshotId: row.targetSnapshotId,
        targetSequenceNumber: row.targetSequenceNumber,
        activatedAt: row.activatedAt,
        operatorId: row.operatorId,
        reason: row.reason,
      } : null;
    },
    async replaceRecoveryHead(worldId, head) {
      const current = await db.query('canonRecoveryHeads').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique();
      if (current) await db.delete(current._id);
      if (head) await db.insert('canonRecoveryHeads', {
        ...head,
        targetSnapshotId: head.targetSnapshotId as Id<'canonSnapshots'>,
      });
    },
    async appendRecoveryAudit(entry) {
      await db.insert('canonRecoveryAudit', {
        ...entry,
        targetSnapshotId: entry.targetSnapshotId as Id<'canonSnapshots'> | undefined,
      });
    },
  };
}

const createStore = createSnapshotRecoveryStore;

/**
 * Replay a world to its current operational projection, honouring an active
 * recovery head. Exported for the authorized operations console's "inspect world
 * state" control (FR-K001); authorize before calling.
 */
export async function readOperationalWorldProjection(
  db: GenericQueryCtx<DataModel>['db'],
  worldId: string,
): Promise<WorldProjection> {
  const [eventRows, head, initialRow] = await Promise.all([
    db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect(),
    db.query('canonRecoveryHeads').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique(),
    db.query('canonSnapshots')
      .withIndex('by_world_day_and_kind', (q) => q.eq('worldId', worldId).eq('worldDay', 0).eq('kind', 'initial'))
      .unique(),
  ]);
  const events = eventRows.map(rowToAcceptedEvent);
  const baseline = resolveWorldBaseline(worldId, initialRow ? rowToSnapshot(initialRow) : null);
  if (!head) {
    return replayWorldEvents(
      cloneProjection(baseline.projection),
      events.filter((event) => event.sequenceNumber > baseline.lastSequenceNumber),
    );
  }
  const snapshotRow = await db.get(head.targetSnapshotId);
  if (!snapshotRow || snapshotRow.worldId !== worldId) throw new Error('RECOVERY_HEAD_CONFLICT');
  const snapshot = rowToSnapshot(snapshotRow);
  assertSnapshotMatchesHistory(snapshot, events, baseline);
  return cloneProjection(snapshot.projection);
}

export const persistDailySnapshot = internalMutation({
  args: { worldId: v.string(), worldDay: v.number(), createdAt: v.number() },
  handler: (ctx, args) => createDailySnapshot(createStore(ctx.db), args.worldId, args.worldDay, args.createdAt),
});

export const activateRollback = internalMutation({
  args: {
    worldId: v.string(), snapshotId: v.id('canonSnapshots'), operatorId: v.string(),
    reason: v.string(), createdAt: v.number(),
  },
  handler: (ctx, args) => activateRecoveryHead(createStore(ctx.db), args),
});

export const clearRollback = internalMutation({
  args: { worldId: v.string(), operatorId: v.string(), reason: v.string(), createdAt: v.number() },
  handler: (ctx, args) => clearRecoveryHead(createStore(ctx.db), args),
});

export const getRecoveryState = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }): Promise<{ head: RecoveryHead | null; audit: unknown[] }> => {
    const [head, audit] = await Promise.all([
      ctx.db.query('canonRecoveryHeads').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique(),
      ctx.db.query('canonRecoveryAudit').withIndex('by_world_and_time', (q) => q.eq('worldId', worldId)).order('desc').collect(),
    ]);
    return {
      head: head ? {
        worldId: head.worldId, targetSnapshotId: head.targetSnapshotId,
        targetSequenceNumber: head.targetSequenceNumber, activatedAt: head.activatedAt,
        operatorId: head.operatorId, reason: head.reason,
      } : null,
      audit,
    };
  },
});

export const getOperationalWorldProjection = internalQuery({
  args: { worldId: v.string() },
  handler: (ctx, { worldId }): Promise<WorldProjection> => readOperationalWorldProjection(ctx.db, worldId),
});
