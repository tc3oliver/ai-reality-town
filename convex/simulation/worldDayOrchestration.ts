export const WORLD_DAY_STAGES = [
  'load_world_state',
  'apply_scheduled_environment_events',
  'load_active_story_arcs',
  'generate_daily_director_plan',
  'generate_character_intents',
  'group_intents_into_scenes',
  'simulate_scenes',
  'validate_structured_output',
  'validate_canon',
  'commit_accepted_events',
] as const;
const WORLD_DAY_TIME_SLOTS = new Set(['morning', 'noon', 'afternoon', 'evening', 'night']);

export type WorldDayStage = (typeof WORLD_DAY_STAGES)[number];
export type WorldDayRunStatus = 'running' | 'failed' | 'completed';
export type CheckpointStatus = 'running' | 'failed' | 'completed';

export type WorldDayRun = {
  runId: string;
  worldId: string;
  worldDay: number;
  timeSlot: string;
  status: WorldDayRunStatus;
  attemptCount: number;
  failureStage?: WorldDayStage;
  errorCode?: string;
  errorMessage?: string;
  committedEventIds?: string[];
};

export type WorldDayCheckpoint = {
  runId: string;
  stage: WorldDayStage;
  attempt: number;
  status: CheckpointStatus;
  artifact?: unknown;
  errorCode?: string;
  errorMessage?: string;
};

export type WorldDayRunInput = Pick<WorldDayRun, 'runId' | 'worldId' | 'worldDay' | 'timeSlot'>;

export interface WorldDayRunStore {
  loadRun(runId: string): Promise<WorldDayRun | null>;
  createRun(input: WorldDayRunInput): Promise<WorldDayRun>;
  listCheckpoints(runId: string): Promise<WorldDayCheckpoint[]>;
  startCheckpoint(runId: string, stage: WorldDayStage, attempt: number): Promise<void>;
  completeCheckpoint(runId: string, stage: WorldDayStage, attempt: number, artifact: unknown): Promise<void>;
  failCheckpoint(runId: string, stage: WorldDayStage, attempt: number, error: RunFailure): Promise<void>;
  resumeRun(runId: string, attempt: number): Promise<void>;
  failRun(runId: string, stage: WorldDayStage, error: RunFailure): Promise<void>;
  completeRun(runId: string, committedEventIds: string[]): Promise<void>;
}

export type StageContext = WorldDayRunInput & {
  artifacts: Readonly<Partial<Record<WorldDayStage, unknown>>>;
};

export type WorldDayStageHandlers = Record<WorldDayStage, (context: StageContext) => Promise<unknown>>;

export type RunFailure = { code: string; message: string };

export class WorldDayOrchestrationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WorldDayOrchestrationError';
  }
}

export function describeWorldDayError(error: unknown): RunFailure {
  if (error && typeof error === 'object' && 'error' in error) {
    const canon = (error as { error?: { code?: unknown; message?: unknown } }).error;
    if (typeof canon?.code === 'string' && typeof canon.message === 'string') return { code: canon.code, message: canon.message };
  }
  if (error instanceof WorldDayOrchestrationError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: 'WORLD_DAY_STAGE_FAILED', message: error.message };
  return { code: 'WORLD_DAY_STAGE_FAILED', message: String(error) };
}

function completedPrefix(checkpoints: WorldDayCheckpoint[]): Partial<Record<WorldDayStage, unknown>> {
  const latest = new Map<WorldDayStage, WorldDayCheckpoint>();
  for (const checkpoint of checkpoints) {
    const prior = latest.get(checkpoint.stage);
    if (!prior || checkpoint.attempt > prior.attempt) latest.set(checkpoint.stage, checkpoint);
  }
  const artifacts: Partial<Record<WorldDayStage, unknown>> = {};
  let gap = false;
  for (const stage of WORLD_DAY_STAGES) {
    const checkpoint = latest.get(stage);
    if (checkpoint?.status === 'completed') {
      if (gap) throw new WorldDayOrchestrationError('CHECKPOINT_ORDER_INVALID', `completed checkpoint ${stage} follows an incomplete stage`);
      artifacts[stage] = checkpoint.artifact;
    } else {
      gap = true;
    }
  }
  return artifacts;
}

function committedIds(artifact: unknown): string[] {
  if (!artifact || typeof artifact !== 'object' || !Array.isArray((artifact as { committedEventIds?: unknown }).committedEventIds)) {
    throw new WorldDayOrchestrationError('COMMIT_RESULT_INVALID', 'commit stage must return committedEventIds');
  }
  const ids = (artifact as { committedEventIds: unknown[] }).committedEventIds;
  if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    throw new WorldDayOrchestrationError('COMMIT_RESULT_INVALID', 'committedEventIds must be unique strings');
  }
  return ids as string[];
}

/** Execute or safely resume PRD Section 12 stages 1-10. */
export async function executeWorldDay(
  input: WorldDayRunInput,
  store: WorldDayRunStore,
  handlers: WorldDayStageHandlers,
): Promise<WorldDayRun> {
  if (input.runId.trim().length === 0 || input.worldId.trim().length === 0
      || !Number.isSafeInteger(input.worldDay) || input.worldDay < 0 || !WORLD_DAY_TIME_SLOTS.has(input.timeSlot)) {
    throw new WorldDayOrchestrationError('RUN_INPUT_INVALID', 'run identity requires non-empty IDs, a non-negative world day, and a valid time slot');
  }
  let run = await store.loadRun(input.runId);
  let attempt: number;
  if (run) {
    if (run.worldId !== input.worldId || run.worldDay !== input.worldDay || run.timeSlot !== input.timeSlot) {
      throw new WorldDayOrchestrationError('RUN_ID_CONFLICT', 'runId already belongs to a different world-day slot');
    }
    if (run.status === 'completed') return run;
    attempt = run.attemptCount + 1;
    await store.resumeRun(input.runId, attempt);
  } else {
    run = await store.createRun(input);
    attempt = run.attemptCount;
  }

  const artifacts = completedPrefix(await store.listCheckpoints(input.runId));
  for (const stage of WORLD_DAY_STAGES) {
    if (Object.prototype.hasOwnProperty.call(artifacts, stage)) continue;
    await store.startCheckpoint(input.runId, stage, attempt);
    try {
      const artifact = await handlers[stage]({ ...input, artifacts });
      if (stage === 'commit_accepted_events') committedIds(artifact);
      await store.completeCheckpoint(input.runId, stage, attempt, artifact);
      artifacts[stage] = artifact;
    } catch (error) {
      const failure = describeWorldDayError(error);
      await store.failCheckpoint(input.runId, stage, attempt, failure);
      await store.failRun(input.runId, stage, failure);
      return (await store.loadRun(input.runId)) as WorldDayRun;
    }
  }
  await store.completeRun(input.runId, committedIds(artifacts.commit_accepted_events));
  return (await store.loadRun(input.runId)) as WorldDayRun;
}
