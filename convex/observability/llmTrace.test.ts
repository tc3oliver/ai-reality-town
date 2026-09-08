import {
  InMemoryLlmTraceStore,
  LLM_TRACE_SCHEMA_VERSION,
  LlmTraceError,
  normalizeLlmTraceDraft,
  publicLlmTrace,
  recordLlmTrace,
  traceForRole,
  type LlmTraceDraft,
} from './llmTrace';

function completeDraft(overrides: Partial<LlmTraceDraft> = {}): LlmTraceDraft {
  return {
    schemaVersion: LLM_TRACE_SCHEMA_VERSION,
    traceId: 'trace-1',
    worldId: 'mistwood',
    worldDay: 42,
    runId: 'run-9',
    sceneId: 'scene-3',
    arcId: 'arc-ledger',
    characterIds: ['cassia', 'rowan'],
    model: 'compatible/model-v1',
    promptVersion: 'director-v4',
    inputTokens: 1200,
    outputTokens: 300,
    latencyMs: 845,
    retryCount: 1,
    validationResult: 'passed',
    finalStatus: 'succeeded',
    ...overrides,
  };
}

function expectTraceError(run: () => unknown, code: string, path: string): void {
  try {
    run();
    throw new Error('expected trace validation to fail');
  } catch (error) {
    expect(error).toMatchObject({ code, path });
  }
}

describe('LLM trace contract', () => {
  it('records every FR-M001 field and preserves correlation', async () => {
    const store = new InMemoryLlmTraceStore();
    const draft = completeDraft();
    await expect(recordLlmTrace(store, draft, 1_700_000_000_000)).resolves.toEqual({
      traceId: 'trace-1', deduplicated: false,
    });
    await expect(store.find('trace-1')).resolves.toEqual({
      ...draft,
      recordedAt: 1_700_000_000_000,
    });
  });

  it('defines calls without scene, arc, or character context explicitly', () => {
    const normalized = normalizeLlmTraceDraft({
      ...completeDraft(),
      sceneId: undefined,
      arcId: undefined,
      characterIds: [],
    });
    expect(normalized.sceneId).toBeUndefined();
    expect(normalized.arcId).toBeUndefined();
    expect(normalized.characterIds).toEqual([]);
    const raw = { ...completeDraft() } as unknown as Record<string, unknown>;
    delete raw.characterIds;
    expect(() => normalizeLlmTraceDraft(raw)).toThrow(LlmTraceError);
  });

  it.each(['prompt', 'rawPrompt', 'systemPrompt', 'messages', 'secret', 'characterSecrets', 'apiKey', 'requestBody']) (
    'rejects sensitive field %s before persistence',
    (field) => {
      expectTraceError(
        () => normalizeLlmTraceDraft({ ...completeDraft(), [field]: 'must-never-persist' }),
        'SENSITIVE_LLM_TRACE_FIELD',
        field,
      );
    },
  );

  it('rejects unknown fields, duplicate characters, unsupported enums, and invalid metrics', () => {
    expectTraceError(() => normalizeLlmTraceDraft({ ...completeDraft(), vendorPayload: true }), 'INVALID_LLM_TRACE', '$');
    expectTraceError(() => normalizeLlmTraceDraft(completeDraft({ characterIds: ['cassia', 'cassia'] })), 'INVALID_LLM_TRACE', 'characterIds');
    expectTraceError(() => normalizeLlmTraceDraft({ ...completeDraft(), finalStatus: 'unknown' }), 'INVALID_LLM_TRACE', 'finalStatus');
    expectTraceError(() => normalizeLlmTraceDraft(completeDraft({ inputTokens: Number.NaN })), 'INVALID_LLM_TRACE', 'inputTokens');
  });

  /**
   * ART-166. The three accounting fields became optional so the whole-scene attempt recorder can
   * say "I did not measure this" instead of writing three zeros the FR-K002 Model Trace panel
   * then rendered as a measurement. Optional must mean OMITTED at every layer: a default applied
   * here would put the zero back one module down from where it was removed.
   */
  it('keeps an unmeasured accounting field absent rather than defaulting it to zero', () => {
    const draft = { ...completeDraft() } as unknown as Record<string, unknown>;
    delete draft.inputTokens;
    delete draft.outputTokens;
    delete draft.latencyMs;

    const normalized = normalizeLlmTraceDraft(draft) as unknown as Record<string, unknown>;
    for (const field of ['inputTokens', 'outputTokens', 'latencyMs']) {
      expect(normalized[field]).toBeUndefined();
      expect(Object.keys(normalized)).not.toContain(field);
    }
    // A measured zero is still a measurement, and still stored.
    expect(normalizeLlmTraceDraft(completeDraft({ latencyMs: 0 })).latencyMs).toBe(0);
  });

  /**
   * ART-166. `errorCode` is the code a call failed with, and the reason the field is safe to add
   * to a record whose whole contract is "carries no model text" is that it admits a CODE and
   * nothing else. A pattern that admitted prose would make this the hole every other rule closes.
   */
  it('admits a stable failure code and refuses anything that could be a message', () => {
    expect(normalizeLlmTraceDraft(completeDraft({ errorCode: 'LLM_FREE_ROUTES_EXHAUSTED' })).errorCode)
      .toBe('LLM_FREE_ROUTES_EXHAUSTED');
    expect(normalizeLlmTraceDraft(completeDraft()).errorCode).toBeUndefined();

    for (const rejected of [
      'the model returned invalid JSON',
      'LLM_TIMEOUT: upstream took 30s',
      'llm_timeout',
      'Bearer sk-live-0000',
      '',
      'A'.repeat(65),
    ]) {
      expectTraceError(
        () => normalizeLlmTraceDraft(completeDraft({ errorCode: rejected })),
        'INVALID_LLM_TRACE',
        'errorCode',
      );
    }
  });

  it('exposes full metadata only to operations/admin roles', async () => {
    const store = new InMemoryLlmTraceStore();
    await recordLlmTrace(store, completeDraft(), 100);
    const record = await store.find('trace-1');
    expect(record).not.toBeNull();
    if (!record) throw new Error('missing trace fixture');
    const publicView = publicLlmTrace(record);
    expect(publicView).toEqual({
      schemaVersion: 1,
      traceId: 'trace-1',
      worldId: 'mistwood',
      worldDay: 42,
      finalStatus: 'succeeded',
    });
    expect(traceForRole(record, 'viewer')).toEqual(publicView);
    expect(traceForRole(record, 'public')).toEqual(publicView);
    expect(traceForRole(record, 'operations')).toEqual(record);
    expect(traceForRole(record, 'admin')).toEqual(record);
    expect(JSON.stringify(publicView)).not.toMatch(/prompt|token|model|character|scene|arc/iu);
  });

  it('deduplicates identical writes and rejects conflicting trace reuse', async () => {
    const store = new InMemoryLlmTraceStore();
    await recordLlmTrace(store, completeDraft(), 100);
    await expect(recordLlmTrace(store, completeDraft(), 200)).resolves.toEqual({
      traceId: 'trace-1', deduplicated: true,
    });
    await expect(recordLlmTrace(store, completeDraft({ outputTokens: 301 }), 300))
      .rejects.toMatchObject({ code: 'CONFLICTING_LLM_TRACE', path: 'traceId' });
    await expect(store.find('trace-1')).resolves.toMatchObject({ outputTokens: 300, recordedAt: 100 });
  });

  it('atomically deduplicates concurrent accounting attempts', async () => {
    const store = new InMemoryLlmTraceStore();
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      recordLlmTrace(store, completeDraft(), 100 + index)));
    expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
    expect(results.filter((result) => result.deduplicated)).toHaveLength(19);
    await expect(store.find('trace-1')).resolves.toMatchObject({ recordedAt: 100 });
  });

  it('isolates persisted trace metadata from caller mutation', async () => {
    const store = new InMemoryLlmTraceStore();
    const draft = completeDraft();
    await recordLlmTrace(store, draft, 100);
    draft.characterIds.push('intruder');
    const first = await store.find('trace-1');
    if (!first) throw new Error('missing trace fixture');
    first.characterIds.push('read-mutator');
    await expect(store.find('trace-1')).resolves.toMatchObject({ characterIds: ['cassia', 'rowan'] });
  });
});
