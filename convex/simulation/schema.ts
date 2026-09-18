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

  /**
   * Why one whole-scene authoring attempt failed, in enough detail to act on (ART-195).
   *
   * ## Why this is not a column on `llmTraces`
   *
   * `llmTraces` is FR-M001's per-call accounting record and its contract is that it carries no
   * free text at all: `normalizeLlmTraceDraft` rejects any key that looks like a prompt, a request
   * body or credential material, and its `errorCode` must match a bounded upper-case pattern
   * specifically so a provider's error message cannot be written into it. That contract is
   * correct and is not widened here. A sanitized message is still free text, and it belongs in a
   * table that says so.
   *
   * ## What made the separate table necessary at all
   *
   * A live slot failed with `authoringErrorCode: SCENE_SIMULATION_FAILED` and an attempt row
   * reading `SCENE_ATTEMPT_FAILED` — which is the marker for "the error carried no code", not a
   * diagnosis. Both were constants. Nothing in the deployment could say whether the gateway was
   * down, the key was refused, a Convex mutation inside the budget gate had failed, or the
   * pre-generation policy had blocked the prompt, and answering that required deploying new code.
   *
   * ## What is safe to keep here
   *
   * `message` and `causeMessage` are passed through `sanitizeFailureText` (bearer tokens,
   * credential query parameters and long opaque runs removed, bounded, truncation published) and
   * then through an exact-value pass against the configured credential in
   * `convex/simulation/providers/`. No request body, no prompt, no provider response, and a
   * non-string message yields the empty string rather than being stringified — an arbitrary object
   * hanging off an error is most likely the payload that caused it.
   *
   * Insert-if-absent on `attemptId`, which is `${simulationRunId}:attempt:${n}` — the same derived
   * key `llmTraces` uses — so a retried slot re-records rather than re-counts.
   */
  authoringFailures: defineTable({
    schemaVersion: v.literal(1),
    /** `${simulationRunId}:attempt:${n}`; identical to the `llmTraces` row's `traceId`. */
    attemptId: v.string(),
    worldId: v.string(),
    worldDay: v.number(),
    timeSlot: v.string(),
    sceneId: v.string(),
    simulationRunId: v.string(),
    attempt: v.number(),
    /** The stable outer code, the same value the `llmTraces` row carries. */
    code: v.string(),
    /** The thrown value's own class name, or the `typeof` of a throw that was not an Error. */
    errorName: v.string(),
    /** Sanitized and bounded. Empty when the throw carried no string message. */
    message: v.string(),
    stage: v.string(),
    causeName: v.union(v.string(), v.null()),
    causeCode: v.union(v.string(), v.null()),
    causeMessage: v.union(v.string(), v.null()),
    /** The predicate the retry loop actually applied, not a description of it. */
    retryable: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_attempt_id', ['attemptId'])
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_and_time', ['worldId', 'createdAt']),

  worldDayCheckpoints: defineTable({
    runId: v.string(), stage: v.string(), attempt: v.number(),
    status: v.union(v.literal('running'), v.literal('failed'), v.literal('completed')),
    artifact: v.optional(v.any()), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  })
    .index('by_run_and_stage', ['runId', 'stage'])
    .index('by_run_stage_attempt', ['runId', 'stage', 'attempt']),

  /**
   * The FR-M004 degradation state of one world, and its transition log (ART-91).
   *
   * Exactly one `worldDegradationStates` row per world: the CURRENT rung, the consecutive failures
   * counted at it, and where it last moved. The transitions are a separate append-only table for
   * the reason `safetyStatusOverrides` is separate from the classification it revises — the
   * history of how a world got here must not be editable by the thing that moves it.
   *
   * A transition id is derived from `(worldId, worldDay, timeSlot, kind)`, so a retried slot
   * re-derives it and the log records one move rather than one per attempt (AC#2).
   *
   * That note used to go on to say a replayed slot therefore could not walk the ladder. It could:
   * the transition ROW deduplicates, but the state row is patched either way, so two deliveries of
   * one failure counted two failures. Exactly-once is now a property of the pure decision —
   * `advanceDegradation` ignores a signal whose `(worldDay, timeSlot)` already moved the world —
   * and `lastSignalKey` below is what persists it (ART-165).
   */
  worldDegradationStates: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    level: v.string(),
    consecutiveFailures: v.number(),
    lastTriggerCode: v.union(v.string(), v.null()),
    lastTransitionWorldDay: v.number(),
    lastTransitionAt: v.number(),
    /**
     * ART-165. Slots run on a no-provider rung since the provider was last actually tried, and the
     * slot whose outcome last moved this world.
     *
     * Optional so rows written before ART-165 read back: a world mid-outage at deploy time resumes
     * with a zeroed probe counter and no recorded signal, which costs it one extra deterministic
     * world day and cannot move it in the wrong direction.
     */
    slotsSinceProviderProbe: v.optional(v.number()),
    lastSignalKey: v.optional(v.union(v.string(), v.null())),
    updatedAt: v.number(),
  }).index('by_world_id', ['worldId']),

  worldDegradationTransitions: defineTable({
    schemaVersion: v.literal(1),
    transitionId: v.string(),
    worldId: v.string(),
    fromLevel: v.string(),
    toLevel: v.string(),
    reason: v.string(),
    triggerCode: v.union(v.string(), v.null()),
    worldDay: v.number(),
    timeSlot: v.string(),
    consecutiveFailures: v.number(),
    createdAt: v.number(),
  })
    .index('by_transition_id', ['transitionId'])
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_and_created', ['worldId', 'createdAt']),

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
    /**
     * Canon refused this stored scene, so it must never be reused (ART-205).
     *
     * ART-149 reuse exists so a slot that failed on scene 3 does not re-pay for scenes 1 and 2, and
     * it is load-bearing for cost and for determinism. It also meant that a scene whose proposals
     * Canon refused was replayed into the identical refusal on every retry: the slot could not
     * recover however many attempts it was given, and no provider call was ever made to try
     * anything different. Day 5 morning on the acceptance world sat failed at four attempts for
     * exactly this reason.
     *
     * ART-205 stops most of these being stored at all, by asking Canon during authoring. This
     * covers the remainder: the projection can move between authoring and stage 8, so a scene can
     * be accepted by the first check and refused by the authoritative one. Marking it is what makes
     * that a retry rather than a permanent park.
     *
     * OPTIONAL for migration safety: rows written before ART-205 carry no flag and are read as not
     * rejected, which is how they were already treated.
     */
    canonRejectedAt: v.optional(v.number()),
    canonRejectionCode: v.optional(v.string()),
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
