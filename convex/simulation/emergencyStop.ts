/**
 * World emergency stop — the FR-K006 Kill Switch decision layer.
 *
 * WHY THIS IS NOT `pauseWorldSchedule`
 * ------------------------------------
 * The ordinary FR-K001 pause flips `worldSchedules.status` to `paused`, which stops
 * the clock cron from RESERVING new slots. It does not stop anything already in the
 * queue: `runQueuedWorldDaySlot` claims the oldest `queued` row regardless of the
 * schedule status, so a paused world with a backlog keeps generating. That is the
 * right behaviour for an ordinary pause and the wrong behaviour for a kill switch.
 *
 * The emergency stop is therefore a SEPARATE, world-level admission gate that every
 * simulation entry point must pass before it does new work. Engaging it also pauses
 * the schedule (so nothing new is reserved either), but the gate — not the schedule
 * status — is what actually halts execution.
 *
 * WHAT IT MUST NOT DO (PRD FR-K006, CLAUDE.md §6)
 * ----------------------------------------------
 * 1. It must not affect existing public content. Nothing here reads or writes
 *    `publishedReadModels`; public reads consult only that table and never the
 *    simulation layer, so they keep serving last-known-good content unchanged.
 * 2. It must preserve incomplete run state. Halting NEVER cancels, fails, or
 *    rewrites a `scheduledSlots` row or a `worldDayRuns`/`worldDayCheckpoints` row.
 *    The in-flight slot keys are recorded on the stop record as evidence only.
 * 3. It must not lose an accepted event. Nothing here touches `canonEvents`;
 *    append-only Canon is never read for a decision and never written.
 *
 * Pure module — no Convex imports, no clock, no randomness, no I/O. The wiring layer
 * ({@link ./emergencyStopOperations.ts}) loads rows and applies these decisions; the
 * authorized caller-facing surface is `convex/operations/emergencyStopFunctions.ts`.
 */

import { WORLD_DAY_STAGES, WorldDayOrchestrationError, type WorldDayStageHandlers } from './worldDayOrchestration';

/** Stable error code raised by every simulation entry point while a stop is engaged. */
export const EMERGENCY_STOP_ERROR_CODE = 'SIMULATION_EMERGENCY_STOPPED';

/** Machine-readable outcomes recorded in the operator audit trail. */
export const EMERGENCY_STOP_RESULT_CODES = [
  'OPS_EMERGENCY_STOP_ENGAGED',
  'OPS_EMERGENCY_STOP_ALREADY_ENGAGED',
  'OPS_EMERGENCY_STOP_RELEASED',
  'OPS_EMERGENCY_STOP_NOT_ENGAGED',
] as const;
export type EmergencyStopResultCode = (typeof EMERGENCY_STOP_RESULT_CODES)[number];

export class EmergencyStopError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'EmergencyStopError';
  }
}

export type EmergencyStopState = 'engaged' | 'released';

/** The schedule status captured when the stop engaged, restored verbatim on release. */
export type PreStopScheduleStatus = 'running' | 'paused';

/**
 * The durable kill-switch record. Exactly one row per world; engaging and releasing
 * toggle `state` in place so the record doubles as the world's stop history head.
 */
export type EmergencyStopRecord = {
  worldId: string;
  state: EmergencyStopState;
  /** Operator + reason + instant of the most recent activation. */
  engagedAt: number;
  engagedBy: string;
  reason: string;
  scheduleStatusBefore: PreStopScheduleStatus;
  /** Slot keys that were queued or running when the stop engaged. Evidence only. */
  preservedSlotKeys: readonly string[];
  /** How many activations this world has seen; proves repeated activation is a no-op. */
  activationCount: number;
  releasedAt?: number;
  releasedBy?: string;
  releaseReason?: string;
};

export function isSimulationHalted(record: EmergencyStopRecord | null | undefined): boolean {
  return record?.state === 'engaged';
}

/**
 * The admission gate. Every simulation entry point that would create NEW work calls
 * this first; a halted world raises the stable {@link EMERGENCY_STOP_ERROR_CODE} so
 * the world-day orchestrator records it as an ordinary stage failure and keeps every
 * completed checkpoint intact.
 */
export function assertSimulationAdmitted(worldId: string, record: EmergencyStopRecord | null | undefined): void {
  if (isSimulationHalted(record)) {
    throw new EmergencyStopError(EMERGENCY_STOP_ERROR_CODE, `world ${worldId} is under an emergency stop; no new simulation work is admitted`);
  }
}

export type EngageDecision =
  | { action: 'engage'; resultCode: 'OPS_EMERGENCY_STOP_ENGAGED' }
  | { action: 'none'; resultCode: 'OPS_EMERGENCY_STOP_ALREADY_ENGAGED' };

export type ReleaseDecision =
  | { action: 'release'; resultCode: 'OPS_EMERGENCY_STOP_RELEASED'; restoreScheduleStatus: PreStopScheduleStatus }
  | { action: 'none'; resultCode: 'OPS_EMERGENCY_STOP_NOT_ENGAGED' };

/**
 * Decide whether an activation changes anything.
 *
 * Idempotent by construction (AC#4): re-activating an engaged world keeps the FIRST
 * activation's operator, reason, instant, and captured schedule status, because the
 * captured status is what a later release restores. A second activation that
 * overwrote it after the schedule was already paused would make release resume a
 * world that had been deliberately paused before the emergency.
 */
export function decideEmergencyStopEngage(record: EmergencyStopRecord | null | undefined): EngageDecision {
  return isSimulationHalted(record)
    ? { action: 'none', resultCode: 'OPS_EMERGENCY_STOP_ALREADY_ENGAGED' }
    : { action: 'engage', resultCode: 'OPS_EMERGENCY_STOP_ENGAGED' };
}

/** Decide whether a release changes anything, and which schedule status to restore. */
export function decideEmergencyStopRelease(record: EmergencyStopRecord | null | undefined): ReleaseDecision {
  if (!record || !isSimulationHalted(record)) return { action: 'none', resultCode: 'OPS_EMERGENCY_STOP_NOT_ENGAGED' };
  return { action: 'release', resultCode: 'OPS_EMERGENCY_STOP_RELEASED', restoreScheduleStatus: record.scheduleStatusBefore };
}

/** Reject a non-finite operator clock and a blank operator/reason before anything is written. */
export function assertEmergencyStopCommand(input: { operatorId: string; reason: string; now: number }): void {
  if (input.operatorId.trim().length === 0 || input.reason.trim().length === 0) {
    throw new EmergencyStopError('EMERGENCY_STOP_INPUT_INVALID', 'emergency stop requires an operator and a reason');
  }
  if (!Number.isFinite(input.now)) {
    throw new EmergencyStopError('EMERGENCY_STOP_INPUT_INVALID', 'emergency stop requires a finite clock');
  }
}

/** Operator-facing view of the switch. Carries no secret and no private world content. */
export type EmergencyStopView = {
  worldId: string;
  engaged: boolean;
  state: EmergencyStopState;
  engagedAt?: number;
  engagedBy?: string;
  reason?: string;
  scheduleStatusBefore?: PreStopScheduleStatus;
  preservedSlotKeys: string[];
  activationCount: number;
  releasedAt?: number;
  releasedBy?: string;
  releaseReason?: string;
};

export function summarizeEmergencyStop(worldId: string, record: EmergencyStopRecord | null | undefined): EmergencyStopView {
  if (!record) {
    return { worldId, engaged: false, state: 'released', preservedSlotKeys: [], activationCount: 0 };
  }
  return {
    worldId: record.worldId,
    engaged: isSimulationHalted(record),
    state: record.state,
    engagedAt: record.engagedAt,
    engagedBy: record.engagedBy,
    reason: record.reason,
    scheduleStatusBefore: record.scheduleStatusBefore,
    preservedSlotKeys: [...record.preservedSlotKeys],
    activationCount: record.activationCount,
    releasedAt: record.releasedAt,
    releasedBy: record.releasedBy,
    releaseReason: record.releaseReason,
  };
}

/**
 * Wrap every world-day stage handler with the admission gate.
 *
 * A stop engaged while a run is in flight must halt it at the NEXT stage boundary,
 * never in the middle of one. Checking at the boundary means the orchestrator's
 * ordinary failure path runs: the already-completed checkpoints keep their artifacts,
 * the failing stage is checkpointed as failed, and the run is marked failed with
 * {@link EMERGENCY_STOP_ERROR_CODE}. Nothing is committed, nothing is discarded, and
 * a later resume restarts at exactly that stage — so the same run cannot commit twice.
 *
 * The gate is re-read per stage rather than once per run so that the halt is evaluated
 * as late as possible against current durable state.
 */
export function guardWorldDayStageHandlers(
  handlers: WorldDayStageHandlers,
  isHalted: () => boolean | Promise<boolean>,
): WorldDayStageHandlers {
  return Object.fromEntries(WORLD_DAY_STAGES.map((stage) => [stage, async (context: Parameters<WorldDayStageHandlers[typeof stage]>[0]) => {
    if (await isHalted()) {
      throw new WorldDayOrchestrationError(
        EMERGENCY_STOP_ERROR_CODE,
        `world ${context.worldId} is under an emergency stop; stage ${stage} was not started`,
      );
    }
    return handlers[stage](context);
  }])) as WorldDayStageHandlers;
}
