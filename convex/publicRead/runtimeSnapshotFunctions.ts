/**
 * Convex wiring for the Public Runtime Snapshot (FR-N007 / ART-116).
 *
 * Two capture triggers, and both are load-bearing:
 *
 * - `rebuildLiveProjection` captures when **content** changes. It runs per accepted Canon
 *   event, which is exactly when a new world state exists to record.
 * - {@link captureAllPublicRuntimeSnapshots} captures when **status** changes, and proves
 *   liveness. A world that is paused, or whose slots are failing, produces no Canon events
 *   at all — so the event-driven trigger would never fire again and the last snapshot
 *   would keep asserting whatever it said the day it was written. The hourly sweep is what
 *   lets `observedAt` age out into `stale` instead.
 *
 * The read side touches `publicRuntimeSnapshots` and nothing else: no Canon read, no
 * schedule read, no provider call. A public visitor can therefore be served while the
 * entire simulation is down.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';

import { internalMutation, query } from '../_generated/server';
import type { DataModel, Id } from '../_generated/dataModel';
import { LIVE_MODEL_KIND } from './liveState';
import { selectPublicDynamicProjection } from './publicDynamicProjection';
import { serveReadModel } from './readModel';
import { readStore } from './readModelFunctions';
import {
  commitRuntimeSnapshot,
  serveRuntimeSnapshot,
  type PublicRuntimeSnapshot,
  type RuntimeSnapshotReadStore,
  type RuntimeSnapshotStore,
  type StoredRuntimeSnapshot,
} from './runtimeSnapshot';
import { publicRuntimeSnapshotEnvelopeValidator } from './runtimeSnapshotValidators';

type SnapshotRow = {
  _id: Id<'publicRuntimeSnapshots'>;
  schemaVersion: 1;
  worldId: string;
  runtimeVersion: number;
  snapshotSequence: number;
  sourceRuntimeSequence: number;
  status: 'live' | 'paused';
  mapId: string;
  characterStates: StoredRuntimeSnapshot['characterStates'];
  activeSceneStates: StoredRuntimeSnapshot['activeSceneStates'];
  contentUpdatedAt: number;
  contentHash: string;
  createdAt: number;
  observedAt: number;
  isCurrent: boolean;
};

function rowToStored(row: SnapshotRow): StoredRuntimeSnapshot {
  return {
    id: row._id,
    schemaVersion: row.schemaVersion,
    worldId: row.worldId,
    runtimeVersion: row.runtimeVersion,
    snapshotSequence: row.snapshotSequence,
    sourceRuntimeSequence: row.sourceRuntimeSequence,
    status: row.status,
    mapId: row.mapId,
    characterStates: row.characterStates,
    activeSceneStates: row.activeSceneStates,
    contentUpdatedAt: row.contentUpdatedAt,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    observedAt: row.observedAt,
    isCurrent: row.isCurrent,
  };
}

function toInsertable(record: PublicRuntimeSnapshot) {
  return {
    schemaVersion: record.schemaVersion,
    worldId: record.worldId,
    runtimeVersion: record.runtimeVersion,
    snapshotSequence: record.snapshotSequence,
    sourceRuntimeSequence: record.sourceRuntimeSequence,
    status: record.status,
    mapId: record.mapId,
    characterStates: record.characterStates,
    activeSceneStates: record.activeSceneStates,
    contentUpdatedAt: record.contentUpdatedAt,
    contentHash: record.contentHash,
    createdAt: record.createdAt,
    observedAt: record.observedAt,
    isCurrent: record.isCurrent,
  };
}

/** Read-only store adapter backed by a Convex query context. */
export function runtimeSnapshotReadStore(db: GenericQueryCtx<DataModel>['db']): RuntimeSnapshotReadStore {
  return {
    async loadCurrent(worldId) {
      const row = await db
        .query('publicRuntimeSnapshots')
        .withIndex('by_world_and_current', (q) => q.eq('worldId', worldId).eq('isCurrent', true))
        .unique();
      return row ? rowToStored(row) : null;
    },
  };
}

/** Full store adapter backed by a Convex mutation context. */
export function runtimeSnapshotWriteStore(db: GenericMutationCtx<DataModel>['db']): RuntimeSnapshotStore {
  return {
    async loadCurrent(worldId) {
      const row = await db
        .query('publicRuntimeSnapshots')
        .withIndex('by_world_and_current', (q) => q.eq('worldId', worldId).eq('isCurrent', true))
        .unique();
      return row ? rowToStored(row) : null;
    },
    async insertSnapshot(record) {
      return db.insert('publicRuntimeSnapshots', toInsertable(record));
    },
    async demote(rowId) {
      await db.patch(rowId as Id<'publicRuntimeSnapshots'>, { isCurrent: false });
    },
    async touchObservedAt(rowId, observedAt) {
      await db.patch(rowId as Id<'publicRuntimeSnapshots'>, { observedAt });
    },
  };
}

/**
 * Public read of the runtime snapshot and its freshness verdict (FR-N007).
 *
 * The server clock is authoritative. ART-128 (FR-O009) removed the caller-suppliable
 * `nowMs` argument this query used to accept: freshness is the one thing the snapshot
 * asserts about itself, and letting the caller name the instant let anyone make a
 * five-hour-old snapshot report `live`, or a current one report `stale`, purely by
 * choosing a number. {@link serveRuntimeSnapshot} keeps `nowMs` as a parameter so a test
 * can still sit at a chosen instant — but it is reachable only from the server.
 *
 * Returns `null` until the first capture — the table starts empty and no history is
 * backfilled, the same contract as `getPublicDynamicProjection`.
 */
export const getPublicRuntimeSnapshot = query({
  args: { worldId: v.string() },
  returns: v.union(publicRuntimeSnapshotEnvelopeValidator, v.null()),
  handler: async (ctx, args) =>
    serveRuntimeSnapshot(runtimeSnapshotReadStore(ctx.db), args.worldId, Date.now()),
});

/**
 * Hourly cron target: re-observe every public world, running *and* paused.
 *
 * The paused ones are the point. They emit no Canon events, so nothing else in the system
 * would ever revisit them, and their snapshot's `status` would remain whatever it was when
 * the world last moved. Content-hash dedup means an idle world costs one `observedAt`
 * patch per hour rather than a new row.
 */
export const captureAllPublicRuntimeSnapshots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query('worldSchedules')
      .withIndex('by_mode_and_status', (q) => q.eq('mode', 'public'))
      .collect();

    let captured = 0;
    let deduplicated = 0;
    for (const row of rows) {
      const served = await serveReadModel(
        readStore(ctx.db),
        row.worldId,
        LIVE_MODEL_KIND,
        `live:${row.worldId}`,
      );
      if (!served) continue;
      const dynamic = selectPublicDynamicProjection(served.payload);
      if (!dynamic) continue;

      const result = await commitRuntimeSnapshot(runtimeSnapshotWriteStore(ctx.db), {
        worldId: row.worldId,
        dynamic,
        worldStatus: row.status,
        now,
      });
      if (result.captured) captured += 1;
      else if (result.reason === 'deduplicated') deduplicated += 1;
    }
    return { worldCount: rows.length, captured, deduplicated };
  },
});
