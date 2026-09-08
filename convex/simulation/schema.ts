/**
 * Convex table for simulation runs. Tracks each execution of a simulation workflow from
 * pending → running → completed/failed, with stable error codes and a reference to the
 * committed canon event on success.
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const simulationTables = {
  worldDayRuns: defineTable({
    runId: v.string(), worldId: v.string(), worldDay: v.number(),
    timeSlot: v.union(v.literal('morning'), v.literal('noon'), v.literal('afternoon'), v.literal('evening'), v.literal('night')),
    status: v.union(v.literal('running'), v.literal('failed'), v.literal('completed')),
    attemptCount: v.number(), failureStage: v.optional(v.string()), errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()), committedEventIds: v.optional(v.array(v.string())),
    createdAt: v.number(), updatedAt: v.number(),
  })
    .index('by_run_id', ['runId'])
    .index('by_world_day_slot', ['worldId', 'worldDay', 'timeSlot']),

  /**
   * What Canon validation decided about each Proposed Event (ART-90).
   *
   * See `convex/simulation/validationOutcome.ts` for why the three existing run tables cannot
   * answer a rejection rate: one is patched per attempt, one is cleared on retry, and the third
   * records one code for a stage that validated many proposals. Keyed on
   * `(worldId, idempotencyKey, stage)` and written insert-if-absent, so a retried slot re-derives
   * the same keys and the rate counts logical proposals rather than attempts.
   *
   * Carries no payload: the key, the stage, the verdict and a stable code. A rejected proposal's
   * content is exactly what FR-M002's "without exposing secrets" clause is about.
   */
  canonValidationOutcomes: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    worldDay: v.number(),
    timeSlot: v.string(),
    idempotencyKey: v.string(),
    sceneId: v.union(v.string(), v.null()),
    stage: v.union(v.literal('structural'), v.literal('canon')),
    outcome: v.union(v.literal('accepted'), v.literal('rejected')),
    errorCode: v.union(v.string(), v.null()),
    createdAt: v.number(),
  })
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_key_and_stage', ['worldId', 'idempotencyKey', 'stage']),

  worldDayCheckpoints: defineTable({
    runId: v.string(), stage: v.string(), attempt: v.number(),
    status: v.union(v.literal('running'), v.literal('failed'), v.literal('completed')),
    artifact: v.optional(v.any()), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  })
    .index('by_run_and_stage', ['runId', 'stage'])
    .index('by_run_stage_attempt', ['runId', 'stage', 'attempt']),

  worldSchedules: defineTable({
    worldId: v.string(),
    mode: v.union(v.literal('public'), v.literal('development'), v.literal('test'), v.literal('warmup')),
    status: v.union(v.literal('running'), v.literal('paused')),
    baseSeed: v.number(),
    anchorRealTimeMs: v.number(),
    anchorWorldDay: v.number(),
    nextWorldDay: v.number(),
    nextTimeSlot: v.union(v.literal('morning'), v.literal('noon'), v.literal('afternoon'), v.literal('evening'), v.literal('night')),
    publishEnabled: v.boolean(),
    pausedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_world_id', ['worldId'])
    .index('by_mode_and_status', ['mode', 'status']),

  scheduledSlots: defineTable({
    slotKey: v.string(),
    worldId: v.string(),
    worldDay: v.number(),
    timeSlot: v.union(v.literal('morning'), v.literal('noon'), v.literal('afternoon'), v.literal('evening'), v.literal('night')),
    trigger: v.union(v.literal('clock'), v.literal('manual-slot'), v.literal('manual-day'), v.literal('accelerated'), v.literal('retry')),
    // `cancelled` is set only by the authorized operations console (FR-K001) and
    // only for a slot that has not committed anything to Canon.
    status: v.union(v.literal('queued'), v.literal('running'), v.literal('completed'), v.literal('failed'), v.literal('cancelled')),
    seed: v.number(),
    publishEnabled: v.boolean(),
    idempotencyKey: v.string(),
    attemptCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    committedEventId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    /**
     * When this slot's claim stops being honoured (ART-160).
     *
     * The live path runs prepare (mutation) → author (action) → finalize (mutation), and nothing
     * about that sequence is transactional as a whole. Without a lease a slot whose action never
     * started, crashed, timed out, or finished without finalizing would sit in `running` forever
     * and the world would stop — and a duplicate cron delivery would author a second slot against
     * a world the first one had not finished advancing.
     *
     * So the claim is time-bounded. A `running` slot with a live lease means "someone is on it";
     * an expired one means "whoever had it is gone, take it over". Resuming is safe because every
     * identifier on the path is derived from (worldId, worldDay, timeSlot): the run resumes from
     * its checkpoints, authored scenes are reused rather than re-paid for, and the commit dedups
     * on `idempotencyKey`.
     *
     * OPTIONAL for migration safety: rows written before ART-160 carry no lease, and are read as
     * expired — which is the correct reading, since nothing is holding them.
     */
    leaseExpiresAt: v.optional(v.number()),
  })
    .index('by_slot_key', ['slotKey'])
    .index('by_world_and_status', ['worldId', 'status'])
    .index('by_world_day_and_slot', ['worldId', 'worldDay', 'timeSlot']),

  simulationRuns: defineTable({
    worldId: v.string(),
    runType: v.string(),
    status: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    errorPath: v.optional(v.string()),
    errorDetails: v.optional(v.any()),
    provider: v.string(),
    traceId: v.string(),
    // Extensions over the minimum spec fields: link a completed run to its event.
    committedEventId: v.optional(v.string()),
    sequenceNumber: v.optional(v.number()),
  })
    .index('by_world_and_status', ['worldId', 'status'])
    .index('by_world_and_event', ['worldId', 'committedEventId']),

  directorPlans: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    directorRunId: v.string(),
    worldDay: v.number(),
    timeSlot: v.union(v.literal('morning'), v.literal('noon'), v.literal('afternoon'), v.literal('evening'), v.literal('night')),
    context: v.any(),
    plan: v.any(),
    createdAt: v.number(),
  })
    .index('by_world_and_run', ['worldId', 'directorRunId'])
    .index('by_world_day_and_slot', ['worldId', 'worldDay', 'timeSlot']),

  characterIntents: defineTable({
    schemaVersion: v.literal(1), worldId: v.string(), intentRunId: v.string(), directorRunId: v.string(),
    characterId: v.string(), context: v.any(), intent: v.any(), disposition: v.union(v.literal('accepted'), v.literal('downgraded')),
    createdAt: v.number(),
  })
    .index('by_world_and_run', ['worldId', 'intentRunId'])
    .index('by_director_run', ['worldId', 'directorRunId']),

  groupedSceneRuns: defineTable({
    schemaVersion: v.literal(1), worldId: v.string(), groupingRunId: v.string(), directorRunId: v.string(),
    worldDay: v.number(), timeSlot: v.union(v.literal('morning'), v.literal('noon'), v.literal('afternoon'), v.literal('evening'), v.literal('night')),
    intentRunIds: v.array(v.string()), result: v.any(), createdAt: v.number(),
  })
    .index('by_world_and_run', ['worldId', 'groupingRunId'])
    .index('by_director_run', ['worldId', 'directorRunId']),

  sceneSimulationRuns: defineTable({
    schemaVersion: v.literal(1), worldId: v.string(), simulationRunId: v.string(), groupingRunId: v.string(),
    sceneId: v.string(), status: v.union(v.literal('validated'), v.literal('review_required')),
    result: v.any(), createdAt: v.number(),
  })
    .index('by_world_and_run', ['worldId', 'simulationRunId'])
    .index('by_grouping_run', ['worldId', 'groupingRunId'])
    .index('by_scene', ['worldId', 'sceneId']),

  /**
   * FR-K006 world emergency stop (Kill Switch). Exactly one row per world,
   * toggled between `engaged` and `released`; the row is the world's admission
   * gate for NEW simulation work and its own activation history head.
   *
   * NON-DESTRUCTIVE BY CONSTRUCTION: this table records the switch only. It never
   * mirrors, supersedes, or rewrites `canonEvents`, `scheduledSlots`,
   * `worldDayRuns`, `worldDayCheckpoints`, or `publishedReadModels`, so engaging
   * the stop cannot lose an accepted event, discard an incomplete run, or change
   * what the public read path serves.
   */
  worldEmergencyStops: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    state: v.union(v.literal('engaged'), v.literal('released')),
    /** Operator, reason, and instant of the most recent activation. */
    engagedAt: v.number(),
    engagedBy: v.string(),
    reason: v.string(),
    /** Schedule status captured before the stop paused it; restored on release. */
    scheduleStatusBefore: v.union(v.literal('running'), v.literal('paused')),
    /** Slot keys queued or running at activation. Evidence only; never mutated. */
    preservedSlotKeys: v.array(v.string()),
    activationCount: v.number(),
    releasedAt: v.optional(v.number()),
    releasedBy: v.optional(v.string()),
    releaseReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_world_id', ['worldId'])
    .index('by_world_and_state', ['worldId', 'state']),

  // FR-A004 private warmup markers (PRD §10.3). The full marker object
  // (actual start day, public broadcast start day, recommended newcomer entry,
  // phase, …) is stored as one blob; warmup content is unpublished until the
  // warmup completes AND an admin confirms the public start day.
  warmupMarkers: defineTable({
    schemaVersion: v.literal(1), worldId: v.string(),
    markers: v.any(),
    updatedAt: v.number(),
  })
    .index('by_world_id', ['worldId']),
};
