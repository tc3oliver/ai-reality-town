import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { isTimeSlot } from '../canon/eventTypes';
import { parseCharacterIntentContext, validateCharacterIntent } from './characterIntent';
import { SceneGroupingError, groupCharacterIntents, type SceneGroupingInput, type SceneGroupingResult } from './sceneGrouping';

export const groupPersistedCharacterIntents = internalMutation({
  args: { worldId: v.string(), groupingRunId: v.string(), directorRunId: v.string(), worldDay: v.number(), timeSlot: v.string(), intentRunIds: v.array(v.string()), createdAt: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.createdAt) || !isTimeSlot(args.timeSlot) || new Set(args.intentRunIds).size !== args.intentRunIds.length) {
      throw new SceneGroupingError('SCENE_GROUPING_INVALID', 'finite creation time, valid slot, and unique Intent Runs are required');
    }
    const prior = await ctx.db.query('groupedSceneRuns').withIndex('by_world_and_run', (q) => q.eq('worldId', args.worldId).eq('groupingRunId', args.groupingRunId)).unique();
    if (prior) {
      if (prior.directorRunId !== args.directorRunId || prior.worldDay !== args.worldDay || prior.timeSlot !== args.timeSlot
          || JSON.stringify(prior.intentRunIds) !== JSON.stringify(args.intentRunIds)) throw new SceneGroupingError('SCENE_GROUPING_RUN_CONFLICT', 'Grouping Run ID was reused');
      return { result: structuredClone(prior.result) as SceneGroupingResult, deduplicated: true };
    }
    const director = await ctx.db.query('directorPlans').withIndex('by_world_and_run', (q) => q.eq('worldId', args.worldId).eq('directorRunId', args.directorRunId)).unique();
    if (!director || director.worldDay !== args.worldDay || director.timeSlot !== args.timeSlot) throw new SceneGroupingError('SCENE_GROUPING_RUN_CONFLICT', 'Director Plan slot does not match');
    const intents = [];
    for (const intentRunId of args.intentRunIds) {
      const row = await ctx.db.query('characterIntents').withIndex('by_world_and_run', (q) => q.eq('worldId', args.worldId).eq('intentRunId', intentRunId)).unique();
      if (!row || row.directorRunId !== args.directorRunId) throw new SceneGroupingError('SCENE_GROUPING_INTENT_NOT_FOUND', 'every source Intent must be persisted for the Director Run');
      const context = parseCharacterIntentContext(row.context);
      if (context.worldId !== args.worldId || context.worldDay !== args.worldDay || context.timeSlot !== args.timeSlot
          || context.directorRunId !== args.directorRunId) {
        throw new SceneGroupingError('SCENE_GROUPING_RUN_CONFLICT', 'source Intent context belongs to another world slot');
      }
      intents.push(validateCharacterIntent(row.intent, context));
    }
    const input: SceneGroupingInput = { schemaVersion: 1, groupingRunId: args.groupingRunId, directorRunId: args.directorRunId,
      worldId: args.worldId, worldDay: args.worldDay, timeSlot: args.timeSlot, intents };
    const result = groupCharacterIntents(input);
    await ctx.db.insert('groupedSceneRuns', { schemaVersion: 1, worldId: args.worldId, groupingRunId: args.groupingRunId,
      directorRunId: args.directorRunId, worldDay: args.worldDay, timeSlot: args.timeSlot,
      intentRunIds: [...args.intentRunIds], result, createdAt: args.createdAt });
    return { result, deduplicated: false };
  },
});

export const getGroupedScenesForDirectorRun = internalQuery({
  args: { worldId: v.string(), directorRunId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('groupedSceneRuns').withIndex('by_director_run', (q) => q.eq('worldId', args.worldId).eq('directorRunId', args.directorRunId)).collect();
    return rows.map((row) => structuredClone(row.result) as SceneGroupingResult);
  },
});
