/**
 * The authenticated simulation operations console (FR-K001, NFR-005).
 *
 * This is the ONLY caller-facing surface for privileged simulation control. Every
 * function here is a public Convex `mutation`/`query` — reachable by a client —
 * and is therefore gated by {@link authorizeOperator} as its FIRST statement,
 * before any row is read. Nothing here is on the public read path: no viewer or
 * publicRead module imports this file, and the module boundary policy forbids it
 * (`viewer` may only depend on `publicRead`/`safety`/`shared`).
 *
 * INVARIANTS
 * ----------
 * 1. Authorize first. A denial is uniform (`OPS_UNAUTHORIZED`) and is raised
 *    before any existence check, so an unauthorized caller cannot learn whether a
 *    world, slot, or run exists, nor which controls the console offers (AC#3).
 * 2. Audit every applied command. Each mutation appends exactly one
 *    `operatorAuditLog` row in the same transaction as its effect, so an effect
 *    can never be persisted without its `who / what / why / when` record (AC#2).
 * 3. Never bypass Canon. No function here writes `canonEvents`, and cancellation
 *    refuses any slot that already produced accepted history. Snapshot creation
 *    goes through the existing, idempotent canon snapshot manager.
 * 4. Safe under retry. Pause, resume, cancel, and snapshot creation are
 *    idempotent; slot reservation reuses the scheduler's `slotKey` deduplication.
 *
 * The controls themselves are NOT reimplemented here: pause/resume/advance/retry
 * delegate to the shared helpers in `convex/simulation/schedulerOperations.ts`
 * and snapshots/state delegate to `convex/canon/snapshotOperations.ts`, which the
 * pre-existing internal mutations also use.
 */

import { mutation, query } from '../_generated/server';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';
import { TIME_SLOTS } from '../canon/eventTypes';
import { assertWorldAdmitsSimulation } from '../simulation/emergencyStopOperations';
import { createSnapshotRecoveryStore, readOperationalWorldProjection } from '../canon/snapshotOperations';
import { createDailySnapshot } from '../canon/snapshotManager';
import {
  loadScheduleRow,
  pauseWorldSchedule,
  readScheduleInspection,
  reserveSlots,
  resumeWorldSchedule,
  retrySlotRun,
} from '../simulation/schedulerOperations';
import {
  authorizeOperator,
  buildOperatorAuditEntry,
  capabilitiesForRole,
  parseOperatorRegistry,
  unauthorized,
  type OperatorPrincipal,
  type OpsCapability,
} from './operatorAuthorization';
import { decideSlotCancellation, summarizeQueue, summarizeWorldState, type CancellableRun } from './opsConsole';

type MutationCtx = GenericMutationCtx<DataModel>;
type QueryCtx = GenericQueryCtx<DataModel>;

/**
 * Credentials every console call carries. `operatorToken`/`operatorId` are the
 * bootstrap path used until the deployment has an identity provider; when a
 * verified `ctx.auth` identity is present it is preferred and the token is ignored.
 */
export const credentialArgs = {
  operatorId: v.optional(v.string()),
  operatorToken: v.optional(v.string()),
} as const;

/** Every mutation must state WHY (NFR-005: privileged mutations are reasoned). */
export const commandArgs = { ...credentialArgs, worldId: v.string(), reason: v.string() } as const;

/**
 * THE gate. Reads the verified Convex identity and the server-only operator
 * registry, then delegates the whole decision to the pure policy module.
 *
 * The registry lives in the `SIMULATION_OPS_OPERATORS` deployment environment
 * variable and is never returned to a caller. An unset variable yields an empty
 * registry, which denies everyone — the console fails closed.
 *
 * Exported so every additional authorized console surface (for example the FR-K006
 * emergency-stop controls in `./emergencyStopFunctions.ts`) passes through THIS gate
 * instead of standing up a second authorization mechanism.
 */
export async function requireOperator(
  ctx: QueryCtx | MutationCtx,
  capability: OpsCapability,
  args: { worldId: string; operatorId?: string; operatorToken?: string },
): Promise<OperatorPrincipal> {
  const identity = await ctx.auth.getUserIdentity();
  // Audit H-1: the shared-token bootstrap path is the sole credential until a real
  // identity provider is configured. Once Clerk is live (`CLERK_JWT_ISSUER_DOMAIN` set)
  // the token branch closes automatically — verified identity becomes the only way in —
  // unless an operator explicitly keeps the escape hatch via
  // `SIMULATION_OPS_ALLOW_TOKEN_FALLBACK=1`. Before that, the token stays available so
  // the move to verified identity cannot lock the deployment out.
  const allowTokenFallback = process.env.SIMULATION_OPS_ALLOW_TOKEN_FALLBACK === '1'
    || !process.env.CLERK_JWT_ISSUER_DOMAIN;
  return authorizeOperator({
    credentials: { identity, token: args.operatorToken, operatorId: args.operatorId },
    registry: parseOperatorRegistry(process.env.SIMULATION_OPS_OPERATORS),
    capability,
    worldId: args.worldId,
    allowTokenFallback,
  });
}

/**
 * Append the audit row for an applied command.
 *
 * Written inside the command's own transaction: if the command throws, the audit
 * row rolls back with it, and if the audit row cannot be built (for example a
 * blank reason) the command does not apply either. Denials are deliberately NOT
 * recorded here — a Convex mutation is transactional, so a row written on the
 * path to a throw would be rolled back. Denied attempts are observable in the
 * Convex function logs instead; see `docs/simulation-operations-console.md`.
 */
export async function recordAudit(
  ctx: MutationCtx,
  input: {
    principal: OperatorPrincipal; worldId: string; capability: OpsCapability;
    target?: string; reason: string; outcome: 'applied' | 'no_op' | 'refused'; resultCode: string; at: number;
  },
): Promise<void> {
  await ctx.db.insert('operatorAuditLog', buildOperatorAuditEntry(input));
}

/** Reject a non-finite caller clock before it can be written anywhere. */
export function operatorNow(now: number | undefined): number {
  const value = now ?? Date.now();
  if (!Number.isFinite(value)) throw unauthorized();
  return value;
}

// ---------------------------------------------------------------------------
// FR-K001: pause the world / resume the world
// ---------------------------------------------------------------------------

export const pauseWorld = mutation({
  args: { ...commandArgs, now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'world.pause', args);
    const at = operatorNow(args.now);
    const before = await loadScheduleRow(ctx.db, args.worldId);
    await pauseWorldSchedule(ctx.db, args.worldId, at);
    const outcome = before.status === 'running' ? 'applied' : 'no_op';
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'world.pause', target: args.worldId,
      reason: args.reason, outcome, resultCode: outcome === 'applied' ? 'OPS_OK' : 'OPS_NO_OP', at,
    });
    return { status: 'paused' as const, changed: outcome === 'applied' };
  },
});

export const resumeWorld = mutation({
  args: { ...commandArgs, now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'world.resume', args);
    const at = operatorNow(args.now);
    const before = await loadScheduleRow(ctx.db, args.worldId);
    await resumeWorldSchedule(ctx.db, args.worldId, at);
    const outcome = before.status === 'paused' ? 'applied' : 'no_op';
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'world.resume', target: args.worldId,
      reason: args.reason, outcome, resultCode: outcome === 'applied' ? 'OPS_OK' : 'OPS_NO_OP', at,
    });
    return { status: 'running' as const, changed: outcome === 'applied' };
  },
});

// ---------------------------------------------------------------------------
// FR-K001: manually advance a time slot (or a whole world day)
// ---------------------------------------------------------------------------

export const advanceSlot = mutation({
  args: { ...commandArgs, wholeWorldDay: v.optional(v.boolean()), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'slot.advance', args);
    const at = operatorNow(args.now);
    // FR-K006: reserving a slot queues NEW simulation work, so it is refused while
    // the world's kill switch is engaged. Releasing the stop restores this control.
    await assertWorldAdmitsSimulation(ctx.db, args.worldId);
    const wholeDay = args.wholeWorldDay === true;
    // Reservation is keyed by slotKey, so a repeated advance for an already
    // reserved slot reserves nothing rather than double-booking it.
    const reserved = await reserveSlots(
      ctx.db, args.worldId, wholeDay ? TIME_SLOTS.length : 1, wholeDay ? 'manual-day' : 'manual-slot', at,
    );
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'slot.advance',
      target: wholeDay ? 'world-day' : 'slot', reason: args.reason,
      outcome: reserved.length > 0 ? 'applied' : 'no_op',
      resultCode: reserved.length > 0 ? 'OPS_OK' : 'OPS_NO_OP', at,
    });
    return { reservedSlotIds: reserved, reservedCount: reserved.length };
  },
});

// ---------------------------------------------------------------------------
// FR-K001: re-run a failed job
// ---------------------------------------------------------------------------

export const retryFailedSlot = mutation({
  args: { ...commandArgs, slotId: v.id('scheduledSlots'), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'run.retry', args);
    const at = operatorNow(args.now);
    const slot = await ctx.db.get(args.slotId);
    // Authorization already passed, so a world mismatch is a genuine caller error
    // rather than an information leak; still report it as "not found" so the
    // console never confirms a slot belongs to some other world.
    if (!slot || slot.worldId !== args.worldId) throw new Error('[OPS_SLOT_NOT_FOUND] slot does not exist for this world');
    await retrySlotRun(ctx.db, args.slotId, at);
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'run.retry', target: slot.slotKey,
      reason: args.reason, outcome: 'applied', resultCode: 'OPS_OK', at,
    });
    return { slotKey: slot.slotKey, status: 'queued' as const };
  },
});

// ---------------------------------------------------------------------------
// FR-K001: cancel an uncommitted scene
// ---------------------------------------------------------------------------

/** World-day runs recorded for the same (world, day, slot) as a queue row. */
async function runsForSlot(ctx: MutationCtx, slot: Doc<'scheduledSlots'>): Promise<CancellableRun[]> {
  const rows = await ctx.db
    .query('worldDayRuns')
    .withIndex('by_world_day_slot', (q) =>
      q.eq('worldId', slot.worldId).eq('worldDay', slot.worldDay).eq('timeSlot', slot.timeSlot))
    .collect();
  return rows.map((row) => ({ runId: row.runId, status: row.status, committedEventIds: row.committedEventIds }));
}

/**
 * Cancel a not-yet-committed scene.
 *
 * Discards QUEUE state only. Accepted Canon is append-only and is never read,
 * edited, or deleted here: if the slot committed an event, or any world-day run
 * for the slot completed or recorded committed event ids, the command is refused.
 * Idempotent — re-cancelling an already-cancelled slot is a recorded no-op.
 */
export const cancelUncommittedScene = mutation({
  args: { ...commandArgs, slotId: v.id('scheduledSlots'), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'scene.cancel', args);
    const at = operatorNow(args.now);
    const slot = await ctx.db.get(args.slotId);
    if (!slot || slot.worldId !== args.worldId) throw new Error('[OPS_SLOT_NOT_FOUND] slot does not exist for this world');
    const decision = decideSlotCancellation(
      { slotKey: slot.slotKey, worldId: slot.worldId, status: slot.status, committedEventId: slot.committedEventId },
      await runsForSlot(ctx, slot),
    );
    if (decision.action === 'cancel') {
      await ctx.db.patch(slot._id, { status: 'cancelled', errorCode: 'OPS_CANCELLED', completedAt: at, updatedAt: at });
    }
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'scene.cancel', target: slot.slotKey,
      reason: args.reason, outcome: decision.action === 'cancel' ? 'applied' : 'no_op',
      resultCode: decision.resultCode, at,
    });
    return { slotKey: slot.slotKey, status: 'cancelled' as const, changed: decision.action === 'cancel' };
  },
});

// ---------------------------------------------------------------------------
// FR-K001: create a snapshot
// ---------------------------------------------------------------------------

export const createWorldSnapshot = mutation({
  args: { ...commandArgs, worldDay: v.number(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'snapshot.create', args);
    const at = operatorNow(args.now);
    // Reuses the canon snapshot manager, which already deduplicates a daily
    // snapshot and verifies it against accepted history — retry-safe by design.
    const { snapshot, deduplicated } = await createDailySnapshot(
      createSnapshotRecoveryStore(ctx.db), args.worldId, args.worldDay, at,
    );
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'snapshot.create',
      target: `worldDay:${args.worldDay}`, reason: args.reason,
      outcome: deduplicated ? 'no_op' : 'applied', resultCode: deduplicated ? 'OPS_NO_OP' : 'OPS_OK', at,
    });
    return {
      snapshotId: snapshot.snapshotId as Id<'canonSnapshots'>,
      worldDay: snapshot.worldDay,
      lastSequenceNumber: snapshot.lastSequenceNumber,
      deduplicated,
    };
  },
});

// ---------------------------------------------------------------------------
// FR-K001: inspect world state / inspect schedules and queues
// ---------------------------------------------------------------------------

/**
 * Current world state for operators.
 *
 * Returns counts and cursors only. Private world content — character knowledge,
 * subjective memories, prompts — is deliberately excluded even from this
 * authorized response so the console cannot become an exfiltration path (NFR-005).
 */
export const inspectWorldState = query({
  args: { ...credentialArgs, worldId: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'world.inspect', args);
    const projection = await readOperationalWorldProjection(ctx.db, args.worldId);
    const head = await ctx.db
      .query('canonRecoveryHeads').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).unique();
    return {
      ...summarizeWorldState(projection),
      recoveryHeadActive: head !== null,
    };
  },
});

/** Schedule cursor plus the full slot queue and its status counts. */
export const inspectScheduleAndQueue = query({
  args: { ...credentialArgs, worldId: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'schedule.inspect', args);
    const { schedule, runs } = await readScheduleInspection(ctx.db, args.worldId);
    return {
      schedule: schedule
        ? {
          worldId: schedule.worldId, mode: schedule.mode, status: schedule.status,
          nextWorldDay: schedule.nextWorldDay, nextTimeSlot: schedule.nextTimeSlot,
          publishEnabled: schedule.publishEnabled, pausedAt: schedule.pausedAt, updatedAt: schedule.updatedAt,
        }
        : null,
      queueSummary: summarizeQueue(runs),
      queue: runs.map((run) => ({
        slotId: run._id, slotKey: run.slotKey, worldDay: run.worldDay, timeSlot: run.timeSlot,
        trigger: run.trigger, status: run.status, attemptCount: run.attemptCount,
        errorCode: run.errorCode, committedEventId: run.committedEventId, updatedAt: run.updatedAt,
      })),
    };
  },
});

/** The operator audit trail for a world, newest first. Read requires `schedule.inspect`. */
export const listOperatorAudit = query({
  args: { ...credentialArgs, worldId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'schedule.inspect', args);
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 200);
    const rows = await ctx.db
      .query('operatorAuditLog')
      .withIndex('by_world_and_time', (q) => q.eq('worldId', args.worldId))
      .order('desc')
      .take(limit);
    return rows.map((row) => ({
      operatorId: row.operatorId, subject: row.subject, role: row.role, source: row.source,
      capability: row.capability, target: row.target, reason: row.reason,
      outcome: row.outcome, resultCode: row.resultCode, at: row.at,
    }));
  },
});

/**
 * What the calling operator may do in this world. Requires an authorized caller,
 * so it cannot be used to enumerate the console anonymously.
 */
export const describeOperatorSession = query({
  args: { ...credentialArgs, worldId: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'schedule.inspect', args);
    return {
      operatorId: principal.operatorId, role: principal.role, source: principal.source,
      capabilities: capabilitiesForRole(principal.role),
    };
  },
});
