import { internalMutation, internalQuery } from '../_generated/server';
import { v } from 'convex/values';

const stage = v.union(
  v.literal('load_world_state'), v.literal('apply_scheduled_environment_events'),
  v.literal('load_active_story_arcs'), v.literal('generate_daily_director_plan'),
  v.literal('generate_character_intents'), v.literal('group_intents_into_scenes'),
  v.literal('simulate_scenes'), v.literal('validate_structured_output'),
  v.literal('validate_canon'), v.literal('commit_accepted_events'),
);
const timeSlot = v.union(v.literal('morning'), v.literal('noon'), v.literal('afternoon'), v.literal('evening'), v.literal('night'));

export const createRun = internalMutation({
  args: { runId: v.string(), worldId: v.string(), worldDay: v.number(), timeSlot, now: v.number() },
  handler: async (ctx, args) => {
    const prior = await ctx.db.query('worldDayRuns').withIndex('by_run_id', (q) => q.eq('runId', args.runId)).unique();
    if (prior) {
      if (prior.worldId !== args.worldId || prior.worldDay !== args.worldDay || prior.timeSlot !== args.timeSlot) throw new Error('RUN_ID_CONFLICT');
      return prior._id;
    }
    return ctx.db.insert('worldDayRuns', { runId: args.runId, worldId: args.worldId, worldDay: args.worldDay,
      timeSlot: args.timeSlot, status: 'running', attemptCount: 1, createdAt: args.now, updatedAt: args.now });
  },
});

export const recordCheckpoint = internalMutation({
  args: { runId: v.string(), stage, attempt: v.number(), status: v.union(v.literal('running'), v.literal('failed'), v.literal('completed')),
    artifact: v.optional(v.any()), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()), now: v.number() },
  handler: async (ctx, args) => {
    const run = await ctx.db.query('worldDayRuns').withIndex('by_run_id', (q) => q.eq('runId', args.runId)).unique();
    if (!run) throw new Error('RUN_NOT_FOUND');
    const prior = await ctx.db.query('worldDayCheckpoints').withIndex('by_run_stage_attempt', (q) =>
      q.eq('runId', args.runId).eq('stage', args.stage).eq('attempt', args.attempt)).unique();
    if (!prior) return ctx.db.insert('worldDayCheckpoints', { runId: args.runId, stage: args.stage, attempt: args.attempt,
      status: args.status, artifact: args.artifact as unknown, errorCode: args.errorCode, errorMessage: args.errorMessage,
      createdAt: args.now, updatedAt: args.now });
    if (prior.status !== 'running' || args.status === 'running') throw new Error('CHECKPOINT_TRANSITION_INVALID');
    await ctx.db.patch(prior._id, { status: args.status, artifact: args.artifact as unknown, errorCode: args.errorCode, errorMessage: args.errorMessage, updatedAt: args.now });
    return prior._id;
  },
});

export const updateRun = internalMutation({
  args: { runId: v.string(), status: v.union(v.literal('running'), v.literal('failed'), v.literal('completed')),
    attemptCount: v.optional(v.number()), failureStage: v.optional(stage), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()),
    committedEventIds: v.optional(v.array(v.string())), now: v.number() },
  handler: async (ctx, args) => {
    const run = await ctx.db.query('worldDayRuns').withIndex('by_run_id', (q) => q.eq('runId', args.runId)).unique();
    if (!run) throw new Error('RUN_NOT_FOUND');
    if (run.status === 'completed' && args.status !== 'completed') throw new Error('RUN_TERMINAL');
    await ctx.db.patch(run._id, { status: args.status, attemptCount: args.attemptCount ?? run.attemptCount,
      failureStage: args.failureStage, errorCode: args.errorCode, errorMessage: args.errorMessage,
      committedEventIds: args.committedEventIds, updatedAt: args.now });
  },
});

export const inspectRun = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => ({
    run: await ctx.db.query('worldDayRuns').withIndex('by_run_id', (q) => q.eq('runId', runId)).unique(),
    checkpoints: await ctx.db.query('worldDayCheckpoints').withIndex('by_run_and_stage', (q) => q.eq('runId', runId)).collect(),
  }),
});
