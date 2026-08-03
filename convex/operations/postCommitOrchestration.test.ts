import {
  POST_COMMIT_STAGES,
  PostCommitOrchestrationError,
  executePostCommitPipeline,
  type PostCommitCheckpoint,
  type PostCommitMetricsHook,
  type PostCommitRun,
  type PostCommitRunInput,
  type PostCommitRunStore,
  type PostCommitStage,
  type PostCommitStageHandlers,
} from './postCommitOrchestration';

const INPUT: PostCommitRunInput = {
  runId: 'run-1', worldId: 'w1', sourceEventId: 'evt-1',
  sourceEventSequenceNumber: 1, worldDay: 1,
};

class MemoryPostCommitStore implements PostCommitRunStore {
  run: PostCommitRun | null = null;
  checkpoints: PostCommitCheckpoint[] = [];
  loadRun(): Promise<PostCommitRun | null> { return Promise.resolve(this.run && structuredClone(this.run)); }
  createRun(input: PostCommitRunInput): Promise<PostCommitRun> {
    this.run = { ...input, status: 'running', attemptCount: 1 };
    return Promise.resolve(structuredClone(this.run));
  }
  listCheckpoints(): Promise<PostCommitCheckpoint[]> { return Promise.resolve(structuredClone(this.checkpoints)); }
  startCheckpoint(runId: string, stage: PostCommitStage, attempt: number): Promise<void> {
    this.checkpoints.push({ runId, stage, attempt, status: 'running' }); return Promise.resolve();
  }
  completeCheckpoint(runId: string, stage: PostCommitStage, attempt: number, artifact: unknown): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'completed', artifact: structuredClone(artifact) });
    return Promise.resolve();
  }
  failCheckpoint(runId: string, stage: PostCommitStage, attempt: number, error: { code: string; message: string }): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'failed', errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  resumeRun(_runId: string, attempt: number): Promise<void> {
    Object.assign(this.requiredRun(), { status: 'running', attemptCount: attempt, failureStage: undefined, errorCode: undefined, errorMessage: undefined });
    return Promise.resolve();
  }
  failRun(_runId: string, stage: PostCommitStage, error: { code: string; message: string }): Promise<void> {
    Object.assign(this.requiredRun(), { status: 'failed', failureStage: stage, errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  completeRun(_runId: string, metricsTraceId: string): Promise<void> {
    Object.assign(this.requiredRun(), { status: 'completed', metricsTraceId }); return Promise.resolve();
  }
  private requiredRun(): PostCommitRun { if (!this.run) throw new Error('missing run'); return this.run; }
  private find(runId: string, stage: PostCommitStage, attempt: number): PostCommitCheckpoint {
    const row = this.checkpoints.find((c) => c.runId === runId && c.stage === stage && c.attempt === attempt);
    if (!row) throw new Error('missing checkpoint'); return row;
  }
}

function handlers(record: { calls: PostCommitStage[]; failAt?: PostCommitStage }): PostCommitStageHandlers {
  const make = (stage: PostCommitStage) => (context: { traceId: string }): Promise<unknown> => {
    record.calls.push(stage);
    if (stage === record.failAt) throw new PostCommitOrchestrationError('STAGE_INJECTED_FAILURE', `${stage} failed (test)`);
    return Promise.resolve(stage === 'metrics'
      ? { schemaVersion: 1 as const, runId: INPUT.runId, worldId: INPUT.worldId, traceId: context.traceId, sourceEventId: INPUT.sourceEventId, stages: [], recordedAt: 1 } satisfies PostCommitMetricsHook
      : { stage });
  };
  return Object.fromEntries(POST_COMMIT_STAGES.map((stage) => [stage, make(stage)])) as unknown as PostCommitStageHandlers;
}

describe('executePostCommitPipeline (AC#1/#6 — ordered durable stages)', () => {
  it('runs every stage in PRD §12 order (11→21) and completes', async () => {
    const store = new MemoryPostCommitStore();
    const record = { calls: [] as PostCommitStage[] };
    const run = await executePostCommitPipeline(INPUT, store, handlers(record), 'trace-1');
    expect(run.status).toBe('completed');
    expect(run.metricsTraceId).toBe('trace-1');
    expect(record.calls).toEqual([...POST_COMMIT_STAGES]);
    expect(store.checkpoints.filter((c) => c.status === 'completed')).toHaveLength(POST_COMMIT_STAGES.length);
  });

  it('is idempotent: a completed run is returned without re-running stages', async () => {
    const store = new MemoryPostCommitStore();
    const record = { calls: [] as PostCommitStage[] };
    await executePostCommitPipeline(INPUT, store, handlers(record), 'trace-1');
    record.calls = [];
    const again = await executePostCommitPipeline(INPUT, store, handlers(record), 'trace-1');
    expect(again.status).toBe('completed');
    expect(record.calls).toEqual([]);
  });

  it('rejects a runId reused for a different commit', async () => {
    const store = new MemoryPostCommitStore();
    await executePostCommitPipeline(INPUT, store, handlers({ calls: [] }), 'trace-1');
    await expect(executePostCommitPipeline({ ...INPUT, sourceEventId: 'evt-2', sourceEventSequenceNumber: 2 }, store, handlers({ calls: [] }), 'trace-1'))
      .rejects.toThrow(PostCommitOrchestrationError);
  });
});

describe('executePostCommitPipeline (AC#2 — failure isolation)', () => {
  it('records a stable failure and leaves the accepted-event commit untouched', async () => {
    const store = new MemoryPostCommitStore();
    const record = { calls: [] as PostCommitStage[], failAt: 'episode' as PostCommitStage };
    const run = await executePostCommitPipeline(INPUT, store, handlers(record), 'trace-1');
    expect(run.status).toBe('failed');
    expect(run.failureStage).toBe('episode');
    expect(run.errorCode).toBe('STAGE_INJECTED_FAILURE');
    // No method on the store reads or writes accepted Canon events (AC#2); the
    // pipeline only advanced through stages before the failure.
    expect(store.checkpoints.filter((c) => c.status === 'completed').map((c) => c.stage))
      .toEqual(POST_COMMIT_STAGES.slice(0, POST_COMMIT_STAGES.indexOf('episode')));
  });
});

describe('executePostCommitPipeline (AC#4 — safe resume, no duplication)', () => {
  it('resumes at the failed stage and does not re-run completed stages', async () => {
    const store = new MemoryPostCommitStore();
    const record: { calls: PostCommitStage[]; failAt?: PostCommitStage } = { calls: [], failAt: 'episode' };
    await executePostCommitPipeline(INPUT, store, handlers(record), 'trace-1');
    const completedBefore = record.calls.length;
    record.failAt = undefined;
    const run = await executePostCommitPipeline(INPUT, store, handlers(record), 'trace-1');
    expect(run.status).toBe('completed');
    // Resume only ran the failed stage and the stages after it — no duplication.
    expect(record.calls.length - completedBefore).toBe(POST_COMMIT_STAGES.length - POST_COMMIT_STAGES.indexOf('episode'));
  });
});

describe('executePostCommitPipeline (AC#5 — durable metrics hook)', () => {
  it('records the metrics stage artifact linked to the trace id', async () => {
    const store = new MemoryPostCommitStore();
    await executePostCommitPipeline(INPUT, store, handlers({ calls: [] }), 'trace-42');
    const metricsCheckpoint = store.checkpoints.find((c) => c.stage === 'metrics');
    const hook = metricsCheckpoint?.artifact as PostCommitMetricsHook;
    expect(hook?.schemaVersion).toBe(1);
    expect(hook?.traceId).toBe('trace-42');
    expect(hook?.sourceEventId).toBe(INPUT.sourceEventId);
    expect(store.run?.metricsTraceId).toBe('trace-42');
  });
});
