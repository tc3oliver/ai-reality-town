import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const safetyTables = {
  postGenerationSafetyClassifications: defineTable({
    policyVersion: v.literal(1),
    worldId: v.string(),
    classificationId: v.string(),
    sourceId: v.string(),
    kind: v.union(v.literal('scene'), v.literal('public_artifact')),
    label: v.union(v.literal('allow'), v.literal('allow_with_warning'), v.literal('withhold'), v.literal('human_review_required')),
    reasonCodes: v.array(v.string()),
    warningCodes: v.array(v.string()),
    classifiedTextHash: v.string(),
    createdAt: v.number(),
  })
    .index('by_world_and_classification', ['worldId', 'classificationId'])
    .index('by_world_and_label', ['worldId', 'label']),
};
