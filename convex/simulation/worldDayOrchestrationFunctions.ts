/**
 * Convex persistence for world-day runs and their stage checkpoints.
 *
 * The durable operations live in plain `db` helpers so the SAME logic backs both the
 * operator-facing internal mutations below and {@link createConvexWorldDayRunStore}, the
 * {@link WorldDayRunStore} adapter the live slot executor hands to `executeWorldDay`.
 * This mirrors the adapter idiom in `convex/canon/commit.ts` (`createConvexCanonStore`).
 */

import { internalMutation, internalQuery } from '../_generated/server';
import type { DataModel, Doc } from '../_generated/dataModel';
import type { GenericMutationCtx } from 'convex/server';
import { v } from 'convex/values';
import type {
  RunFailure,
  WorldDayCheckpoint,
  WorldDayRun,
  WorldDayRunInput,
  WorldDayRunStatus,
  WorldDayRunStore,
  WorldDayStage,
} from './worldDayOrchestration';

type MutationDb = GenericMutationCtx<DataModel>['db'];
type CheckpointStatus = 'running' | 'failed' | 'completed';

const stage = v.union(
  v.literal('load_world_state'), v.literal('apply_scheduled_environment_events'),
  v.literal('load_active_story_arcs'), v.literal('generate_daily_director_plan'),
  v.literal('generate_character_intents'), v.literal('group_intents_into_scenes'),
  v.literal('simulate_scenes'), v.literal('validate_structured_output'),
  v.literal('validate_canon'), v.literal('commit_accepted_events'),
);
const timeSlot = v.union(v.literal('morning'), v.literal('noon'), v.literal('afternoon'), v.literal('evening'), v.literal('night'));
const runStatus = v.union(v.literal('running'), v.literal('failed'), v.literal('completed'));

const runRow = (db: MutationDb, runId: string) =>
  db.query('worldDayRuns').withIndex('by_run_id', (q) => q.eq('runId', runId)).unique();

async function insertRun(db: MutationDb, args: WorldDayRunInput & { timeSlot: Doc<'worldDayRuns'>['timeSlot']; now: number }) {
  const prior = await runRow(db, args.runId);
  if (prior) {
    if (prior.worldId !== args.worldId || prior.worldDay !== args.worldDay || prior.timeSlot !== args.timeSlot) {
      throw new Error('RUN_ID_CONFLICT');
    }
    return prior._id;
  }
  return db.insert('worldDayRuns', {
    runId: args.runId, worldId: args.worldId, worldDay: args.worldDay, timeSlot: args.timeSlot,
    status: 'running', attemptCount: 1, createdAt: args.now, updatedAt: args.now,
  });
}

async function writeCheckpoint(db: MutationDb, args: {
  runId: string; stage: WorldDayStage; attempt: number; status: CheckpointStatus;
  artifact?: unknown; errorCode?: string; errorMessage?: string; now: number;
}) {
  const run = await runRow(db, args.runId);
  if (!run) throw new Error('RUN_NOT_FOUND');
  const prior = await db.query('worldDayCheckpoints').withIndex('by_run_stage_attempt', (q) =>
    q.eq('runId', args.runId).eq('stage', args.stage).eq('attempt', args.attempt)).unique();
  if (!prior) {
    return db.insert('worldDayCheckpoints', {
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
  runId: string; status: WorldDayRunStatus; attemptCount?: number; failureStage?: WorldDayStage;
  errorCode?: string; errorMessage?: string; committedEventIds?: string[]; now: number;
}) {
  const run = await runRow(db, args.runId);
  if (!run) throw new Error('RUN_NOT_FOUND');
  if (run.status === 'completed' && args.status !== 'completed') throw new Error('RUN_TERMINAL');
  await db.patch(run._id, {
    status: args.status, attemptCount: args.attemptCount ?? run.attemptCount,
    failureStage: args.failureStage, errorCode: args.errorCode, errorMessage: args.errorMessage,
    committedEventIds: args.committedEventIds ?? run.committedEventIds, updatedAt: args.now,
  });
}

function toRun(row: Doc<'worldDayRuns'>): WorldDayRun {
  return {
    runId: row.runId, worldId: row.worldId, worldDay: row.worldDay, timeSlot: row.timeSlot,
    status: row.status, attemptCount: row.attemptCount,
    failureStage: row.failureStage as WorldDayStage | undefined,
    errorCode: row.errorCode, errorMessage: row.errorMessage, committedEventIds: row.committedEventIds,
  };
}

/**
 * Adapt Convex `db` to the {@link WorldDayRunStore} interface so the pure, resumable
 * orchestrator in `worldDayOrchestration.ts` can persist runs and checkpoints durably.
 * `now` is captured once per slot execution so checkpoint timestamps stay deterministic
 * within one transaction.
 */
export function createConvexWorldDayRunStore(db: MutationDb, now: number): WorldDayRunStore {
  const requireRun = async (runId: string): Promise<WorldDayRun> => {
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
      await insertRun(db, { ...input, timeSlot: input.timeSlot as Doc<'worldDayRuns'>['timeSlot'], now });
      return requireRun(input.runId);
    },
    async listCheckpoints(runId) {
      const rows = await db.query('worldDayCheckpoints')
        .withIndex('by_run_and_stage', (q) => q.eq('runId', runId)).collect();
      return rows.map((row): WorldDayCheckpoint => ({
        runId: row.runId, stage: row.stage as WorldDayStage, attempt: row.attempt,
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
    async completeRun(runId, committedEventIds) {
      await patchRun(db, { runId, status: 'completed', committedEventIds, now });
    },
  };
}

export const createRun = internalMutation({
  args: { runId: v.string(), worldId: v.string(), worldDay: v.number(), timeSlot, now: v.number() },
  handler: (ctx, args) => insertRun(ctx.db, args),
});

export const recordCheckpoint = internalMutation({
  args: { runId: v.string(), stage, attempt: v.number(), status: runStatus,
    artifact: v.optional(v.any()), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()), now: v.number() },
  handler: (ctx, args) => writeCheckpoint(ctx.db, args),
});

export const updateRun = internalMutation({
  args: { runId: v.string(), status: runStatus,
    attemptCount: v.optional(v.number()), failureStage: v.optional(stage), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()),
    committedEventIds: v.optional(v.array(v.string())), now: v.number() },
  handler: (ctx, args) => patchRun(ctx.db, args),
});

export const inspectRun = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => ({
    run: await ctx.db.query('worldDayRuns').withIndex('by_run_id', (q) => q.eq('runId', runId)).unique(),
    checkpoints: await ctx.db.query('worldDayCheckpoints').withIndex('by_run_and_stage', (q) => q.eq('runId', runId)).collect(),
  }),
});
