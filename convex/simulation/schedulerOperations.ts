import { internalMutation, internalQuery } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';
import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';
import {
  configureWorldSchedule,
  cursorOrdinal,
  deterministicSlotSeed,
  nextCursor,
  publicDueOrdinal,
  SchedulerError,
  slotKey,
  type SlotTrigger,
  type WorldScheduleState,
} from './scheduler';

type MutationDb = GenericMutationCtx<import('../_generated/dataModel').DataModel>['db'];

function assertNow(now: number): void {
  if (!Number.isFinite(now)) throw new SchedulerError('INVALID_CLOCK', 'clock value must be finite');
}

function rowState(row: Doc<'worldSchedules'>): WorldScheduleState {
  return {
    worldId: row.worldId, mode: row.mode, status: row.status, baseSeed: row.baseSeed,
    anchorRealTimeMs: row.anchorRealTimeMs, anchorWorldDay: row.anchorWorldDay,
    nextWorldDay: row.nextWorldDay, nextTimeSlot: row.nextTimeSlot,
    publishEnabled: row.publishEnabled, pausedAt: row.pausedAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

/**
 * Load the schedule row for a world, or throw `SCHEDULE_NOT_FOUND`.
 *
 * Exported so the authorized operations console (FR-K001) drives the SAME control
 * logic as the internal mutations below instead of reimplementing it. Callers that
 * are reachable by an unauthenticated client MUST authorize before calling this.
 */
export async function loadScheduleRow(db: MutationDb, worldId: string): Promise<Doc<'worldSchedules'>> {
  const row = await db.query('worldSchedules').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique();
  if (!row) throw new SchedulerError('SCHEDULE_NOT_FOUND', 'world schedule does not exist');
  return row;
}

const scheduleRow = loadScheduleRow;

/** Pause a running world. Idempotent: pausing a paused world changes nothing. */
export async function pauseWorldSchedule(db: MutationDb, worldId: string, now: number): Promise<Doc<'worldSchedules'>['status']> {
  assertNow(now);
  const row = await loadScheduleRow(db, worldId);
  if (row.status === 'running') await db.patch(row._id, { status: 'paused', pausedAt: now, updatedAt: now });
  return 'paused';
}

/**
 * Resume a paused world, shifting the real-time anchor by the paused duration so
 * the public clock does not jump. Idempotent: resuming a running world is a no-op.
 */
export async function resumeWorldSchedule(db: MutationDb, worldId: string, now: number): Promise<Doc<'worldSchedules'>['status']> {
  assertNow(now);
  const row = await loadScheduleRow(db, worldId);
  if (row.status === 'paused' && row.pausedAt !== undefined) {
    if (now < row.pausedAt) throw new SchedulerError('INVALID_CLOCK', 'resume time precedes pause time');
    await db.patch(row._id, {
      status: 'running', anchorRealTimeMs: row.anchorRealTimeMs + (now - row.pausedAt),
      pausedAt: undefined, updatedAt: now,
    });
  }
  return 'running';
}

/** Reserve `count` slots from the world's cursor. Shared by the cron, the internal mutations, and the console. */
export async function reserveSlots(
  db: MutationDb, worldId: string, count: number, trigger: SlotTrigger, now: number,
): Promise<Id<'scheduledSlots'>[]> {
  return reserve(db, await loadScheduleRow(db, worldId), count, trigger, now);
}

/** Requeue a failed slot for another attempt. Never touches Canon; the slot keeps its idempotency key. */
export async function retrySlotRun(db: MutationDb, slotId: Id<'scheduledSlots'>, now: number): Promise<void> {
  assertNow(now);
  const row = await db.get(slotId);
  if (!row || row.status !== 'failed') throw new SchedulerError('INVALID_SLOT_TRANSITION', 'only failed slots may retry');
  await db.patch(slotId, { status: 'queued', trigger: 'retry', completedAt: undefined, errorCode: undefined, updatedAt: now });
}

/** Read a world's schedule plus its full slot queue, ordered by world day then time slot. */
export async function readScheduleInspection(
  db: GenericQueryCtx<import('../_generated/dataModel').DataModel>['db'],
  worldId: string,
): Promise<{ schedule: Doc<'worldSchedules'> | null; runs: Doc<'scheduledSlots'>[] }> {
  const [schedule, runs] = await Promise.all([
    db.query('worldSchedules').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique(),
    db.query('scheduledSlots').withIndex('by_world_and_status', (q) => q.eq('worldId', worldId)).collect(),
  ]);
  return {
    schedule,
    runs: runs.sort((a, b) => a.worldDay - b.worldDay || TIME_SLOTS.indexOf(a.timeSlot) - TIME_SLOTS.indexOf(b.timeSlot)),
  };
}

async function reserve(
  db: MutationDb,
  row: Doc<'worldSchedules'>,
  count: number,
  trigger: SlotTrigger,
  now: number,
): Promise<Id<'scheduledSlots'>[]> {
  if (!Number.isSafeInteger(count) || count < 0 || count > 450 || !Number.isFinite(now)) {
    throw new SchedulerError('INVALID_ADVANCE_COUNT', 'reservation count must be between 0 and 450');
  }
  let worldDay = row.nextWorldDay;
  let timeSlot: TimeSlot = row.nextTimeSlot;
  const ids: Id<'scheduledSlots'>[] = [];
  for (let index = 0; index < count; index++) {
    const key = slotKey(row.worldId, worldDay, timeSlot);
    const existing = await db.query('scheduledSlots').withIndex('by_slot_key', (q) => q.eq('slotKey', key)).unique();
    if (!existing) {
      ids.push(await db.insert('scheduledSlots', {
        slotKey: key, worldId: row.worldId, worldDay, timeSlot, trigger, status: 'queued',
        seed: deterministicSlotSeed(row.baseSeed, worldDay, timeSlot),
        publishEnabled: row.publishEnabled, idempotencyKey: key, attemptCount: 0,
        createdAt: now, updatedAt: now,
      }));
    }
    ({ worldDay, timeSlot } = nextCursor(worldDay, timeSlot));
  }
  await db.patch(row._id, { nextWorldDay: worldDay, nextTimeSlot: timeSlot, updatedAt: now });
  return ids;
}

export const configureSchedule = internalMutation({
  args: {
    worldId: v.string(),
    mode: v.union(v.literal('public'), v.literal('development'), v.literal('test'), v.literal('warmup')),
    baseSeed: v.number(), anchorRealTimeMs: v.number(), anchorWorldDay: v.number(),
    publishEnabled: v.optional(v.boolean()), createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('worldSchedules').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).unique();
    if (existing) throw new SchedulerError('SCHEDULE_ALREADY_EXISTS', 'world schedule already exists');
    const state = configureWorldSchedule(args);
    return ctx.db.insert('worldSchedules', state);
  },
});

export const pauseSchedule = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, { worldId, now }) => {
    await pauseWorldSchedule(ctx.db, worldId, now);
  },
});

export const resumeSchedule = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, { worldId, now }) => {
    await resumeWorldSchedule(ctx.db, worldId, now);
  },
});

export const tickPublicSchedule = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, { worldId, now }) => {
    const row = await scheduleRow(ctx.db, worldId);
    const state = rowState(row);
    if (state.mode !== 'public') throw new SchedulerError('INVALID_SCHEDULE_MODE', 'clock tick requires public mode');
    if (state.status === 'paused') return [];
    const count = Math.max(0, publicDueOrdinal(state, now) - cursorOrdinal(state) + 1);
    return reserve(ctx.db, row, count, 'clock', now);
  },
});

/** Minute cron target: reserve every due slot for every running public world. */
export const tickAllPublicSchedules = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query('worldSchedules')
      .withIndex('by_mode_and_status', (q) => q.eq('mode', 'public').eq('status', 'running')).collect();
    let reserved = 0;
    for (const row of rows) {
      const state = rowState(row);
      const count = Math.max(0, publicDueOrdinal(state, now) - cursorOrdinal(state) + 1);
      reserved += (await reserve(ctx.db, row, count, 'clock', now)).length;
    }
    return { worldCount: rows.length, reserved };
  },
});

export const advanceOneSlot = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, { worldId, now }) => reserve(ctx.db, await scheduleRow(ctx.db, worldId), 1, 'manual-slot', now),
});

export const advanceOneWorldDay = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, { worldId, now }) => reserve(ctx.db, await scheduleRow(ctx.db, worldId), TIME_SLOTS.length, 'manual-day', now),
});

export const accelerateSchedule = internalMutation({
  args: { worldId: v.string(), worldDays: v.number(), now: v.number() },
  handler: async (ctx, { worldId, worldDays, now }) => {
    const row = await scheduleRow(ctx.db, worldId);
    if (row.mode === 'public') throw new SchedulerError('INVALID_SCHEDULE_MODE', 'accelerated runs require non-public mode');
    if (!Number.isSafeInteger(worldDays) || worldDays < 1 || worldDays > 90) {
      throw new SchedulerError('INVALID_ADVANCE_COUNT', 'accelerated world days must be between 1 and 90');
    }
    return reserve(ctx.db, row, worldDays * TIME_SLOTS.length, 'accelerated', now);
  },
});

export const startScheduledSlot = internalMutation({
  args: { slotId: v.id('scheduledSlots'), now: v.number() },
  handler: async (ctx, { slotId, now }) => {
    assertNow(now);
    const row = await ctx.db.get(slotId);
    if (!row || row.status !== 'queued') throw new SchedulerError('INVALID_SLOT_TRANSITION', 'only queued slots may start');
    await ctx.db.patch(slotId, { status: 'running', attemptCount: row.attemptCount + 1, startedAt: now, updatedAt: now, errorCode: undefined });
  },
});

export const completeScheduledSlot = internalMutation({
  args: { slotId: v.id('scheduledSlots'), committedEventId: v.optional(v.string()), now: v.number() },
  handler: async (ctx, { slotId, committedEventId, now }) => {
    assertNow(now);
    const row = await ctx.db.get(slotId);
    if (!row || row.status !== 'running') throw new SchedulerError('INVALID_SLOT_TRANSITION', 'only running slots may complete');
    await ctx.db.patch(slotId, { status: 'completed', committedEventId, completedAt: now, updatedAt: now });
  },
});

export const failScheduledSlot = internalMutation({
  args: { slotId: v.id('scheduledSlots'), errorCode: v.string(), now: v.number() },
  handler: async (ctx, { slotId, errorCode, now }) => {
    assertNow(now);
    const row = await ctx.db.get(slotId);
    if (!row || row.status !== 'running') throw new SchedulerError('INVALID_SLOT_TRANSITION', 'only running slots may fail');
    await ctx.db.patch(slotId, { status: 'failed', errorCode, completedAt: now, updatedAt: now });
  },
});

export const retryScheduledSlot = internalMutation({
  args: { slotId: v.id('scheduledSlots'), now: v.number() },
  handler: (ctx, { slotId, now }) => retrySlotRun(ctx.db, slotId, now),
});

export const inspectSchedule = internalQuery({
  args: { worldId: v.string() },
  handler: (ctx, { worldId }) => readScheduleInspection(ctx.db, worldId),
});
