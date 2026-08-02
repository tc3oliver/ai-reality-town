import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import type { ProviderTraceMetadata } from './provider';
import type { SceneGroupingResult } from './sceneGrouping';
import { finalizeWholeSceneOutput, parseWholeSceneOutput, SceneSimulationError, type SceneSimulationResult } from './sceneSimulation';

function parseTrace(value: unknown): ProviderTraceMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SceneSimulationError('SCENE_SIMULATION_INVALID', 'trace is required');
  const row = value as Record<string, unknown>;
  const keys = ['provider', 'model', 'inputTokens', 'outputTokens', 'latencyMs', 'retryCount'];
  if (Object.keys(row).some((key) => !keys.includes(key)) || (row.provider !== 'fake' && row.provider !== 'openai-compatible')
      || typeof row.model !== 'string' || row.model.trim().length === 0
      || !['inputTokens', 'outputTokens', 'latencyMs', 'retryCount'].every((key) => Number.isSafeInteger(row[key]) && (row[key] as number) >= 0)) {
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

/** Operations-only validated results. There is deliberately no public query or raw provider-output table. */
export const getSceneSimulationForOperations = internalQuery({
  args: { worldId: v.string(), simulationRunId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('sceneSimulationRuns').withIndex('by_world_and_run',
      (q) => q.eq('worldId', args.worldId).eq('simulationRunId', args.simulationRunId)).unique();
    return row ? structuredClone(row.result) as SceneSimulationResult : null;
  },
});
