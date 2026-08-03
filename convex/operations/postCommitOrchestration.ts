/**
 * Post-commit cognition + editorial pipeline orchestration (PRD §12 stages 11–21).
 *
 * Mirrors the world-day orchestrator (ART-23): a pure, resumable stage sequencer
 * over an injectable {@link PostCommitRunStore}. The orchestrator DOES NOT
 * reimplement any capability — each stage is an injected handler that invokes
 * the completed projection / cognition / story / editorial / safety /
 * publication / snapshot / trace capability in PRD order (AC#6). It only
 * sequences stages, records durable checkpoints, and isolates failures.
 *
 * Pure module — no Convex imports, no clock, no randomness. Accepted Canon
 * events are never read or written here; a downstream-stage failure can never
 * delete or edit them (AC#2). Public content stays at the last valid published
 * version until the publication stage publishes a replacement — the LKG contract
 * lives in the publication capability, not here (AC#3).
 */

export const POST_COMMIT_STAGES = [
  'projection', 'knowledge', 'memory', 'relationship', 'arc', 'episode',
  'recap', 'safety', 'publication', 'snapshot', 'metrics',
] as const;

export type PostCommitStage = (typeof POST_COMMIT_STAGES)[number];
export type PostCommitRunStatus = 'running' | 'failed' | 'completed';
export type CheckpointStatus = 'running' | 'failed' | 'completed';

export type PostCommitRunInput = {
  runId: string;
  worldId: string;
  /** The accepted-event commit that triggered this post-commit run. */
  sourceEventId: string;
  sourceEventSequenceNumber: number;
  worldDay: number;
};

export type StageMetricsEntry = { stage: PostCommitStage; status: CheckpointStatus; durationMs: number };

/** Durable metrics hook (AC#5), linked to the ART-57 trace for this run. */
export type PostCommitMetricsHook = {
  schemaVersion: 1;
  runId: string;
  worldId: string;
  traceId: string;
  sourceEventId: string;
  stages: StageMetricsEntry[];
  recordedAt: number;
};

export type PostCommitRun = PostCommitRunInput & {
  status: PostCommitRunStatus;
  attemptCount: number;
  failureStage?: PostCommitStage;
  errorCode?: string;
  errorMessage?: string;
  metricsTraceId?: string;
};

export type PostCommitCheckpoint = {
  runId: string;
  stage: PostCommitStage;
  attempt: number;
  status: CheckpointStatus;
  artifact?: unknown;
  errorCode?: string;
  errorMessage?: string;
};

export type StageContext = PostCommitRunInput & {
  artifacts: Readonly<Partial<Record<PostCommitStage, unknown>>>;
  /** ART-57 trace id for this run; the metrics stage links its hook to it (AC#5). */
  traceId: string;
};

export type PostCommitStageHandlers = Record<PostCommitStage, (context: StageContext) => Promise<unknown>>;

export type RunFailure = { code: string; message: string };

export class PostCommitOrchestrationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PostCommitOrchestrationError';
  }
}

export interface PostCommitRunStore {
  loadRun(runId: string): Promise<PostCommitRun | null>;
  createRun(input: PostCommitRunInput): Promise<PostCommitRun>;
  listCheckpoints(runId: string): Promise<PostCommitCheckpoint[]>;
  startCheckpoint(runId: string, stage: PostCommitStage, attempt: number): Promise<void>;
  completeCheckpoint(runId: string, stage: PostCommitStage, attempt: number, artifact: unknown): Promise<void>;
  failCheckpoint(runId: string, stage: PostCommitStage, attempt: number, error: RunFailure): Promise<void>;
  resumeRun(runId: string, attempt: number): Promise<void>;
  failRun(runId: string, stage: PostCommitStage, error: RunFailure): Promise<void>;
  completeRun(runId: string, metricsTraceId: string): Promise<void>;
}

export function describePostCommitError(error: unknown): RunFailure {
  if (error instanceof PostCommitOrchestrationError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: 'POST_COMMIT_STAGE_FAILED', message: error.message };
  return { code: 'POST_COMMIT_STAGE_FAILED', message: String(error) };
}

function completedPrefix(checkpoints: PostCommitCheckpoint[]): Partial<Record<PostCommitStage, unknown>> {
  const latest = new Map<PostCommitStage, PostCommitCheckpoint>();
  for (const checkpoint of checkpoints) {
    const prior = latest.get(checkpoint.stage);
    if (!prior || checkpoint.attempt > prior.attempt) latest.set(checkpoint.stage, checkpoint);
  }
  const artifacts: Partial<Record<PostCommitStage, unknown>> = {};
  let gap = false;
  for (const stage of POST_COMMIT_STAGES) {
    const checkpoint = latest.get(stage);
    if (checkpoint?.status === 'completed') {
      if (gap) throw new PostCommitOrchestrationError('CHECKPOINT_ORDER_INVALID', `completed checkpoint ${stage} follows an incomplete stage`);
      artifacts[stage] = checkpoint.artifact;
    } else {
      gap = true;
    }
  }
  return artifacts;
}

/**
 * Execute or safely resume PRD §12 stages 11–21. Each stage has durable status
 * and a safe retry boundary (AC#1). Accepted events are never touched, so they
 * remain durable when any downstream stage fails (AC#2). Retry resumes from the
 * last completed stage without re-running completed stages, so events/memories
 * are not duplicated (AC#4). The metrics stage records a durable hook linked to
 * the ART-57 trace (AC#5).
 */
export async function executePostCommitPipeline(
  input: PostCommitRunInput,
  store: PostCommitRunStore,
  handlers: PostCommitStageHandlers,
  traceId: string,
): Promise<PostCommitRun> {
  if (input.runId.trim().length === 0 || input.worldId.trim().length === 0
      || input.sourceEventId.trim().length === 0
      || !Number.isSafeInteger(input.sourceEventSequenceNumber) || input.sourceEventSequenceNumber < 0
      || !Number.isSafeInteger(input.worldDay) || input.worldDay < 0) {
    throw new PostCommitOrchestrationError('RUN_INPUT_INVALID', 'run identity requires non-empty IDs and non-negative integers');
  }
  let run = await store.loadRun(input.runId);
  let attempt: number;
  if (run) {
    if (run.worldId !== input.worldId || run.sourceEventId !== input.sourceEventId
        || run.sourceEventSequenceNumber !== input.sourceEventSequenceNumber) {
      throw new PostCommitOrchestrationError('RUN_ID_CONFLICT', 'runId already belongs to a different commit');
    }
    if (run.status === 'completed') return run;
    attempt = run.attemptCount + 1;
    await store.resumeRun(input.runId, attempt);
  } else {
    run = await store.createRun(input);
    attempt = run.attemptCount;
  }

  const artifacts = completedPrefix(await store.listCheckpoints(input.runId));
  for (const stage of POST_COMMIT_STAGES) {
    if (Object.prototype.hasOwnProperty.call(artifacts, stage)) continue;
    await store.startCheckpoint(input.runId, stage, attempt);
    try {
      const artifact = await handlers[stage]({ ...input, artifacts, traceId });
      await store.completeCheckpoint(input.runId, stage, attempt, artifact);
      artifacts[stage] = artifact;
    } catch (error) {
      const failure = describePostCommitError(error);
      await store.failCheckpoint(input.runId, stage, attempt, failure);
      await store.failRun(input.runId, stage, failure);
      return (await store.loadRun(input.runId)) as PostCommitRun;
    }
  }

  // AC#5: the metrics stage handler produces the durable metrics hook linked to
  // the ART-57 trace; completeRun records its trace id.
  const metrics = artifacts.metrics as PostCommitMetricsHook | undefined;
  await store.completeRun(input.runId, metrics?.traceId ?? traceId);
  return (await store.loadRun(input.runId)) as PostCommitRun;
}
