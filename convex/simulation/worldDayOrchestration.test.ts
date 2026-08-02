import {
  executeWorldDay,
  WORLD_DAY_STAGES,
  WorldDayOrchestrationError,
  type RunFailure,
  type WorldDayCheckpoint,
  type WorldDayRun,
  type WorldDayRunInput,
  type WorldDayRunStore,
  type WorldDayStage,
  type WorldDayStageHandlers,
} from './worldDayOrchestration';

class MemoryRunStore implements WorldDayRunStore {
  run: WorldDayRun | null = null;
  checkpoints: WorldDayCheckpoint[] = [];

  loadRun(): Promise<WorldDayRun | null> { return Promise.resolve(this.run && structuredClone(this.run)); }
  createRun(input: WorldDayRunInput): Promise<WorldDayRun> {
    this.run = { ...input, status: 'running', attemptCount: 1 };
    return Promise.resolve(structuredClone(this.run));
  }
  listCheckpoints(): Promise<WorldDayCheckpoint[]> { return Promise.resolve(structuredClone(this.checkpoints)); }
  startCheckpoint(runId: string, stage: WorldDayStage, attempt: number): Promise<void> {
    this.checkpoints.push({ runId, stage, attempt, status: 'running' }); return Promise.resolve();
  }
  completeCheckpoint(runId: string, stage: WorldDayStage, attempt: number, artifact: unknown): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'completed', artifact: structuredClone(artifact) }); return Promise.resolve();
  }
  failCheckpoint(runId: string, stage: WorldDayStage, attempt: number, error: RunFailure): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'failed', errorCode: error.code, errorMessage: error.message }); return Promise.resolve();
  }
  resumeRun(_runId: string, attempt: number): Promise<void> {
    Object.assign(this.requiredRun(), { status: 'running', attemptCount: attempt, failureStage: undefined, errorCode: undefined, errorMessage: undefined }); return Promise.resolve();
  }
  failRun(_runId: string, stage: WorldDayStage, error: RunFailure): Promise<void> {
    Object.assign(this.requiredRun(), { status: 'failed', failureStage: stage, errorCode: error.code, errorMessage: error.message }); return Promise.resolve();
  }
  completeRun(_runId: string, committedEventIds: string[]): Promise<void> {
    Object.assign(this.requiredRun(), { status: 'completed', committedEventIds }); return Promise.resolve();
  }
  private requiredRun(): WorldDayRun { if (!this.run) throw new Error('missing run'); return this.run; }
  private find(runId: string, stage: WorldDayStage, attempt: number): WorldDayCheckpoint {
    const row = this.checkpoints.find((candidate) => candidate.runId === runId && candidate.stage === stage && candidate.attempt === attempt);
    if (!row) throw new Error('missing checkpoint'); return row;
  }
}

const input: WorldDayRunInput = { runId: 'run:w:4:noon', worldId: 'w', worldDay: 4, timeSlot: 'noon' };

function handlers(calls: WorldDayStage[], fail?: WorldDayStage, commitIds = ['event:w:1']): WorldDayStageHandlers {
  return Object.fromEntries(WORLD_DAY_STAGES.map((stage) => [stage, ({ artifacts }: { artifacts: Partial<Record<WorldDayStage, unknown>> }) => {
    calls.push(stage);
    const priorCount = Object.keys(artifacts).length;
    if (priorCount !== WORLD_DAY_STAGES.indexOf(stage)) throw new Error('stages did not execute in order');
    if (stage === fail) throw new WorldDayOrchestrationError(`INJECTED_${stage.toUpperCase()}`, `failed ${stage}`);
    return Promise.resolve(stage === 'commit_accepted_events' ? { committedEventIds: commitIds } : { stage });
  }])) as unknown as WorldDayStageHandlers;
}

describe('world-day orchestration stages 1-10', () => {
  it('persists every stage in exact order and completes with committed event references', async () => {
    const store = new MemoryRunStore(); const calls: WorldDayStage[] = [];
    const result = await executeWorldDay(input, store, handlers(calls));
    expect(result).toMatchObject({ status: 'completed', attemptCount: 1, committedEventIds: ['event:w:1'] });
    expect(calls).toEqual(WORLD_DAY_STAGES);
    expect(store.checkpoints.map(({ stage, status, attempt }) => ({ stage, status, attempt })))
      .toEqual(WORLD_DAY_STAGES.map((stage) => ({ stage, status: 'completed', attempt: 1 })));
  });

  it.each(WORLD_DAY_STAGES.slice(0, 9))('records exact stable failure at %s without reaching commit', async (failedStage) => {
    const store = new MemoryRunStore(); const calls: WorldDayStage[] = [];
    const result = await executeWorldDay(input, store, handlers(calls, failedStage));
    expect(result).toMatchObject({ status: 'failed', failureStage: failedStage, errorCode: `INJECTED_${failedStage.toUpperCase()}` });
    expect(calls).toEqual(WORLD_DAY_STAGES.slice(0, WORLD_DAY_STAGES.indexOf(failedStage) + 1));
    expect(calls).not.toContain('commit_accepted_events');
  });

  it('resumes at the failed safe boundary and retains prior checkpoint attempts', async () => {
    const store = new MemoryRunStore(); const first: WorldDayStage[] = [];
    await executeWorldDay(input, store, handlers(first, 'group_intents_into_scenes'));
    const retry: WorldDayStage[] = [];
    const result = await executeWorldDay(input, store, handlers(retry));
    expect(retry).toEqual(WORLD_DAY_STAGES.slice(5));
    expect(result).toMatchObject({ status: 'completed', attemptCount: 2 });
    expect(store.checkpoints.filter((row) => row.stage === 'group_intents_into_scenes').map((row) => row.attempt)).toEqual([1, 2]);
  });

  it('treats completed reruns as idempotent and rejects run identity conflicts', async () => {
    const store = new MemoryRunStore();
    await executeWorldDay(input, store, handlers([]));
    const duplicateCalls: WorldDayStage[] = [];
    expect(await executeWorldDay(input, store, handlers(duplicateCalls))).toMatchObject({ status: 'completed', committedEventIds: ['event:w:1'] });
    expect(duplicateCalls).toEqual([]);
    await expect(executeWorldDay({ ...input, worldDay: 5 }, store, handlers([]))).rejects.toMatchObject({ code: 'RUN_ID_CONFLICT' });
  });

  it('rejects malformed run identity before creating durable state', async () => {
    const store = new MemoryRunStore();
    await expect(executeWorldDay({ ...input, timeSlot: 'midnight' }, store, handlers([]))).rejects.toMatchObject({ code: 'RUN_INPUT_INVALID' });
    expect(store.run).toBeNull();
  });

  it('rejects structural and Canon failures before an atomic commit can write anything', async () => {
    for (const failedStage of ['validate_structured_output', 'validate_canon'] as const) {
      const canon: string[] = []; const store = new MemoryRunStore(); const stageHandlers = handlers([], failedStage);
      stageHandlers.commit_accepted_events = () => { canon.push('should-not-write'); return Promise.resolve({ committedEventIds: canon }); };
      expect((await executeWorldDay(input, store, stageHandlers)).status).toBe('failed');
      expect(canon).toEqual([]);
    }
  });

  it('records commit failure and an atomic commit adapter rolls back the entire candidate batch', async () => {
    const canon = ['existing']; const store = new MemoryRunStore(); const stageHandlers = handlers([]);
    stageHandlers.commit_accepted_events = () => {
      const transaction = [...canon]; transaction.push('candidate-1');
      return Promise.reject(new WorldDayOrchestrationError('CANON_BATCH_REJECTED', 'candidate-2 rejected; transaction rolled back'));
    };
    const result = await executeWorldDay(input, store, stageHandlers);
    expect(result).toMatchObject({ status: 'failed', failureStage: 'commit_accepted_events', errorCode: 'CANON_BATCH_REJECTED' });
    expect(canon).toEqual(['existing']);
  });

  it('rejects malformed commit evidence instead of marking the run complete', async () => {
    const store = new MemoryRunStore(); const stageHandlers = handlers([]);
    stageHandlers.commit_accepted_events = () => Promise.resolve({ committedEventIds: ['same', 'same'] });
    expect(await executeWorldDay(input, store, stageHandlers)).toMatchObject({ status: 'failed', failureStage: 'commit_accepted_events', errorCode: 'COMMIT_RESULT_INVALID' });
  });
});
