/**
 * Convex wiring for the post-commit pipeline durable store (PRD §12 stages 11–21,
 * ART-83). Provides idempotent run creation, checkpoint recording, run updates,
 * and inspection — the durable substrate the pure orchestrator
 * ({@link ./postCommitOrchestration.ts}) runs over. Mirrors the world-day run
 * store (ART-23). Stage handlers (the real projection/cognition/story/editorial/
 * safety/publication/snapshot/trace capabilities) are injected by the caller;
 * this module does not reimplement them (AC#6).
 */

import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';

const stage = v.union(
  v.literal('projection'), v.literal('knowledge'), v.literal('memory'), v.literal('relationship'),
  v.literal('arc'), v.literal('episode'), v.literal('recap'), v.literal('safety'),
  v.literal('publication'), v.literal('snapshot'), v.literal('metrics'),
);

export const createPostCommitRun = internalMutation({
  args: {
    runId: v.string(), worldId: v.string(), sourceEventId: v.string(),
    sourceEventSequenceNumber: v.number(), worldDay: v.number(), now: v.number(),
  },
  handler: async (ctx, args) => {
    const prior = await ctx.db.query('postCommitRuns').withIndex('by_run_id', (q) => q.eq('runId', args.runId)).unique();
    if (prior) {
      if (prior.sourceEventId !== args.sourceEventId || prior.sourceEventSequenceNumber !== args.sourceEventSequenceNumber
          || prior.worldId !== args.worldId) throw new Error('RUN_ID_CONFLICT');
      return prior._id;
    }
    return ctx.db.insert('postCommitRuns', {
      runId: args.runId, worldId: args.worldId, sourceEventId: args.sourceEventId,
      sourceEventSequenceNumber: args.sourceEventSequenceNumber, worldDay: args.worldDay,
      status: 'running', attemptCount: 1, createdAt: args.now, updatedAt: args.now,
    });
  },
});

export const recordPostCommitCheckpoint = internalMutation({
  args: {
    runId: v.string(), stage, attempt: v.number(),
    status: v.union(v.literal('running'), v.literal('failed'), v.literal('completed')),
    artifact: v.optional(v.any()), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()), now: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.query('postCommitRuns').withIndex('by_run_id', (q) => q.eq('runId', args.runId)).unique();
    if (!run) throw new Error('RUN_NOT_FOUND');
    const prior = await ctx.db.query('postCommitCheckpoints').withIndex('by_run_stage_attempt', (q) =>
      q.eq('runId', args.runId).eq('stage', args.stage).eq('attempt', args.attempt)).unique();
    if (!prior) return ctx.db.insert('postCommitCheckpoints', {
      runId: args.runId, stage: args.stage, attempt: args.attempt, status: args.status,
      artifact: args.artifact as unknown, errorCode: args.errorCode, errorMessage: args.errorMessage,
      createdAt: args.now, updatedAt: args.now,
    });
    if (prior.status !== 'running' || args.status === 'running') throw new Error('CHECKPOINT_TRANSITION_INVALID');
    await ctx.db.patch(prior._id, {
      status: args.status, artifact: args.artifact as unknown, errorCode: args.errorCode, errorMessage: args.errorMessage, updatedAt: args.now,
    });
    return prior._id;
  },
});

export const updatePostCommitRun = internalMutation({
  args: {
    runId: v.string(), status: v.union(v.literal('running'), v.literal('failed'), v.literal('completed')),
    attemptCount: v.optional(v.number()), failureStage: v.optional(stage),
    errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()),
    metricsTraceId: v.optional(v.string()), now: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.query('postCommitRuns').withIndex('by_run_id', (q) => q.eq('runId', args.runId)).unique();
    if (!run) throw new Error('RUN_NOT_FOUND');
    if (run.status === 'completed' && args.status !== 'completed') throw new Error('RUN_TERMINAL');
    await ctx.db.patch(run._id, {
      status: args.status, attemptCount: args.attemptCount ?? run.attemptCount,
      failureStage: args.failureStage, errorCode: args.errorCode, errorMessage: args.errorMessage,
      metricsTraceId: args.metricsTraceId, updatedAt: args.now,
    });
  },
});

export const inspectPostCommitRun = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => ({
    run: await ctx.db.query('postCommitRuns').withIndex('by_run_id', (q) => q.eq('runId', runId)).unique(),
    checkpoints: await ctx.db.query('postCommitCheckpoints').withIndex('by_run_and_stage', (q) => q.eq('runId', runId)).collect(),
  }),
});
