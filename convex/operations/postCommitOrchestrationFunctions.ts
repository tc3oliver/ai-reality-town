/**
 * Convex persistence for post-commit pipeline runs and their stage checkpoints
 * (PRD §12 stages 11–21, ART-83).
 *
 * The durable operations live in plain `db` helpers so the SAME logic backs both the
 * operator-facing internal mutations below and {@link createConvexPostCommitRunStore},
 * the {@link PostCommitRunStore} adapter the live post-commit executor hands to
 * `executePostCommitPipeline`. This mirrors the world-day run store (ART-23/ART-97)
 * and the adapter idiom in `convex/canon/commit.ts` (`createConvexCanonStore`).
 *
 * Stage handlers (the real projection / cognition / story / editorial / safety /
 * publication / snapshot / trace capabilities) are injected by the caller; this
 * module does not reimplement them (AC#6).
 */

import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel, Doc } from '../_generated/dataModel';
import type { GenericMutationCtx } from 'convex/server';
import type {
  CheckpointStatus,
  PostCommitCheckpoint,
  PostCommitRun,
  PostCommitRunInput,
  PostCommitRunStatus,
  PostCommitRunStore,
  PostCommitStage,
  RunFailure,
} from './postCommitOrchestration';

type MutationDb = GenericMutationCtx<DataModel>['db'];

const stage = v.union(
  v.literal('projection'), v.literal('knowledge'), v.literal('memory'), v.literal('relationship'),
  v.literal('arc'), v.literal('episode'), v.literal('recap'), v.literal('safety'),
  v.literal('publication'), v.literal('snapshot'), v.literal('metrics'),
);
const runStatus = v.union(v.literal('running'), v.literal('failed'), v.literal('completed'));

const runRow = (db: MutationDb, runId: string) =>
  db.query('postCommitRuns').withIndex('by_run_id', (q) => q.eq('runId', runId)).unique();

async function insertRun(db: MutationDb, args: PostCommitRunInput & { now: number }) {
  const prior = await runRow(db, args.runId);
  if (prior) {
    if (prior.sourceEventId !== args.sourceEventId || prior.sourceEventSequenceNumber !== args.sourceEventSequenceNumber
        || prior.worldId !== args.worldId) throw new Error('RUN_ID_CONFLICT');
    return prior._id;
  }
  return db.insert('postCommitRuns', {
    runId: args.runId, worldId: args.worldId, sourceEventId: args.sourceEventId,
    sourceEventSequenceNumber: args.sourceEventSequenceNumber, worldDay: args.worldDay,
    status: 'running', attemptCount: 1, createdAt: args.now, updatedAt: args.now,
  });
}

async function writeCheckpoint(db: MutationDb, args: {
  runId: string; stage: PostCommitStage; attempt: number; status: CheckpointStatus;
  artifact?: unknown; errorCode?: string; errorMessage?: string; now: number;
}) {
  const run = await runRow(db, args.runId);
  if (!run) throw new Error('RUN_NOT_FOUND');
  const prior = await db.query('postCommitCheckpoints').withIndex('by_run_stage_attempt', (q) =>
    q.eq('runId', args.runId).eq('stage', args.stage).eq('attempt', args.attempt)).unique();
  if (!prior) {
    return db.insert('postCommitCheckpoints', {
      runId: args.runId, stage: args.stage, attempt: args.attempt, status: args.status,
      artifact: args.artifact, errorCode: args.errorCode, errorMessage: args.errorMessage,
      createdAt: args.now, updatedAt: args.now,
    });
  }
  if (prior.status !== 'running' || args.status === 'running') throw new Error('CHECKPOINT_TRANSITION_INVALID');
  await db.patch(prior._id, {
    status: args.status, artifact: args.artifact, errorCode: args.errorCode,
    errorMessage: args.errorMessage, updatedAt: args.now,
  });
  return prior._id;
}

async function patchRun(db: MutationDb, args: {
  runId: string; status: PostCommitRunStatus; attemptCount?: number; failureStage?: PostCommitStage;
  errorCode?: string; errorMessage?: string; metricsTraceId?: string; now: number;
}) {
  const run = await runRow(db, args.runId);
  if (!run) throw new Error('RUN_NOT_FOUND');
  if (run.status === 'completed' && args.status !== 'completed') throw new Error('RUN_TERMINAL');
  await db.patch(run._id, {
    status: args.status, attemptCount: args.attemptCount ?? run.attemptCount,
    failureStage: args.failureStage, errorCode: args.errorCode, errorMessage: args.errorMessage,
    metricsTraceId: args.metricsTraceId ?? run.metricsTraceId, updatedAt: args.now,
  });
}

function toRun(row: Doc<'postCommitRuns'>): PostCommitRun {
  return {
    runId: row.runId, worldId: row.worldId, sourceEventId: row.sourceEventId,
    sourceEventSequenceNumber: row.sourceEventSequenceNumber, worldDay: row.worldDay,
    status: row.status, attemptCount: row.attemptCount,
    failureStage: row.failureStage ,
    errorCode: row.errorCode, errorMessage: row.errorMessage, metricsTraceId: row.metricsTraceId,
  };
}

/**
 * Adapt Convex `db` to the {@link PostCommitRunStore} interface so the pure, resumable
 * orchestrator in `postCommitOrchestration.ts` can persist runs and checkpoints durably.
 * `now` is captured once per pipeline execution so checkpoint timestamps stay deterministic
 * within one transaction.
 */
export function createConvexPostCommitRunStore(db: MutationDb, now: number): PostCommitRunStore {
  const requireRun = async (runId: string): Promise<PostCommitRun> => {
    const row = await runRow(db, runId);
    if (!row) throw new Error('RUN_NOT_FOUND');
    return toRun(row);
  };
  return {
    async loadRun(runId) {
      const row = await runRow(db, runId);
      return row ? toRun(row) : null;
    },
    async createRun(input) {
      await insertRun(db, { ...input, now });
      return requireRun(input.runId);
    },
    async listCheckpoints(runId) {
      const rows = await db.query('postCommitCheckpoints')
        .withIndex('by_run_and_stage', (q) => q.eq('runId', runId)).collect();
      return rows.map((row): PostCommitCheckpoint => ({
        runId: row.runId, stage: row.stage , attempt: row.attempt,
        status: row.status, artifact: row.artifact,
        errorCode: row.errorCode, errorMessage: row.errorMessage,
      }));
    },
    async startCheckpoint(runId, checkpointStage, attempt) {
      await writeCheckpoint(db, { runId, stage: checkpointStage, attempt, status: 'running', now });
    },
    async completeCheckpoint(runId, checkpointStage, attempt, value) {
      await writeCheckpoint(db, { runId, stage: checkpointStage, attempt, status: 'completed', artifact: value, now });
    },
    async failCheckpoint(runId, checkpointStage, attempt, error) {
      await writeCheckpoint(db, {
        runId, stage: checkpointStage, attempt, status: 'failed',
        errorCode: error.code, errorMessage: error.message, now,
      });
    },
    async resumeRun(runId, attempt) {
      await patchRun(db, { runId, status: 'running', attemptCount: attempt, now });
    },
    async failRun(runId, failureStage, error: RunFailure) {
      await patchRun(db, {
        runId, status: 'failed', failureStage, errorCode: error.code, errorMessage: error.message, now,
      });
    },
    async completeRun(runId, metricsTraceId) {
      await patchRun(db, { runId, status: 'completed', metricsTraceId, now });
    },
  };
}

export const createPostCommitRun = internalMutation({
  args: {
    runId: v.string(), worldId: v.string(), sourceEventId: v.string(),
    sourceEventSequenceNumber: v.number(), worldDay: v.number(), now: v.number(),
  },
  handler: (ctx, args) => insertRun(ctx.db, args),
});

export const recordPostCommitCheckpoint = internalMutation({
  args: {
    runId: v.string(), stage, attempt: v.number(), status: runStatus,
    artifact: v.optional(v.any()), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()), now: v.number(),
  },
  handler: (ctx, args) => writeCheckpoint(ctx.db, args),
});

export const updatePostCommitRun = internalMutation({
  args: {
    runId: v.string(), status: runStatus,
    attemptCount: v.optional(v.number()), failureStage: v.optional(stage),
    errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()),
    metricsTraceId: v.optional(v.string()), now: v.number(),
  },
  handler: (ctx, args) => patchRun(ctx.db, args),
});

export const inspectPostCommitRun = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => ({
    run: await ctx.db.query('postCommitRuns').withIndex('by_run_id', (q) => q.eq('runId', runId)).unique(),
    checkpoints: await ctx.db.query('postCommitCheckpoints').withIndex('by_run_and_stage', (q) => q.eq('runId', runId)).collect(),
  }),
});
