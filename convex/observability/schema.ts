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

/**
 * The five fields a trace read may return to an unauthenticated caller (FR-O009).
 *
 * Declared to Convex so `getTracePublic` cannot widen by accident: without a `returns`
 * validator a refactor that stopped calling `publicLlmTrace` would happily serve
 * the full accounting record -- model, token counts, prompt version -- to anyone.
 * Projected off the draft validator rather than restated so the field types cannot drift.
 */
export const publicLlmTraceValidator = v.object({
  schemaVersion: llmTraceDraftValidator.fields.schemaVersion,
  traceId: llmTraceDraftValidator.fields.traceId,
  worldId: llmTraceDraftValidator.fields.worldId,
  worldDay: llmTraceDraftValidator.fields.worldDay,
  finalStatus: llmTraceDraftValidator.fields.finalStatus,
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
