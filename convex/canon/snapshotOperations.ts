import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel, Id } from '../_generated/dataModel';
import type { GenericMutationCtx } from 'convex/server';
import { v } from 'convex/values';
import { emptyProjection, type WorldProjection } from './model';
import { replayWorldEvents } from './replay';
import { rowToAcceptedEvent } from './serialize';
import {
  activateRecoveryHead,
  assertSnapshotMatchesHistory,
  clearRecoveryHead,
  createDailySnapshot,
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

function createStore(db: GenericMutationCtx<DataModel>['db']): SnapshotRecoveryStore {
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
  handler: async (ctx, { worldId }): Promise<WorldProjection> => {
    const [eventRows, head] = await Promise.all([
      ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect(),
      ctx.db.query('canonRecoveryHeads').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique(),
    ]);
    const events = eventRows.map(rowToAcceptedEvent);
    if (!head) return replayWorldEvents(emptyProjection(worldId), events);
    const snapshotRow = await ctx.db.get(head.targetSnapshotId);
    if (!snapshotRow || snapshotRow.worldId !== worldId) throw new Error('RECOVERY_HEAD_CONFLICT');
    const snapshot = rowToSnapshot(snapshotRow);
    assertSnapshotMatchesHistory(snapshot, events);
    return cloneProjection(snapshot.projection);
  },
});
