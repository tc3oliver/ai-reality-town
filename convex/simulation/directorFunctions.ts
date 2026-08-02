import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { DirectorPlanError, parseAndValidateDirectorPlan, parseDirectorPlanContext } from './director';

export const persistDirectorPlan = internalMutation({
  args: { context: v.any(), plan: v.any(), createdAt: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.createdAt)) throw new DirectorPlanError('DIRECTOR_INVALID_SHAPE', 'finite creation time required');
    const context = parseDirectorPlanContext(args.context);
    const plan = parseAndValidateDirectorPlan(args.plan, context);
    const prior = await ctx.db.query('directorPlans')
      .withIndex('by_world_and_run', (q) => q.eq('worldId', context.worldId).eq('directorRunId', context.directorRunId)).unique();
    if (prior) {
      if (JSON.stringify(prior.plan) !== JSON.stringify(plan) || JSON.stringify(prior.context) !== JSON.stringify(context)) {
        throw new DirectorPlanError('DIRECTOR_RUN_CONFLICT', 'Director Run ID was already used for different input');
      }
      return { directorRunId: context.directorRunId, deduplicated: true, sceneCount: plan.scenes.length };
    }
    await ctx.db.insert('directorPlans', {
      schemaVersion: 1, worldId: context.worldId, directorRunId: context.directorRunId,
      worldDay: context.worldDay, timeSlot: context.timeSlot, context, plan, createdAt: args.createdAt,
    });
    return { directorRunId: context.directorRunId, deduplicated: false, sceneCount: plan.scenes.length };
  },
});

export const getDirectorPlan = internalQuery({
  args: { worldId: v.string(), directorRunId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('directorPlans')
      .withIndex('by_world_and_run', (q) => q.eq('worldId', args.worldId).eq('directorRunId', args.directorRunId)).unique();
    if (!row) return null;
    const context = parseDirectorPlanContext(row.context);
    return { context, plan: parseAndValidateDirectorPlan(row.plan, context) };
  },
});
