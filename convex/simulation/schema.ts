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
