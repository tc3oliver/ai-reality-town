/**
 * Convex wiring for the private world warmup workflow (FR-A004, §10.3). Each
 * lifecycle mutation loads the persisted warmup markers, applies a pure
 * transition from {@link ./warmup.ts}, and persists the result. Administrative
 * only — imports/reads are unavailable to public callers. Warmup content is
 * never published here; publication is gated by {@link canPublishWarmup}.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel, Id } from '../_generated/dataModel';
import {
  WarmupError,
  canPublishWarmup,
  changePublicStartDay,
  confirmPublicStartDay,
  createWarmupMarkers,
  failWarmup,
  pauseWarmup,
  recordWarmupDay,
  resumeWarmup,
  rerunWarmup,
  setRecommendedNewcomerEntry,
  type WarmupMarkers,
} from './warmup';

type Db = GenericQueryCtx<DataModel>['db'];
type Ctx = GenericMutationCtx<DataModel>;

type MarkersRow = {
  _id: Id<'warmupMarkers'>;
  markers: WarmupMarkers;
  updatedAt: number;
};

function rowToMarkers(row: MarkersRow): WarmupMarkers {
  return row.markers;
}

async function loadRow(db: Db, worldId: string): Promise<MarkersRow | null> {
  const row = await db.query('warmupMarkers').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique();
  return row ? (row as unknown as MarkersRow) : null;
}

async function apply(ctx: Ctx, worldId: string, now: number, fn: (markers: WarmupMarkers) => WarmupMarkers): Promise<WarmupMarkers> {
  const row = await loadRow(ctx.db, worldId);
  if (!row) throw new WarmupError('WARMUP_NOT_FOUND', 'world has no warmup markers');
  const next = fn(rowToMarkers(row));
  await ctx.db.patch(row._id, { markers: next, updatedAt: now });
  return next;
}

export const startWarmup = internalMutation({
  args: { worldId: v.string(), actualStartDay: v.number(), targetDayCount: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const markers = createWarmupMarkers({ worldId: args.worldId, actualStartDay: args.actualStartDay, targetDayCount: args.targetDayCount });
    const existing = await loadRow(ctx.db, args.worldId);
    if (existing) {
      await ctx.db.patch(existing._id, { markers, updatedAt: args.now });
    } else {
      await ctx.db.insert('warmupMarkers', { schemaVersion: 1, worldId: args.worldId, markers, updatedAt: args.now });
    }
    return { phase: markers.phase };
  },
});

export const pauseWarmupWorld = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => { const m = await apply(ctx, args.worldId, args.now, pauseWarmup); return { phase: m.phase }; },
});

export const resumeWarmupWorld = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => { const m = await apply(ctx, args.worldId, args.now, resumeWarmup); return { phase: m.phase }; },
});

export const rerunWarmupWorld = internalMutation({
  args: { worldId: v.string(), fromDay: v.number(), now: v.number() },
  handler: async (ctx, args) => { const m = await apply(ctx, args.worldId, args.now, (markers) => rerunWarmup(markers, args.fromDay)); return { phase: m.phase }; },
});

export const recordWarmupDayRun = internalMutation({
  args: { worldId: v.string(), day: v.number(), activeArcCount: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const m = await apply(ctx, args.worldId, args.now, (markers) => recordWarmupDay(markers, args.day, args.activeArcCount));
    return { phase: m.phase, lastCompletedDay: m.lastCompletedDay };
  },
});

export const setRecommendedEntry = internalMutation({
  args: { worldId: v.string(), episodeNumber: v.number(), worldDay: v.number(), now: v.number() },
  handler: async (ctx, args) => apply(ctx, args.worldId, args.now, (markers) => setRecommendedNewcomerEntry(markers, { episodeNumber: args.episodeNumber, worldDay: args.worldDay })),
});

export const confirmWarmupPublicStart = internalMutation({
  args: { worldId: v.string(), day: v.number(), now: v.number() },
  handler: async (ctx, args) => apply(ctx, args.worldId, args.now, (markers) => confirmPublicStartDay(markers, args.day)),
});

export const changeWarmupPublicStart = internalMutation({
  args: { worldId: v.string(), day: v.number(), now: v.number() },
  handler: async (ctx, args) => apply(ctx, args.worldId, args.now, (markers) => changePublicStartDay(markers, args.day)),
});

export const failWarmupWorld = internalMutation({
  args: { worldId: v.string(), code: v.string(), now: v.number() },
  handler: async (ctx, args) => apply(ctx, args.worldId, args.now, (markers) => failWarmup(markers, args.code)),
});

/** Operations-only: the warmup markers (the three §10.3 queryable markers + phase). */
export const getWarmupMarkers = internalQuery({
  args: { worldId: v.string() },
  handler: async (ctx, args) => {
    const row = await loadRow(ctx.db, args.worldId);
    if (!row) return null;
    const markers = rowToMarkers(row);
    return {
      ...markers,
      publishable: canPublishWarmup(markers),
    };
  },
});
