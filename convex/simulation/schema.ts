/**
 * Convex table for simulation runs. Tracks each execution of a simulation workflow from
 * pending → running → completed/failed, with stable error codes and a reference to the
 * committed canon event on success.
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const simulationTables = {
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
    status: v.union(v.literal('queued'), v.literal('running'), v.literal('completed'), v.literal('failed')),
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
};
