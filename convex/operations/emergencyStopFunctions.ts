/**
 * FR-K006 world emergency stop and recovery — the authorized caller-facing surface.
 *
 * Four privileged commands and one read, all reachable by a client and therefore all
 * gated by ART-48's {@link requireOperator} as their FIRST statement. There is NO
 * second authorization mechanism here: the registry, the role matrix, the uniform
 * denial, and the audit-row builder are the ones in `./operatorAuthorization.ts`.
 *
 * | Command | Capability | What it guarantees |
 * | --- | --- | --- |
 * | `emergencyStop` | `world.emergency_stop` | no NEW simulation work is admitted |
 * | `resumeFromEmergencyStop` | `world.emergency_resume` | the world resumes where it halted |
 * | `activateWorldRollback` | `world.rollback` | operational reads point at an earlier snapshot |
 * | `clearWorldRollback` | `world.rollback` | the rollback is undone |
 *
 * WHAT THE STOP DOES NOT TOUCH
 * ----------------------------
 * Accepted `canonEvents` are append-only and are never read for a decision, edited, or
 * deleted by anything in this file. Published read models are never written, so the
 * public pages keep serving their last-known-good content for the entire outage — the
 * public read path consults only `publishedReadModels` and never the simulation layer.
 * Queued and running slots, world-day runs, and their checkpoints keep their exact
 * durable state, so a resume continues rather than restarts.
 *
 * ROLLBACK IS NON-DESTRUCTIVE
 * ---------------------------
 * `activateWorldRollback` does not rewrite history. It delegates to the ART-17
 * {@link activateRecoveryHead} primitive, which verifies the target snapshot against
 * accepted history and then moves ONE `canonRecoveryHeads` pointer. Clearing the
 * pointer immediately restores the full current projection.
 */

import { mutation, query } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { v } from 'convex/values';
import { activateRecoveryHead, clearRecoveryHead } from '../canon/snapshotManager';
import { createSnapshotRecoveryStore } from '../canon/snapshotOperations';
import {
  engageWorldEmergencyStop,
  readEmergencyStopState,
  releaseWorldEmergencyStop,
} from '../simulation/emergencyStopOperations';
import { readScheduleInspection } from '../simulation/schedulerOperations';
import { summarizeQueue } from './opsConsole';
import { commandArgs, credentialArgs, operatorNow, recordAudit, requireOperator } from './opsConsoleFunctions';

// ---------------------------------------------------------------------------
// FR-K006: engage the kill switch / release it
// ---------------------------------------------------------------------------

/**
 * Engage the kill switch.
 *
 * Stronger than the FR-K001 `pauseWorld`: pausing stops the clock from RESERVING new
 * slots but leaves the executor free to drain the existing queue, whereas this closes
 * the world's admission gate so `runQueuedWorldDaySlot` refuses to claim any slot and
 * every world-day stage boundary refuses to start.
 *
 * Idempotent (AC#4): a repeated activation applies nothing, preserves the original
 * operator/reason/instant and the captured pre-stop schedule status, and is still
 * audited — as a `no_op`, so the repeat itself remains visible in the trail.
 */
export const emergencyStop = mutation({
  args: { ...commandArgs, now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'world.emergency_stop', args);
    const at = operatorNow(args.now);
    const outcome = await engageWorldEmergencyStop(ctx.db, args.worldId, {
      operatorId: principal.operatorId, reason: args.reason, now: at,
    });
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'world.emergency_stop', target: args.worldId,
      reason: args.reason, outcome: outcome.changed ? 'applied' : 'no_op', resultCode: outcome.resultCode, at,
    });
    return {
      engaged: true as const,
      changed: outcome.changed,
      resultCode: outcome.resultCode,
      /** Slots left untouched in the queue, proving incomplete work was preserved. */
      preservedSlotKeys: outcome.view.preservedSlotKeys,
      activationCount: outcome.view.activationCount,
    };
  },
});

/**
 * Release the kill switch and let the world continue.
 *
 * Restores the schedule to the status it held BEFORE the stop, so a world an operator
 * had already paused stays paused. A world that was running resumes through the shared
 * scheduler helper, which shifts the real-time anchor by the halted duration so the
 * public world clock does not jump forward.
 *
 * Resuming does not re-run completed work: every halted world-day run keeps its
 * completed checkpoints and restarts at exactly the stage that was refused, and Canon
 * commit stays keyed by (worldId, worldDay, timeSlot) — so nothing commits twice.
 */
export const resumeFromEmergencyStop = mutation({
  args: { ...commandArgs, now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'world.emergency_resume', args);
    const at = operatorNow(args.now);
    const outcome = await releaseWorldEmergencyStop(ctx.db, args.worldId, {
      operatorId: principal.operatorId, reason: args.reason, now: at,
    });
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'world.emergency_resume', target: args.worldId,
      reason: args.reason, outcome: outcome.changed ? 'applied' : 'no_op', resultCode: outcome.resultCode, at,
    });
    return {
      engaged: false as const,
      changed: outcome.changed,
      resultCode: outcome.resultCode,
      restoredScheduleStatus: outcome.view.scheduleStatusBefore ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// FR-K006: authorized non-destructive rollback
// ---------------------------------------------------------------------------

/**
 * Point operational reads at an earlier verified snapshot.
 *
 * Accepted history is untouched: `canonEvents` and `canonIdempotencyKeys` are neither
 * edited nor deleted, and the target snapshot is proven to be exactly derivable from
 * the accepted-event prefix before the pointer moves. Idempotent (AC#4): re-activating
 * the snapshot the head already targets applies nothing.
 */
export const activateWorldRollback = mutation({
  args: { ...commandArgs, snapshotId: v.id('canonSnapshots'), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'world.rollback', args);
    const at = operatorNow(args.now);
    const current = await ctx.db
      .query('canonRecoveryHeads').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).unique();
    const alreadyTargeted = current?.targetSnapshotId === args.snapshotId;
    const head = alreadyTargeted ? null : await activateRecoveryHead(createSnapshotRecoveryStore(ctx.db), {
      worldId: args.worldId, snapshotId: args.snapshotId,
      operatorId: principal.operatorId, reason: args.reason, createdAt: at,
    });
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'world.rollback', target: `snapshot:${args.snapshotId}`,
      reason: args.reason, outcome: alreadyTargeted ? 'no_op' : 'applied',
      resultCode: alreadyTargeted ? 'OPS_NO_OP' : 'OPS_OK', at,
    });
    return {
      changed: !alreadyTargeted,
      targetSnapshotId: args.snapshotId,
      targetSequenceNumber: head?.targetSequenceNumber ?? current?.targetSequenceNumber ?? null,
    };
  },
});

/** Undo a rollback: clearing the pointer immediately restores the full current projection. */
export const clearWorldRollback = mutation({
  args: { ...commandArgs, now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'world.rollback', args);
    const at = operatorNow(args.now);
    const current = await ctx.db
      .query('canonRecoveryHeads').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).unique();
    if (current) {
      await clearRecoveryHead(createSnapshotRecoveryStore(ctx.db), {
        worldId: args.worldId, operatorId: principal.operatorId, reason: args.reason, createdAt: at,
      });
    }
    await recordAudit(ctx, {
      principal, worldId: args.worldId, capability: 'world.rollback', target: 'recovery-head',
      reason: args.reason, outcome: current ? 'applied' : 'no_op',
      resultCode: current ? 'OPS_OK' : 'OPS_NO_OP', at,
    });
    return { changed: current !== null };
  },
});

// ---------------------------------------------------------------------------
// FR-K006: inspect the switch, the preserved queue, and the rollback targets
// ---------------------------------------------------------------------------

/**
 * Everything an operator needs to decide between resume and rollback: the switch
 * state, the schedule status, the counts of preserved work, the active recovery head,
 * and the snapshots that are valid rollback targets.
 *
 * Reports counts, cursors, and snapshot identities only — never private world content.
 */
export const inspectEmergencyStop = query({
  args: { ...credentialArgs, worldId: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'world.inspect', args);
    const [stop, { schedule, runs }, head, snapshots] = await Promise.all([
      readEmergencyStopState(ctx.db, args.worldId),
      readScheduleInspection(ctx.db, args.worldId),
      ctx.db.query('canonRecoveryHeads').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).unique(),
      ctx.db.query('canonSnapshots').withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect(),
    ]);
    return {
      stop,
      scheduleStatus: schedule?.status ?? null,
      queueSummary: summarizeQueue(runs),
      recovery: {
        head: head
          ? { targetSnapshotId: head.targetSnapshotId, targetSequenceNumber: head.targetSequenceNumber,
            activatedAt: head.activatedAt, operatorId: head.operatorId, reason: head.reason }
          : null,
        snapshots: snapshots.map((row) => ({
          snapshotId: row._id as Id<'canonSnapshots'>, worldDay: row.worldDay ?? null,
          lastSequenceNumber: row.lastSequenceNumber, kind: row.kind ?? 'initial', createdAt: row.createdAt,
        })),
      },
    };
  },
});
