/**
 * The two write boundaries FR-M002's operational metrics need (ART-90).
 *
 * Both are `internalMutation`s: they are called by the world-day pipeline, never by a client, and
 * neither is on the public function surface. Both are insert-if-absent on a DERIVED key, so a
 * retried slot re-records what it already recorded instead of counting it twice — which is the
 * whole of ART-90's AC#3.
 *
 * Neither carries a payload. A validation row holds an idempotency key, a stage, a verdict and a
 * stable code; an attempt row holds a model id, an outcome and a code. Nothing here can carry a
 * proposal, a prompt, a model response or a secret, because none of those is an argument.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { reconcileValidationOutcome, ValidationOutcomeError } from './validationOutcome';

/** Record one validation stage's verdict on every proposal it saw. */
export const recordProposalValidations = internalMutation({
  args: {
    outcomes: v.array(v.object({
      worldId: v.string(),
      worldDay: v.number(),
      timeSlot: v.string(),
      idempotencyKey: v.string(),
      sceneId: v.union(v.string(), v.null()),
      stage: v.union(v.literal('structural'), v.literal('canon')),
      outcome: v.union(v.literal('accepted'), v.literal('rejected')),
      errorCode: v.union(v.string(), v.null()),
    })),
    now: v.number(),
  },
  returns: v.object({ inserted: v.number(), deduplicated: v.number() }),
  handler: async (ctx, args) => {
    let inserted = 0;
    let deduplicated = 0;
    for (const outcome of args.outcomes) {
      if (!Number.isSafeInteger(outcome.worldDay) || outcome.worldDay < 0 || outcome.idempotencyKey.trim().length === 0) {
        throw new ValidationOutcomeError('VALIDATION_OUTCOME_INVALID', 'a verdict needs a world day and an idempotency key');
      }
      const prior = await ctx.db.query('canonValidationOutcomes')
        .withIndex('by_world_key_and_stage', (q) => q
          .eq('worldId', outcome.worldId).eq('idempotencyKey', outcome.idempotencyKey).eq('stage', outcome.stage))
        .unique();
      if (prior) {
        reconcileValidationOutcome(
          { outcome: prior.outcome, errorCode: prior.errorCode, idempotencyKey: prior.idempotencyKey, stage: prior.stage },
          { outcome: outcome.outcome, errorCode: outcome.errorCode },
        );
        deduplicated += 1;
        continue;
      }
      await ctx.db.insert('canonValidationOutcomes', { schemaVersion: 1, ...outcome, createdAt: args.now });
      inserted += 1;
    }
    return { inserted, deduplicated };
  },
});

/**
 * Record one whole-scene authoring attempt.
 *
 * Written through ART-57's `llmTraces` rather than a new table, because that table already IS the
 * per-call record FR-M001 defines — `validationResult`, `finalStatus`, `retryCount`, model and
 * prompt version, with a strict whitelist normaliser that throws on any field that looks like raw
 * model input or credential material. Until ART-90 nothing in the deployment called
 * `recordTrace`: the table, the normaliser, the redaction and the public projection were all
 * built, tested and unreachable, so `validationResult` and `finalStatus` were structurally absent
 * from every world and two consumers (`dynamicViewMetricsFunctions`'s trace count and the FR-K002
 * proposal review's model trace) read an always-empty table. This is that writer.
 *
 * The mapping, stated because a metric is only as good as it:
 *
 * | attempt outcome | `validationResult` | `finalStatus` |
 * | --- | --- | --- |
 * | `parsed` | `passed` | `succeeded` |
 * | `output_rejected` | `rejected` | `failed` |
 * | `provider_failed` | `not_run` | `failed` |
 *
 * `not_run` is the load-bearing one: an attempt that never got an answer did not fail validation,
 * and §16.2's structured-output rate must not count a timeout as a model that cannot follow a
 * schema. The rate's denominator is therefore `passed + rejected`, not every trace.
 */
export const recordAuthoringAttempt = internalMutation({
  args: {
    worldId: v.string(),
    worldDay: v.number(),
    timeSlot: v.string(),
    sceneId: v.string(),
    simulationRunId: v.string(),
    attempt: v.number(),
    outcome: v.union(v.literal('parsed'), v.literal('output_rejected'), v.literal('provider_failed')),
    errorCode: v.union(v.string(), v.null()),
    requestedModel: v.string(),
    resolvedModel: v.union(v.string(), v.null()),
    transportRetries: v.number(),
    now: v.number(),
  },
  returns: v.object({ traceId: v.string(), deduplicated: v.boolean() }),
  handler: async (ctx, args) => {
    // Derived from the simulation run and the attempt index, both of which a retried slot
    // re-derives identically — so re-running a slot re-reaches the same trace ids.
    const traceId = `${args.simulationRunId}:attempt:${args.attempt}`;
    const existing = await ctx.db.query('llmTraces')
      .withIndex('by_trace_id', (q) => q.eq('traceId', traceId)).unique();
    if (existing) return { traceId, deduplicated: true };
    await ctx.db.insert('llmTraces', {
      schemaVersion: 1,
      traceId,
      worldId: args.worldId,
      worldDay: args.worldDay,
      runId: args.simulationRunId,
      sceneId: args.sceneId,
      characterIds: [],
      model: args.resolvedModel ?? args.requestedModel,
      promptVersion: 'whole_scene_output',
      // The fake and the live adapter both report usage on the SETTLED call, which this recorder
      // does not see; ART-59's ledger is the accounting of record and this row does not restate it.
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      retryCount: args.transportRetries,
      validationResult: args.outcome === 'parsed' ? 'passed'
        : args.outcome === 'output_rejected' ? 'rejected' : 'not_run',
      finalStatus: args.outcome === 'parsed' ? 'succeeded' : 'failed',
      recordedAt: args.now,
    });
    return { traceId, deduplicated: false };
  },
});
