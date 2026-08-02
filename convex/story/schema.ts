import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const storyArcStatusValidator = v.union(
  v.literal('emerging'), v.literal('active'), v.literal('escalating'),
  v.literal('climax'), v.literal('resolving'), v.literal('resolved'), v.literal('archived'),
);

export const storyTables = {
  storyArcLifecycles: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    arcId: v.string(),
    status: storyArcStatusValidator,
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_world_and_arc', ['worldId', 'arcId'])
    .index('by_world_and_status', ['worldId', 'status']),

  storyArcLifecycleTransitions: defineTable({
    worldId: v.string(),
    arcId: v.string(),
    transitionId: v.string(),
    revision: v.number(),
    fromStatus: v.optional(storyArcStatusValidator),
    toStatus: storyArcStatusValidator,
    sourceEventId: v.string(),
    sourceEventSequenceNumber: v.number(),
    reason: v.string(),
    changedAt: v.number(),
  })
    .index('by_world_arc_and_revision', ['worldId', 'arcId', 'revision'])
    .index('by_source_event', ['worldId', 'sourceEventSequenceNumber']),
};
