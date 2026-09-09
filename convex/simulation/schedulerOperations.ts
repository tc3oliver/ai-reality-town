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
  planScheduleModeChange,
  publicDueOrdinal,
  SchedulerError,
  slotKey,
  type OperatorScheduleMode,
  type ScheduleModeChangePlan,
  type SlotTrigger,
  type WorldScheduleState,
} from './scheduler';
import { readEmergencyStopState } from './emergencyStopOperations';
import { worldDayRunId } from './worldDayLive';

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

/**
 * Move a world between `development` and `public` (FR-K001 / ART-172).
 *
 * The one writer of `worldSchedules.mode` after creation. `configureSchedule` refuses outright
 * when a schedule already exists, so before this the only way to promote a world was a hand patch
 * of the row through the Convex dashboard: unaudited, unreasoned, and invisible to
 * `operatorAuditLog`. Every other privileged world action on the console is authorized and
 * audited; the one with the largest blast radius was not reachable at all.
 *
 * The decision is {@link planScheduleModeChange}'s, not this function's — this only supplies the
 * two facts a pure planner cannot read (the row, and whether the kill switch is engaged) and
 * performs the write. Idempotent: a repeat returns `changed: false` and writes nothing, which is
 * what lets the caller audit it as a `no_op` rather than as a second promotion.
 *
 * The halt is read from `worldEmergencyStops`, NOT inferred from the schedule row: the kill switch
 * deliberately leaves `status` and the queue intact, so a halted world reads `running` here.
 *
 * Callers reachable by an unauthenticated client MUST authorize before calling this.
 */
export async function changeWorldScheduleMode(
  db: MutationDb,
  worldId: string,
  input: { targetMode: OperatorScheduleMode; now: number },
): Promise<ScheduleModeChangePlan> {
  assertNow(input.now);
  const row = await loadScheduleRow(db, worldId);
  const stop = await readEmergencyStopState(db, worldId);
  const plan = planScheduleModeChange({
    current: row.mode,
    status: row.status,
    targetMode: input.targetMode,
    simulationHalted: stop.engaged,
  });
  if (plan.changed) await db.patch(row._id, { mode: plan.to, updatedAt: input.now });
  return plan;
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

/** One earlier attempt at a slot that failed, as an operator reads it. */
export type SlotAttemptFailure = {
  attempt: number;
  stage: string;
  errorCode: string;
  errorMessage: string;
};

export type SlotAttemptHistory = {
  slotKey: string;
  worldDay: number;
  timeSlot: TimeSlot;
  /** Oldest attempt first, so the sequence reads in the order it happened. */
  failures: SlotAttemptFailure[];
};

/**
 * How many slots one inspection will read attempt history for.
 *
 * The queue itself is already collected in full, but each slot's history costs its own index scan,
 * so this is bounded and the caller is told what was left out. A world that is thrashing has far
 * more than this many retried slots and the newest ones are the ones an operator is looking at.
 */
export const ATTEMPT_HISTORY_SLOT_LIMIT = 25;

/**
 * Why a retried slot's earlier failures are read from `worldDayCheckpoints` rather than kept on the
 * slot row (ART-150).
 *
 * The slot row holds ONE `errorCode`, and it is cleared the moment the slot is claimed again —
 * correctly, because a claimed slot has no failure yet, and leaving the old code there is exactly
 * what made a recovered slot read as a broken one. But clearing it is also what discards the
 * history, and an operator deciding whether to retry a slot a third time needs to know what the
 * first two attempts failed with.
 *
 * `worldDayCheckpoints` already holds precisely that: one row per `(runId, stage, attempt)`, never
 * patched across attempts, carrying the stable code and message. The run id is DERIVED from the
 * slot's `(worldId, worldDay, timeSlot)`, so no link has to be stored to find it. Copying those
 * failures onto the slot row would give the same fact two homes that could disagree; reading them
 * here gives it one.
 *
 * Slots that never ran through the world-day orchestrator — a rules-only slot at FR-M004 rung 4 or
 * 5 — write no checkpoints, so they contribute no history. Their failure is a defect in a pure
 * derivation rather than an attempt against a model, and it is reported on the slot row itself.
 */
export async function readSlotAttemptHistory(
  db: GenericQueryCtx<import('../_generated/dataModel').DataModel>['db'],
  worldId: string,
  slots: readonly Doc<'scheduledSlots'>[],
): Promise<{ history: SlotAttemptHistory[]; omittedSlots: number }> {
  // Only slots that have actually been attempted more than once can have a prior failure to show.
  const retried = slots.filter((slot) => slot.attemptCount > 1);
  const considered = retried.slice(-ATTEMPT_HISTORY_SLOT_LIMIT);
  const history: SlotAttemptHistory[] = [];
  for (const slot of considered) {
    // Derived, not stored: `worldDayRunId` is the one definition of a slot's run identity, and the
    // executor derives it from the same three fields when it opens the run.
    const runId = worldDayRunId({ worldId, worldDay: slot.worldDay, timeSlot: slot.timeSlot });
    const rows = await db.query('worldDayCheckpoints')
      .withIndex('by_run_and_stage', (q) => q.eq('runId', runId)).collect();
    const failures = rows
      .filter((row): row is typeof row & { errorCode: string } =>
        row.status === 'failed' && typeof row.errorCode === 'string')
      .map((row): SlotAttemptFailure => ({
        attempt: row.attempt, stage: row.stage,
        errorCode: row.errorCode, errorMessage: row.errorMessage ?? '',
      }))
      .sort((left, right) => left.attempt - right.attempt);
    if (failures.length > 0) {
      history.push({ slotKey: slot.slotKey, worldDay: slot.worldDay, timeSlot: slot.timeSlot, failures });
    }
  }
  return { history, omittedSlots: retried.length - considered.length };
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

/**
 * How long a live slot claim is honoured (ART-160).
 *
 * MUST exceed the platform's maximum action duration. The live sequence is
 * prepare (mutation) → author (ACTION) → finalize (mutation), and the action holds the claim for
 * its whole run; a lease shorter than the action's own ceiling would expire under a healthy run
 * and let a second driver start authoring the same world while the first was still working — the
 * exact double-spend the lease exists to prevent. Convex caps actions at 10 minutes, so 12 leaves
 * margin without making a genuine orphan wait unreasonably long.
 *
 * The cost of the margin is stated plainly: a crashed driver's slot is unavailable for up to this
 * long. That is the right trade — a stalled world recovers by itself a few minutes late, whereas a
 * lease that is too short spends real allowance authoring the same scenes twice.
 */
export const LIVE_SLOT_LEASE_MS = 12 * 60_000;

/** A `running` slot nobody is holding any more: the lease lapsed, or predates ART-160. */
const leaseExpired = (row: Doc<'scheduledSlots'>, now: number): boolean =>
  row.leaseExpiresAt === undefined || row.leaseExpiresAt <= now;

export type SlotClaim =
  /** Nothing queued and nothing orphaned. */
  | { kind: 'idle' }
  /** Another driver holds a live claim on this world. The caller must not start a second. */
  | { kind: 'busy'; slotKey: string; leaseExpiresAt: number }
  /** The caller now holds the claim until `leaseExpiresAt`. */
  | { kind: 'claimed'; slotId: Id<'scheduledSlots'>; slotKey: string; leaseExpiresAt: number; resumed: boolean };

/**
 * Take, or take OVER, the one live claim a world may have (ART-160).
 *
 * This is the whole of the concurrency story for the live path, and everything else rests on it:
 *
 *  - **Duplicate cron or action delivery.** A second driver arriving while the first holds a live
 *    lease is told `busy` and does nothing. It cannot pick up "the next queued slot" instead —
 *    world time is ordered, and authoring slot N+1 against a world that slot N has not finished
 *    advancing would produce scenes about a world state that never existed.
 *  - **Orphan recovery.** A `running` slot whose lease has lapsed is taken OVER rather than left.
 *    That one branch covers every way the sequence can be interrupted — the action never started,
 *    it crashed, it timed out, the process restarted, or it finished authoring and the finalize
 *    mutation never ran — because from here they are indistinguishable and the remedy is the same.
 *
 * Resuming is safe rather than merely tolerated: `executeWorldDay` restarts at its last completed
 * checkpoint, `authorSlotScenes` reuses scenes that are already persisted instead of paying for
 * them again, and `commitProposedEvent` dedups on `idempotencyKey`. A slot that already reached
 * Canon short-circuits at the run record and commits nothing further.
 *
 * `attemptCount` increments on a takeover and not on a fresh claim, so the number an operator
 * reads still answers "how many times has this slot had to be picked up again".
 */
export const claimLiveSlot = internalMutation({
  args: {
    worldId: v.string(),
    slotId: v.optional(v.id('scheduledSlots')),
    now: v.number(),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SlotClaim> => {
    assertNow(args.now);
    const leaseExpiresAt = args.now + (args.leaseMs ?? LIVE_SLOT_LEASE_MS);

    // A world may hold at most ONE claim, so the running row is consulted before anything queued.
    const running = await ctx.db.query('scheduledSlots')
      .withIndex('by_world_and_status', (q) => q.eq('worldId', args.worldId).eq('status', 'running'))
      .first();
    if (running) {
      if (!leaseExpired(running, args.now)) {
        return { kind: 'busy', slotKey: running.slotKey, leaseExpiresAt: running.leaseExpiresAt ?? args.now };
      }
      await ctx.db.patch(running._id, {
        leaseExpiresAt, attemptCount: running.attemptCount + 1, updatedAt: args.now,
      });
      return { kind: 'claimed', slotId: running._id, slotKey: running.slotKey, leaseExpiresAt, resumed: true };
    }

    const target = args.slotId ? await ctx.db.get(args.slotId) : await ctx.db.query('scheduledSlots')
      .withIndex('by_world_and_status', (q) => q.eq('worldId', args.worldId).eq('status', 'queued'))
      .first();
    if (!target) return { kind: 'idle' };
    if (target.worldId !== args.worldId) throw new SchedulerError('SLOT_WORLD_MISMATCH', 'slot belongs to another world');
    if (target.status !== 'queued') return { kind: 'idle' };

    await ctx.db.patch(target._id, {
      status: 'running', attemptCount: target.attemptCount + 1, startedAt: args.now,
      leaseExpiresAt, updatedAt: args.now, errorCode: undefined,
    });
    return { kind: 'claimed', slotId: target._id, slotKey: target.slotKey, leaseExpiresAt, resumed: false };
  },
});

/**
 * Whether a world currently has a live claim outstanding.
 *
 * Read by the deterministic entry point so an operator running the fake author by hand cannot
 * start a slot underneath a live driver that is mid-flight — which would author the next slot
 * against a world state the running one has not finished advancing.
 */
export async function liveClaimHolder(
  db: MutationDb,
  worldId: string,
  now: number,
): Promise<Doc<'scheduledSlots'> | null> {
  const running = await db.query('scheduledSlots')
    .withIndex('by_world_and_status', (q) => q.eq('worldId', worldId).eq('status', 'running'))
    .first();
  return running && !leaseExpired(running, now) ? running : null;
}

/**
 * Worlds a live driver may advance right now.
 *
 * Paused schedules are excluded HERE rather than left to fail later, so a paused world costs a
 * driver nothing per tick. The emergency stop is NOT checked here — it is a per-world assertion
 * inside `prepareQueuedWorldDaySlot`, and re-implementing it would give the kill switch two
 * definitions that could disagree.
 */
export async function drivableWorldIds(
  db: MutationDb | GenericQueryCtx<import('../_generated/dataModel').DataModel>['db'],
): Promise<string[]> {
  const rows = await db.query('worldSchedules')
    .withIndex('by_mode_and_status', (q) => q.eq('mode', 'public').eq('status', 'running'))
    .collect();
  return rows.map((row) => row.worldId).sort((left, right) => left.localeCompare(right));
}

export const listDrivableWorlds = internalQuery({
  args: {},
  handler: (ctx): Promise<string[]> => drivableWorldIds(ctx.db),
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
