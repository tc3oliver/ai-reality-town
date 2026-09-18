/**
 * The two write boundaries FR-M002's operational metrics need (ART-90).
 *
 * Both are `internalMutation`s: they are called by the world-day pipeline, never by a client, and
 * neither is on the public function surface. Both are insert-if-absent on a DERIVED key, so a
 * retried slot re-records what it already recorded instead of counting it twice — which is the
 * whole of ART-90's AC#3.
 *
 * Neither carries a payload. A validation row holds an idempotency key, a stage, a verdict and a
 * stable code; an attempt row holds a model id, an outcome and a code.
 *
 * ## One text field, added deliberately (ART-195)
 *
 * This header used to end "Nothing here can carry a proposal, a prompt, a model response or a
 * secret, because none of those is an argument." That reasoning was sound and its conclusion is
 * now too strong: `recordAuthoringAttempt` takes a `failure` whose `message` is text.
 *
 * It is there because the alternative was measured and failed. A live slot stopped the world and
 * the evidence it left was two constants — `SCENE_SIMULATION_FAILED` on the slot and
 * `SCENE_ATTEMPT_FAILED` on the attempt, the latter being the marker for "the error carried no
 * code" rather than a diagnosis. Answering "why" required deploying new code, which is the one
 * thing an operator watching a stalled world cannot do quickly.
 *
 * The guarantee is preserved by construction rather than by the field not existing:
 *
 *  - the text is produced only by `sanitizeFailureText` (`convex/shared/failureDetail.ts`), which
 *    strips bearer tokens, credential-shaped query parameters and long opaque runs, bounds the
 *    result, and publishes what it truncated;
 *  - `convex/simulation/providers/` applies a second, exact-value pass against the configured
 *    credential — the one place that holds it;
 *  - a non-string `message` yields the empty string. No arbitrary object is ever stringified,
 *    because the object most likely to be hanging off a provider error is the payload;
 *  - it is written to `authoringFailures`, NOT to `llmTraces`. That table's contract — a bounded
 *    machine code and no free text, enforced by `normalizeLlmTraceDraft` — is untouched.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { normalizeLlmTraceDraft } from '../observability/llmTrace';
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
 *
 * ## The row goes through ART-57's normaliser (ART-166)
 *
 * The paragraph above has said "with a strict whitelist normaliser" since ART-90, while the row
 * was inserted straight into the table beside it — so for the one writer this deployment actually
 * runs, the normaliser guarded nothing. It does now: {@link normalizeLlmTraceDraft} is what makes
 * `errorCode` a bounded upper-case CODE rather than whatever string a caller passed, which is the
 * whole reason the field is safe to add. A draft it refuses throws, and the caller swallows the
 * throw (`worldDayLive.ts` records fire-and-forget) — one measurement is lost, never a scene.
 */
export const recordAuthoringAttempt = internalMutation({
  args: {
    worldId: v.string(),
    worldDay: v.number(),
    timeSlot: v.string(),
    sceneId: v.string(),
    simulationRunId: v.string(),
    attempt: v.number(),
    outcome: v.union(v.literal('parsed'), v.literal('output_rejected'),
      v.literal('canon_rejected'), v.literal('provider_failed')),
    errorCode: v.union(v.string(), v.null()),
    /**
     * ART-195. The sanitized detail behind `errorCode`, written to `authoringFailures`.
     *
     * Optional so a caller written before ART-195 still records a trace rather than throwing —
     * the recorder's own failures are swallowed by `worldDayLive.ts`, so a rejected draft costs a
     * measurement silently, which is the one way this change could have made diagnosis worse.
     */
    failure: v.optional(v.union(v.object({
      code: v.string(),
      errorName: v.string(),
      message: v.string(),
      stage: v.string(),
      causeName: v.union(v.string(), v.null()),
      causeCode: v.union(v.string(), v.null()),
      causeMessage: v.union(v.string(), v.null()),
      retryable: v.boolean(),
    }), v.null())),
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
    /**
     * ART-195. Written BEFORE the `llmTraces` dedup return, and deduplicated on its own key.
     *
     * Ordering matters for exactly one case, and it is the case this task is about: a trace row
     * written before ART-195 exists with no failure detail beside it, and a re-run that returned
     * early on the trace's dedup would never write the detail that re-run was performed to obtain.
     */
    if (args.failure) {
      const priorFailure = await ctx.db.query('authoringFailures')
        .withIndex('by_attempt_id', (q) => q.eq('attemptId', traceId)).unique();
      if (!priorFailure) {
        await ctx.db.insert('authoringFailures', {
          schemaVersion: 1,
          attemptId: traceId,
          worldId: args.worldId,
          worldDay: args.worldDay,
          timeSlot: args.timeSlot,
          sceneId: args.sceneId,
          simulationRunId: args.simulationRunId,
          attempt: args.attempt,
          ...args.failure,
          createdAt: args.now,
        });
      }
    }
    const existing = await ctx.db.query('llmTraces')
      .withIndex('by_trace_id', (q) => q.eq('traceId', traceId)).unique();
    if (existing) return { traceId, deduplicated: true };
    const draft = normalizeLlmTraceDraft({
      schemaVersion: 1,
      traceId,
      worldId: args.worldId,
      worldDay: args.worldDay,
      runId: args.simulationRunId,
      sceneId: args.sceneId,
      characterIds: [],
      model: args.resolvedModel ?? args.requestedModel,
      promptVersion: 'whole_scene_output',
      // `inputTokens`, `outputTokens` and `latencyMs` are OMITTED, not zeroed (ART-166).
      //
      // The fake and the live adapter both report usage on the SETTLED call, which this recorder
      // does not see; ART-59's ledger is the accounting of record and this row does not restate
      // it. From ART-90 until ART-166 that reasoning was written above three literal zeros, which
      // is not what it argues for: the rate metrics ignore these fields, but the FR-K002 Model
      // Trace panel renders them, and it showed a call that really happened as 0 tokens and 0 ms.
      // Before ART-90 nothing wrote to this table at all and the panel showed null, so the zeros
      // made the answer worse than no answer. The fields are optional; absent means unobserved.
      retryCount: args.transportRetries,
      // ART-205: a canon rejection PASSED structured validation — the schema accepted it and the
      // world refused the content. Recording it as `rejected` would put a content refusal in the
      // field §16.2 reads for schema compliance.
      validationResult: args.outcome === 'parsed' || args.outcome === 'canon_rejected' ? 'passed'
        : args.outcome === 'output_rejected' ? 'rejected' : 'not_run',
      finalStatus: args.outcome === 'parsed' ? 'succeeded' : 'failed',
      // The code the attempt actually failed with, kept rather than discarded (ART-166). ART-90
      // declared this argument, dropped it on the floor, and let the reader substitute one
      // constant per reason dimension — so every schema refusal read `SCENE_OUTPUT_INVALID` and
      // every provider failure read `SCENE_ATTEMPT_FAILED`, whatever had actually happened.
      ...(args.errorCode === null ? {} : { errorCode: args.errorCode }),
    });
    await ctx.db.insert('llmTraces', { ...draft, recordedAt: args.now });
    return { traceId, deduplicated: false };
  },
});
