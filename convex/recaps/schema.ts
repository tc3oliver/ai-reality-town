import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const recapType = v.union(v.literal('scene'), v.literal('episode'), v.literal('arc'), v.literal('season'), v.literal('viewer_context'));

export const recapTables = {
  recapSnapshots: defineTable({
    snapshotId: v.string(), schemaVersion: v.literal(1), worldId: v.string(), recapType, targetId: v.string(),
    sourceFromEventId: v.string(), sourceToEventId: v.string(), sourceFromSequenceNumber: v.number(),
    sourceToSequenceNumber: v.number(), content: v.string(), structuredPayload: v.any(), version: v.number(),
    generatedAt: v.number(),
  })
    .index('by_snapshot_id', ['snapshotId'])
    .index('by_target_and_version', ['worldId', 'recapType', 'targetId', 'version'])
    .index('by_target_and_time', ['worldId', 'recapType', 'targetId', 'generatedAt']),
};
