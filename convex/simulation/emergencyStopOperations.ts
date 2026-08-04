/**
 * Convex wiring for the FR-K006 world emergency stop.
 *
 * Mirrors the shape of {@link ./schedulerOperations.ts}: the shared helpers below are
 * the SINGLE implementation of engage/release/admission, and the authorized operations
 * console (`convex/operations/emergencyStopFunctions.ts`) drives exactly these helpers
 * instead of reimplementing them. Every helper here is reachable only from an already
 * authorized caller or from an internal simulation entry point — callers exposed to an
 * unauthenticated client MUST authorize first.
 *
 * The three PRD preservation guarantees are enforced here by omission, deliberately:
 * this module writes ONLY `worldEmergencyStops` and (via the shared scheduler helpers)
 * `worldSchedules.status`. It issues no write to `canonEvents`, `scheduledSlots`,
 * `worldDayRuns`, `worldDayCheckpoints`, or `publishedReadModels`.
 */

import { internalQuery } from '../_generated/server';
import type { DataModel, Doc } from '../_generated/dataModel';
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';
import {
  assertEmergencyStopCommand,
  assertSimulationAdmitted,
  decideEmergencyStopEngage,
  decideEmergencyStopRelease,
  isSimulationHalted,
  summarizeEmergencyStop,
  type EmergencyStopRecord,
  type EmergencyStopResultCode,
  type EmergencyStopView,
} from './emergencyStop';
import { loadScheduleRow, pauseWorldSchedule, resumeWorldSchedule } from './schedulerOperations';

type MutationDb = GenericMutationCtx<DataModel>['db'];
type QueryDb = GenericQueryCtx<DataModel>['db'];

/** Slot states that represent work not yet finished, and therefore state to preserve. */
const IN_FLIGHT_SLOT_STATUSES = ['queued', 'running'] as const;

function toRecord(row: Doc<'worldEmergencyStops'>): EmergencyStopRecord {
  return {
    worldId: row.worldId,
    state: row.state,
    engagedAt: row.engagedAt,
    engagedBy: row.engagedBy,
    reason: row.reason,
    scheduleStatusBefore: row.scheduleStatusBefore,
    preservedSlotKeys: row.preservedSlotKeys,
    activationCount: row.activationCount,
    releasedAt: row.releasedAt,
    releasedBy: row.releasedBy,
    releaseReason: row.releaseReason,
  };
}

/** The world's kill-switch row, or `null` when the switch has never been used. */
export async function loadEmergencyStopRow(
  db: MutationDb | QueryDb,
  worldId: string,
): Promise<Doc<'worldEmergencyStops'> | null> {
  return db.query('worldEmergencyStops').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique();
}

export async function loadEmergencyStop(db: MutationDb | QueryDb, worldId: string): Promise<EmergencyStopRecord | null> {
  const row = await loadEmergencyStopRow(db, worldId);
  return row ? toRecord(row) : null;
}

/** True when NEW simulation work is currently forbidden for this world. */
export async function isWorldEmergencyStopped(db: MutationDb | QueryDb, worldId: string): Promise<boolean> {
  return isSimulationHalted(await loadEmergencyStop(db, worldId));
}

/**
 * THE admission gate for new simulation work. Every internal entry point that would
 * create new generation work calls this before claiming anything.
 */
export async function assertWorldAdmitsSimulation(db: MutationDb | QueryDb, worldId: string): Promise<void> {
  assertSimulationAdmitted(worldId, await loadEmergencyStop(db, worldId));
}

/** Slot keys for work that is queued or already running, i.e. the state a stop must preserve. */
async function inFlightSlotKeys(db: MutationDb, worldId: string): Promise<string[]> {
  const groups = await Promise.all(IN_FLIGHT_SLOT_STATUSES.map((status) =>
    db.query('scheduledSlots').withIndex('by_world_and_status', (q) => q.eq('worldId', worldId).eq('status', status)).collect()));
  return groups.flat().map((row) => row.slotKey).sort();
}

export type EmergencyStopOutcome = {
  changed: boolean;
  resultCode: EmergencyStopResultCode;
  view: EmergencyStopView;
};

/**
 * Engage the kill switch.
 *
 * Order matters. The stop record is written FIRST so that, even if the schedule pause
 * were to fail, the admission gate is already closed and no new work can be claimed —
 * the switch fails safe rather than half-open. Pausing the schedule then additionally
 * stops the clock cron from reserving further slots.
 *
 * Idempotent (AC#4): engaging an engaged world returns `changed: false` and mutates
 * nothing, so a retried or duplicated operator command cannot overwrite the original
 * activation or the captured pre-stop schedule status.
 *
 * Preserves everything (AC#2): queued and running slots keep their exact status,
 * attempt counts, and idempotency keys; their keys are recorded on the stop record as
 * evidence only. World-day runs and checkpoints are not read for the decision and not
 * written. Accepted `canonEvents` are never touched.
 */
export async function engageWorldEmergencyStop(
  db: MutationDb,
  worldId: string,
  command: { operatorId: string; reason: string; now: number },
): Promise<EmergencyStopOutcome> {
  assertEmergencyStopCommand(command);
  // Throws SCHEDULE_NOT_FOUND for an unknown world, so the switch cannot be engaged
  // against a world that does not exist.
  const schedule = await loadScheduleRow(db, worldId);
  const existing = await loadEmergencyStopRow(db, worldId);
  const decision = decideEmergencyStopEngage(existing && toRecord(existing));
  if (decision.action === 'none') {
    return { changed: false, resultCode: decision.resultCode, view: summarizeEmergencyStop(worldId, toRecord(existing as Doc<'worldEmergencyStops'>)) };
  }

  const preservedSlotKeys = await inFlightSlotKeys(db, worldId);
  const engaged = {
    state: 'engaged' as const,
    engagedAt: command.now,
    engagedBy: command.operatorId,
    reason: command.reason,
    scheduleStatusBefore: schedule.status,
    preservedSlotKeys,
    activationCount: (existing?.activationCount ?? 0) + 1,
    releasedAt: undefined,
    releasedBy: undefined,
    releaseReason: undefined,
    updatedAt: command.now,
  };
  if (existing) await db.patch(existing._id, engaged);
  else await db.insert('worldEmergencyStops', { schemaVersion: 1, worldId, createdAt: command.now, ...engaged });

  await pauseWorldSchedule(db, worldId, command.now);

  const row = await loadEmergencyStopRow(db, worldId);
  return { changed: true, resultCode: decision.resultCode, view: summarizeEmergencyStop(worldId, row && toRecord(row)) };
}

/**
 * Release the kill switch on authorized operator command.
 *
 * The schedule is restored to the status it held BEFORE the stop, so releasing an
 * emergency stop on a world an operator had already paused leaves it paused rather
 * than silently restarting it. When it was running, the shared
 * {@link resumeWorldSchedule} shifts the real-time anchor by the halted duration so
 * the public world clock does not jump.
 *
 * Idempotent (AC#4): releasing a world that is not stopped changes nothing.
 */
export async function releaseWorldEmergencyStop(
  db: MutationDb,
  worldId: string,
  command: { operatorId: string; reason: string; now: number },
): Promise<EmergencyStopOutcome> {
  assertEmergencyStopCommand(command);
  const existing = await loadEmergencyStopRow(db, worldId);
  const decision = decideEmergencyStopRelease(existing && toRecord(existing));
  if (decision.action === 'none') {
    return {
      changed: false,
      resultCode: decision.resultCode,
      view: summarizeEmergencyStop(worldId, existing && toRecord(existing)),
    };
  }

  await db.patch((existing as Doc<'worldEmergencyStops'>)._id, {
    state: 'released',
    releasedAt: command.now,
    releasedBy: command.operatorId,
    releaseReason: command.reason,
    updatedAt: command.now,
  });
  if (decision.restoreScheduleStatus === 'running') await resumeWorldSchedule(db, worldId, command.now);

  const row = await loadEmergencyStopRow(db, worldId);
  return { changed: true, resultCode: decision.resultCode, view: summarizeEmergencyStop(worldId, row && toRecord(row)) };
}

/** Operator-facing switch state. Read-only; safe for a query context. */
export async function readEmergencyStopState(db: QueryDb, worldId: string): Promise<EmergencyStopView> {
  return summarizeEmergencyStop(worldId, await loadEmergencyStop(db, worldId));
}

/**
 * Read-only internal mirror for deployment inspection. There is deliberately NO
 * internal mutation that engages or releases the switch: activation and release are
 * privileged, reasoned, audited operator commands and must go through the authorized
 * console in `convex/operations/emergencyStopFunctions.ts`.
 */
export const getEmergencyStopState = internalQuery({
  args: { worldId: v.string() },
  handler: (ctx, { worldId }): Promise<EmergencyStopView> => readEmergencyStopState(ctx.db, worldId),
});
