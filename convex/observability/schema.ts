import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const llmTraceDraftValidator = v.object({
  schemaVersion: v.literal(1),
  traceId: v.string(),
  worldId: v.string(),
  worldDay: v.number(),
  runId: v.string(),
  sceneId: v.optional(v.string()),
  arcId: v.optional(v.string()),
  characterIds: v.array(v.string()),
  model: v.string(),
  promptVersion: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  latencyMs: v.number(),
  retryCount: v.number(),
  validationResult: v.union(v.literal('not_run'), v.literal('passed'), v.literal('rejected')),
  finalStatus: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('withheld')),
});

export const observabilityTables = {
  llmTraces: defineTable({
    ...llmTraceDraftValidator.fields,
    recordedAt: v.number(),
  })
    .index('by_trace_id', ['traceId'])
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_run_id', ['runId']),
};
