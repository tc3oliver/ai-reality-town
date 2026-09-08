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
  /**
   * The three accounting fields are OPTIONAL, and absent means "this recorder did not observe
   * it" (ART-166).
   *
   * They were required until ART-166, and `recordAuthoringAttempt` — the only production writer —
   * satisfied that requirement with literal zeros, because the settled usage is reported on a call
   * it never sees. The rate metrics never read them, but the FR-K002 Model Trace panel does, and
   * it rendered a call that really happened as 0 tokens and 0 ms. A zero is a measurement; an
   * absence is the truth. ART-59's budget ledger remains the accounting of record.
   */
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  latencyMs: v.optional(v.number()),
  retryCount: v.number(),
  validationResult: v.union(v.literal('not_run'), v.literal('passed'), v.literal('rejected')),
  finalStatus: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('withheld')),
  /**
   * The stable code this call failed with, when it failed with one (ART-166).
   *
   * `recordAuthoringAttempt` took an `errorCode` argument from ART-90 and had nowhere to put it,
   * so `getOperationalQualityMetrics` read `null` and the reason dimensions it publishes each
   * carried one substituted constant. The distinction being lost is the one the live driver
   * argues is load-bearing: `LLM_HTTP_RETRYABLE`, `LLM_FREE_ROUTES_EXHAUSTED` and
   * `LLM_CONFIG_MISSING` call for three different operator responses.
   *
   * A CODE, never a message — `normalizeLlmTraceDraft` refuses anything that is not a bounded
   * upper-case identifier, so this field cannot become the hole through which a provider's error
   * text reaches an operator surface.
   */
  errorCode: v.optional(v.string()),
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
