/**
 * Convex table for simulation runs. Tracks each execution of a simulation workflow from
 * pending → running → completed/failed, with stable error codes and a reference to the
 * committed canon event on success.
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const simulationTables = {
  simulationRuns: defineTable({
    worldId: v.string(),
    runType: v.string(),
    status: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    provider: v.string(),
    traceId: v.string(),
    // Extensions over the minimum spec fields: link a completed run to its event.
    committedEventId: v.optional(v.string()),
    sequenceNumber: v.optional(v.number()),
  })
    .index('by_world_and_status', ['worldId', 'status'])
    .index('by_world_and_event', ['worldId', 'committedEventId']),
};
