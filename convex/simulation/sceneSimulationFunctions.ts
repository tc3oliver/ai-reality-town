import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import type { ProviderTraceMetadata } from './provider';
import { createConvexCanonReader } from '../canon/commit';
import type { ProposedEvent } from '../canon/model';
import { validateCanon, validateEventStructure } from '../canon/validators';
import { canonRejectionFeedback, type CanonRejectionFeedback } from './canonFeedback';
import { canonRuleContext } from './worldDayLive';
import type { SceneGroupingResult } from './sceneGrouping';
import { finalizeWholeSceneOutput, parseWholeSceneOutput, SceneSimulationError, type SceneSimulationResult } from './sceneSimulation';

/** A whole non-negative integer, as every token and timing field on the trace must be. */
const isCount = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;

/** A field the gateway may decline to report. `null` is a state, absent is a malformed trace. */
const isNullableName = (value: unknown): boolean =>
  value === null || (typeof value === 'string' && value.trim().length > 0);

/**
 * `x-ratelimit-*` as the adapter read it, or `null` when the gateway sent none.
 *
 * Checked structurally rather than waved through: this is the number that decides whether the
 * world can keep running, and a partially-parsed allowance would report a confident figure built
 * from a header that was not there.
 */
function isRateLimit(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 3
    && isCount(row.limit) && isCount(row.remaining) && isCount(row.resetAtEpochSeconds);
}

/**
 * The one contract governing what reaches `sceneSimulationRuns.result.trace`.
 *
 * `trace` is declared `v.any()`, so Convex validates nothing here and this function IS the schema.
 * The whitelist is therefore two guarantees at once: that every field the port promises is
 * present, and that NOTHING else is — an adapter that attached its prompt or its credential to a
 * trace would otherwise write it to a table operators can read.
 *
 * ## The rename this failed to survive
 *
 * Until ART-159 the list read `['provider', 'model', ...]` and required `row.model` to be a
 * non-empty string. That was correct until ART-148 renamed `model` to `requestedModel` and added
 * `resolvedModel`, `upstreamProvider` and `rateLimit` — after which it rejected every trace BOTH
 * shipped providers emit, and accepted only the stale shape neither of them produces any more.
 * Nothing turned red because this function had no test: the unit suites call `simulateWholeScene`
 * directly and never persist, and the E2E fixture serves pre-built read models rather than running
 * a slot. So the live path failed at stage 7 for every world, with an error naming the trace
 * rather than the rename. `sceneSimulationPersistence.test.ts` now exercises it with traces taken
 * from a real provider call, one field at a time.
 */
function parseTrace(value: unknown): ProviderTraceMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SceneSimulationError('SCENE_SIMULATION_INVALID', 'trace is required');
  const row = value as Record<string, unknown>;
  const keys = ['provider', 'requestedModel', 'resolvedModel', 'upstreamProvider', 'rateLimit',
    'inputTokens', 'outputTokens', 'latencyMs', 'retryCount'];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some((key) => !keys.includes(key))
      || (row.provider !== 'fake' && row.provider !== 'openai-compatible')
      // The ROUTE that was asked for. Always present and always concrete as a string, even when
      // the string is an alias such as `auto` that names no model at all.
      || typeof row.requestedModel !== 'string' || row.requestedModel.trim().length === 0
      // What actually served it, and who. `null` is honest — ART-148 keeps unattributable usage
      // visible as unattributed rather than booking it against the alias — so it is accepted here
      // and refused only when the KEY is missing, which is a provider that never considered it.
      || !isNullableName(row.resolvedModel) || !isNullableName(row.upstreamProvider)
      || !isRateLimit(row.rateLimit)
      || !['inputTokens', 'outputTokens', 'latencyMs', 'retryCount'].every((key) => isCount(row[key]))) {
    throw new SceneSimulationError('SCENE_SIMULATION_INVALID', 'trace metadata is invalid');
  }
  return row as ProviderTraceMetadata;
}

export const persistValidatedSceneSimulation = internalMutation({
  args: { worldId: v.string(), simulationRunId: v.string(), groupingRunId: v.string(), sceneId: v.string(),
    output: v.any(), attemptCount: v.number(), trace: v.any(), createdAt: v.number() },
  handler: async (ctx, args) => {
    if (args.simulationRunId.trim().length === 0 || !Number.isSafeInteger(args.attemptCount) || args.attemptCount < 1
        || args.attemptCount > 3 || !Number.isFinite(args.createdAt)) {
      throw new SceneSimulationError('SCENE_SIMULATION_INVALID', 'invalid persistence request');
    }
    const prior = await ctx.db.query('sceneSimulationRuns').withIndex('by_world_and_run',
      (q) => q.eq('worldId', args.worldId).eq('simulationRunId', args.simulationRunId)).unique();
    if (prior) {
      if (prior.groupingRunId !== args.groupingRunId || prior.sceneId !== args.sceneId) {
        throw new SceneSimulationError('SCENE_SIMULATION_RUN_CONFLICT', 'Simulation Run ID was reused for another Scene');
      }
      return { result: structuredClone(prior.result) as SceneSimulationResult, deduplicated: true };
    }
    const grouping = await ctx.db.query('groupedSceneRuns').withIndex('by_world_and_run',
      (q) => q.eq('worldId', args.worldId).eq('groupingRunId', args.groupingRunId)).unique();
    const scene = (grouping?.result as SceneGroupingResult | undefined)?.scenes.find(({ sceneId }) => sceneId === args.sceneId);
    if (!scene || scene.worldId !== args.worldId) throw new SceneSimulationError('SCENE_SIMULATION_SCENE_NOT_FOUND', 'persisted Grouped Scene is required');
    const output = parseWholeSceneOutput(args.output, scene);
    const result = finalizeWholeSceneOutput(args.simulationRunId, scene, output, args.attemptCount, parseTrace(args.trace));
    await ctx.db.insert('sceneSimulationRuns', { schemaVersion: 1, worldId: args.worldId,
      simulationRunId: args.simulationRunId, groupingRunId: args.groupingRunId, sceneId: args.sceneId,
      status: result.reviewStatus === 'required' ? 'review_required' : 'validated', result, createdAt: args.createdAt });
    return { result, deduplicated: false };
  },
});

/**
 * ART-149. The already-persisted result for a scene, so a retried slot can skip the provider call
 * that produced it.
 *
 * `simulate_scenes` is ONE orchestration checkpoint covering every scene in the slot, so a failure
 * on scene 3 discards the checkpoint and re-runs scenes 1 and 2 as well. Persistence was already
 * idempotent on `simulationRunId` — but only after the provider had been called and the tokens
 * spent, at which point the freshly generated result was thrown away in favour of the stored one.
 *
 * `groupingRunId` must match: it is the identity of the scene set this result was authored for.
 * A row from a different grouping run is NOT reused — `persistValidatedSceneSimulation` treats
 * that as `SCENE_SIMULATION_RUN_CONFLICT`, and silently reusing it here would bury that conflict
 * instead of surfacing it.
 */
export const findReusableSceneSimulation = internalQuery({
  args: { worldId: v.string(), simulationRunId: v.string(), groupingRunId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('sceneSimulationRuns').withIndex('by_world_and_run',
      (q) => q.eq('worldId', args.worldId).eq('simulationRunId', args.simulationRunId)).unique();
    if (!row || row.groupingRunId !== args.groupingRunId) return null;
    // ART-205: a scene Canon refused is not reusable. Returning it would replay the identical
    // refusal, which is what made a refused slot unrecoverable.
    if (row.canonRejectedAt !== undefined) return null;
    return structuredClone(row.result) as SceneSimulationResult;
  },
});

/** Operations-only validated results. There is deliberately no public query or raw provider-output table. */
export const getSceneSimulationForOperations = internalQuery({
  args: { worldId: v.string(), simulationRunId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('sceneSimulationRuns').withIndex('by_world_and_run',
      (q) => q.eq('worldId', args.worldId).eq('simulationRunId', args.simulationRunId)).unique();
    return row ? structuredClone(row.result) as SceneSimulationResult : null;
  },
});

/**
 * Canon's verdict on a scene's proposals, asked for DURING authoring (ART-205).
 *
 * ## Why this exists at all
 *
 * Canon validation is stage 8, inside the finishing mutation, after the authoring action has
 * returned. A scene whose proposals parsed but violated Canon was therefore persisted, and ART-149
 * reuse replayed the identical stored scene into the identical refusal on every retry — the slot
 * could not recover however many attempts it was given, and no provider call was ever made to try
 * anything different.
 *
 * This is the SAME check, asked earlier, so its refusal can reach the author while another attempt
 * is still possible. Stage 8 remains authoritative and is unchanged: it validates against the
 * projection as it stands when the slot finishes, which is the only moment that can decide a
 * commit. This one runs against the projection as it stands during authoring, and the two agreeing
 * is not assumed — `canonRuleContext` is shared so they at least derive the world the same way.
 *
 * ## What it returns
 *
 * The FIRST refusal only. A model given one specific correction fixes one thing; a list invites it
 * to trade one violation for another, and every entry after the first is speculative anyway because
 * fixing the first can change what follows.
 *
 * Structural validation runs first, for the same reason `normalizeProposedEventOutput` does it
 * first: a malformed event has no meaningful canon verdict.
 */
export const validateSceneProposals = internalQuery({
  args: { worldId: v.string(), proposedEvents: v.array(v.any()) },
  handler: async (ctx, args): Promise<CanonRejectionFeedback | null> => {
    const { projection, ruleContext } = await canonRuleContext(
      createConvexCanonReader(ctx.db), args.worldId);
    for (const [index, candidate] of args.proposedEvents.entries()) {
      const structural = validateEventStructure(candidate);
      if (structural) return canonRejectionFeedback(structural, index);
      const error = validateCanon(candidate as ProposedEvent, projection, ruleContext);
      if (error) return canonRejectionFeedback(error, index);
    }
    return null;
  },
});

/**
 * Mark a stored scene as refused by Canon, so the next attempt re-authors it (ART-205).
 *
 * Called by the finishing pass when stage 8 refuses a proposal, keyed on the scene that produced
 * it. The row is MARKED rather than deleted: it is the evidence of what was authored and refused,
 * and deleting it would leave an operator with a failed slot and nothing to read. It simply stops
 * being reusable.
 *
 * Idempotent — re-marking an already-marked scene rewrites the same two fields.
 */
export const markSceneCanonRejected = internalMutation({
  args: {
    worldId: v.string(),
    sceneId: v.string(),
    code: v.string(),
    now: v.number(),
  },
  returns: v.object({ marked: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.query('sceneSimulationRuns').withIndex('by_scene',
      (q) => q.eq('worldId', args.worldId).eq('sceneId', args.sceneId)).unique();
    if (!row) return { marked: false };
    await ctx.db.patch(row._id, { canonRejectedAt: args.now, canonRejectionCode: args.code });
    return { marked: true };
  },
});
