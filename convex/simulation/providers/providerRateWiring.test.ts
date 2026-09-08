/**
 * Rate metering ON THE LIVE WIRING (ART-158 AC#2), not on the helper.
 *
 * `providerRateWindow.test.ts` proves the window arithmetic. This proves the thing that arithmetic
 * is useless without: that a real authoring call actually reaches it, once per real upstream
 * request, through the recorder the live action installs — and that what lands in the store is
 * readable by the operator query.
 *
 * The chain under test is the shipped one:
 *
 *   authorSlotScenes → simulateWholeScene → FreeRouteChainProvider → safety gate
 *     → OpenAICompatibleProvider → createProviderCallRecorder().fetch → (stub)
 *
 * with `recordProviderCall` and `readProviderRateWindow` executed as themselves against a fake db.
 * ART-158 shipped its fallback helper with no caller and a green unit test; the whole point here is
 * not to repeat that.
 */

import type { GroupedScene, SceneGroupingResult } from '../sceneGrouping';
import { authorSlotScenes, type SceneAuthoringPlan, type SceneAuthoringStore } from '../worldDayLive';
import { persistValidatedSceneSimulation, findReusableSceneSimulation } from '../sceneSimulationFunctions';
import { reserveSceneBudget, settleSceneBudget, releaseSceneBudget } from '../tokenBudgetGateFunctions';
import { recordProviderCall, readProviderRateWindow, MAX_RATE_WINDOW_ROWS } from '../providerRateFunctions';
import { RATE_WINDOW_MS } from '../../shared/providerRateWindow';
import { createLiveSceneAuthor, LIVE_ROUTE_CHAIN_ENV } from './liveSceneAuthor';
import { createProviderCallRecorder } from './providerCallRecorder';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const WORLD_ID = 'mistwood';
const GROUPING_RUN_ID = 'group-1';
const T0 = 1_700_000_000_000;

const ENV = {
  LLM_API_URL: 'https://gateway.example.com/v1',
  LLM_MODEL: 'auto',
  LLM_EMBEDDING_MODEL: 'bge-m3',
  LLM_EMBEDDING_DIMENSION: '1024',
  LLM_API_KEY: 'test-key-never-a-real-credential',
  [LIVE_ROUTE_CHAIN_ENV]: 'auto, gemini-2.5-flash',
  LLM_MAX_ATTEMPTS: '1',
};

const scene = (index: number): GroupedScene => ({
  schemaVersion: 1, sceneId: `${GROUPING_RUN_ID}:scene:${index}`, groupingRunId: GROUPING_RUN_ID,
  directorRunId: 'director-1', worldId: WORLD_ID, worldDay: 2, timeSlot: 'evening',
  locationId: 'mistwood-station', participantIds: ['lin-yingxue', 'wu-zhen'],
  sourceIntentIds: [`intent-${index}a`, `intent-${index}b`], arcIds: ['arc-station-ledger'],
  trigger: '打開封存的置物櫃', dramaticPressure: '鎮長黃昏時抵達',
});

const plan = (scenes: GroupedScene[]): SceneAuthoringPlan => ({
  slot: { worldId: WORLD_ID, worldDay: 2, timeSlot: 'evening' },
  groupingRunId: GROUPING_RUN_ID,
  scenes,
  options: { maxAttempts: 1, temperature: 0.4, maxTokens: 4_000 },
  requestedModel: 'auto',
  legalDestinationIds: Object.fromEntries(scenes.map((entry) => [entry.sceneId, ['mistwood-square']])),
  // ART-91: no fallback configured, so rung 2 keeps the requested model.
  fallbackModel: null,
  maxConcurrentScenes: 1,
});

const sceneOutput = (target: GroupedScene): unknown => ({
  schemaVersion: 1, sceneId: target.sceneId,
  sceneSummary: `在 ${target.locationId}，兩人為了置物櫃對峙。`,
  keyActions: [{ characterId: 'lin-yingxue', action: '轉動置物櫃的鑰匙。' }],
  dialogueHighlights: [{ characterId: 'wu-zhen', text: '那就是我送來的信封。' }],
  proposedEvents: [{
    schemaVersion: 1, worldId: WORLD_ID, idempotencyKey: `${target.sceneId}:event:1`,
    proposedBy: { type: 'director', id: 'director-1' }, worldDay: 2, timeSlot: 'evening',
    eventType: 'conversation', locationId: target.locationId,
    participantIds: ['lin-yingxue', 'wu-zhen'], causedByEventIds: [],
    publicSummary: `在 ${target.locationId}，林映雪與吳振談起置物櫃。`,
    metadata: { sceneId: target.sceneId },
    stateChanges: [{ type: 'fact_created', subjectType: 'location', subjectId: target.locationId,
      predicate: 'lastMajorSceneSummary', value: 'x', visibility: 'public' }],
  }],
  relationshipChanges: [], knowledgeChanges: [], memories: [], rumors: [], continuityWarnings: [],
});

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const served = (target: GroupedScene, routedModel: string, over: {
  promptTokens?: number; completionTokens?: number; remaining?: number; withUsage?: boolean;
} = {}): Response => jsonResponse({
  choices: [{ message: { content: JSON.stringify(sceneOutput(target)) } }],
  ...(over.withUsage === false ? {} : {
    usage: { prompt_tokens: over.promptTokens ?? 120, completion_tokens: over.completionTokens ?? 340 },
  }),
  model: routedModel,
  _routed_via: { platform: 'xkiro', model: routedModel },
}, 200, {
  'x-ratelimit-limit': '120',
  'x-ratelimit-remaining': String(over.remaining ?? 118),
  'x-ratelimit-reset': '1800000000',
});

// --- the fake deployment ----------------------------------------------------

function fakeDb(tables: Tables) {
  const ensure = (table: string): Row[] => (tables[table] ??= []);
  return {
    query(table: string) {
      let rows = [...ensure(table)];
      const chain = {
        withIndex(_name: string, build: (q: unknown) => unknown) {
          const eqs: Array<[string, unknown]> = [];
          const gts: Array<[string, unknown]> = [];
          const q = {
            eq(field: string, value: unknown) { eqs.push([field, value]); return q; },
            gt(field: string, value: unknown) { gts.push([field, value]); return q; },
          };
          build(q);
          rows = rows.filter((row) =>
            eqs.every(([field, value]) => row[field] === value)
            && gts.every(([field, value]) => Number(row[field]) > Number(value)));
          return chain;
        },
        order() { return chain; },
        take(count: number) { return Promise.resolve(rows.slice(0, count)); },
        collect() { return Promise.resolve(rows); },
        unique() { return Promise.resolve(rows[0] ?? null); },
        first() { return Promise.resolve(rows[0] ?? null); },
      };
      return chain;
    },
    insert(table: string, row: Row) {
      const stored = { ...row, _id: `${table}:${ensure(table).length + 1}` };
      ensure(table).push(stored);
      return Promise.resolve(stored._id);
    },
    patch(id: string, patch: Row) {
      for (const rows of Object.values(tables)) {
        const found = rows.find((row) => row._id === id);
        if (found) { Object.assign(found, patch); return Promise.resolve(); }
      }
      throw new Error(`no row ${id}`);
    },
  };
}

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handlerFor = (fn: unknown): Registered => fn as Registered;

/** The paths the live action refers to, so a mismatch throws instead of silently doing nothing. */
const FUNCTION_PATHS = {
  findReusable: 'simulation/sceneSimulationFunctions:findReusableSceneSimulation',
  persist: 'simulation/sceneSimulationFunctions:persistValidatedSceneSimulation',
  reserve: 'simulation/tokenBudgetGateFunctions:reserveSceneBudget',
  settle: 'simulation/tokenBudgetGateFunctions:settleSceneBudget',
  release: 'simulation/tokenBudgetGateFunctions:releaseSceneBudget',
  record: 'simulation/providerRateFunctions:recordProviderCall',
} as const;

/**
 * Dispatch by PATH, to the real registered handlers, against one shared fake database.
 *
 * Keyed on the same strings `internalFunctionRef` is given in `liveWorldDayActions.ts`, so a typo
 * on either side throws `unregistered function` rather than silently doing nothing.
 */
function actionCalls(tables: Tables) {
  const registry = new Map<string, Registered>([
    [FUNCTION_PATHS.findReusable, handlerFor(findReusableSceneSimulation)],
    [FUNCTION_PATHS.persist, handlerFor(persistValidatedSceneSimulation)],
    [FUNCTION_PATHS.reserve, handlerFor(reserveSceneBudget)],
    [FUNCTION_PATHS.settle, handlerFor(settleSceneBudget)],
    [FUNCTION_PATHS.release, handlerFor(releaseSceneBudget)],
    [FUNCTION_PATHS.record, handlerFor(recordProviderCall)],
  ]);
  return <T>(path: string, args: unknown): Promise<T> => {
    const target = registry.get(path);
    if (!target) throw new Error(`unregistered function ${path}`);
    return target._handler({ db: fakeDb(tables) }, args) as Promise<T>;
  };
}

const emptyTables = (): Tables => ({
  sceneSimulationRuns: [],
  groupedSceneRuns: [{
    worldId: WORLD_ID, groupingRunId: GROUPING_RUN_ID,
    result: { scenes: [scene(1), scene(2)], decisions: [] } satisfies SceneGroupingResult,
  }],
  moduleModelConfigs: [], tokenBudgetPolicies: [], tokenBudgetCounters: [], tokenBudgetLedger: [],
  providerRateBuckets: [],
});

/**
 * Author scenes through the SAME assembly the live action builds: a recorder-wrapped transport,
 * the gated adapter, and the route chain. Only `fetch` and the clock are supplied by the test.
 */
async function authorWithMetering(options: {
  responses: Array<Response | Error>;
  scenes?: GroupedScene[];
  /** Wall-clock offsets, one per upstream call, so bucket placement is deterministic. */
  callTimes?: number[];
  tables?: Tables;
  sinkFails?: boolean;
}) {
  const tables = options.tables ?? emptyTables();
  const call = actionCalls(tables);
  const queue = [...options.responses];
  const times = [...(options.callTimes ?? [])];
  let callIndex = 0;

  const recorder = createProviderCallRecorder({
    inner: () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('the gateway was called more times than scripted');
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    fallbackModel: 'auto',
    clock: () => T0 + (times[callIndex++] ?? 0),
    sink: options.sinkFails
      ? () => Promise.reject(new Error('sink refused'))
      : (record) => call<void>(FUNCTION_PATHS.record, { worldId: WORLD_ID, ...record }),
  });

  const provider = createLiveSceneAuthor(ENV, { fetch: recorder.fetch, now: () => T0, delay: () => Promise.resolve() });
  const store: SceneAuthoringStore = {
    // ART-90: this fixture measures nothing, so the attempt recorder is inert.
    recordAuthoringAttempt: () => Promise.resolve(),
    loadPersistedSceneSimulation: (worldId, groupingRunId, simulationRunId) =>
      call(FUNCTION_PATHS.findReusable, { worldId, groupingRunId, simulationRunId }),
    persistSceneSimulation: async (groupingRunId, result) => {
      await call(FUNCTION_PATHS.persist, {
        worldId: result.scene.worldId, simulationRunId: result.simulationRunId, groupingRunId,
        sceneId: result.scene.sceneId, output: result.output, attemptCount: result.attemptCount,
        trace: result.trace, createdAt: T0,
      });
    },
    budget: {
      reserve: (request, decisionId) => call(FUNCTION_PATHS.reserve, { request, decisionId, now: T0 }),
      settle: async (request, decisionId, settlement) => {
        await call(FUNCTION_PATHS.settle, { request, decisionId, settlement, now: T0 });
      },
      release: async (request, decisionId, failure = null) => {
        await call(FUNCTION_PATHS.release, { request, decisionId, failure, now: T0 });
      },
    },
  };

  const outcome = await authorSlotScenes(provider, store, plan(options.scenes ?? [scene(1)]))
    .then(() => ({ error: null as unknown }))
    .catch((error: unknown) => ({ error }));

  return { ...outcome, tables, recorder };
}

const window = (tables: Tables, nowOffset = 500) =>
  readProviderRateWindow(fakeDb(tables) as unknown as Parameters<typeof readProviderRateWindow>[0], WORLD_ID, T0 + nowOffset);

describe('AC#2 — a live authoring call reaches the rate store', () => {
  it('records one request per real upstream call, with the tokens the gateway reported', async () => {
    const { tables, error } = await authorWithMetering({ responses: [served(scene(1), 'deepseek-v4-pro')] });
    expect(error).toBeNull();

    const { summaries } = await window(tables);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      requestedModel: 'auto',
      requestsPerMinute: 1,
      // 120 + 340 from the scripted usage block — the GATEWAY's numbers, not the reservation bound.
      tokensPerMinute: 460,
      inputTokens: 120,
      outputTokens: 340,
      served: 1,
      callsWithoutUsage: 0,
    });
  });

  it('reads the allowance and its reset out of the response headers', async () => {
    const { tables } = await authorWithMetering({
      responses: [served(scene(1), 'deepseek-v4-pro', { remaining: 117 })],
    });

    const { summaries } = await window(tables);
    expect(summaries[0].allowance).toEqual({
      limit: 120, remaining: 117, resetAtEpochSeconds: 1_800_000_000,
    });
  });

  it('keeps the requested route and the resolved model apart on the live path', async () => {
    const { tables } = await authorWithMetering({ responses: [served(scene(1), 'deepseek-v4-pro')] });

    const { summaries } = await window(tables);
    expect(summaries[0].requestedModel).toBe('auto');
    expect(summaries[0].resolutions).toEqual([
      { resolvedModel: 'deepseek-v4-pro', upstreamProvider: 'xkiro', requests: 1 },
    ]);
  });

  it('counts a 429 AND the hop that recovered it as two requests on two routes', async () => {
    const { tables, error } = await authorWithMetering({
      responses: [jsonResponse({}, 429), served(scene(1), 'gemini-2.5-flash')],
      callTimes: [0, 10],
    });
    expect(error).toBeNull();

    const { summaries } = await window(tables);
    // Two routes, one request each — this is the shape a fallback actually has, and a per-scene
    // or per-reservation counter would have reported one.
    expect(summaries.map((entry) => [entry.requestedModel, entry.requestsPerMinute, entry.rateLimited]))
      .toEqual([['auto', 1, 1], ['gemini-2.5-flash', 1, 0]]);
  });

  it('records a refused call with NO tokens, rather than zero tokens', async () => {
    const { tables } = await authorWithMetering({
      responses: [jsonResponse({}, 429), served(scene(1), 'gemini-2.5-flash')],
      callTimes: [0, 10],
    });

    const { summaries } = await window(tables);
    const refused = summaries.find((entry) => entry.requestedModel === 'auto');
    expect(refused?.tokensPerMinute).toBe(0);
    // The distinction: the gateway said nothing about usage, which is not the same as saying zero.
    expect(refused?.callsWithoutUsage).toBe(1);
    expect(refused?.resolutions).toEqual([{ resolvedModel: null, upstreamProvider: null, requests: 1 }]);
  });

  it('records a served call the gateway reported no usage for as unmeasured, not free', async () => {
    const { tables } = await authorWithMetering({
      responses: [served(scene(1), 'deepseek-v4-pro', { withUsage: false })],
    });

    const { summaries } = await window(tables);
    expect(summaries[0]).toMatchObject({ requestsPerMinute: 1, tokensPerMinute: 0, callsWithoutUsage: 1 });
  });

  it('counts each scene of a slot as its own request', async () => {
    const { tables } = await authorWithMetering({
      scenes: [scene(1), scene(2)],
      responses: [served(scene(1), 'deepseek-v4-pro'), served(scene(2), 'deepseek-v4-pro')],
      callTimes: [0, 10],
    });

    const { summaries } = await window(tables);
    expect(summaries[0].requestsPerMinute).toBe(2);
    expect(summaries[0].tokensPerMinute).toBe(920);
  });

  it('drops the rate once the calls age out, without touching the day counters', async () => {
    const { tables } = await authorWithMetering({ responses: [served(scene(1), 'deepseek-v4-pro')] });

    expect((await window(tables, 500)).summaries[0].requestsPerMinute).toBe(1);
    // A minute later the RATE is zero while the world-day SPEND is unchanged. Two clocks, two
    // questions — which is the whole reason this is not derived from the counters.
    expect((await window(tables, RATE_WINDOW_MS + 5_000)).summaries).toEqual([]);
    expect(tables.tokenBudgetCounters[0].totalTokens).toBe(460);
  });
});

describe('AC#2 — the read is bounded by the window, not by the world age', () => {
  /**
   * Fault injection found this untested: removing the window bound from the range read left every
   * assertion green, because `summarizeProviderRates` filters expired buckets again in memory. The
   * RESULT stayed right — but the read became unbounded, so on a world that had been running a
   * while it would hit the row cap on ancient rows and report `truncated: true` while silently
   * dropping the buckets that are actually inside the window.
   *
   * That is the failure this pins: a read whose cost, and whose completeness, depend on how long
   * the world has existed rather than on how many routes were called in the last minute.
   */
  it('is unaffected by a backlog of expired buckets far exceeding the row cap', async () => {
    const tables = emptyTables();
    // Well past the cap, all long expired — the shape a running world accumulates between vacuums.
    for (let index = 0; index < MAX_RATE_WINDOW_ROWS + 200; index += 1) {
      tables.providerRateBuckets.push({
        _id: `providerRateBuckets:old-${index}`, schemaVersion: 1, worldId: WORLD_ID,
        requestedModel: `stale-route-${index % 20}`,
        bucketStartMs: T0 - RATE_WINDOW_MS * 10 - index * 1_000,
        requests: 1, served: 1, rateLimited: 0, failed: 0,
        inputTokens: 999, outputTokens: 999, callsWithoutUsage: 0,
        resolutions: [], allowance: null, updatedAt: T0,
      });
    }

    await authorWithMetering({ responses: [served(scene(1), 'deepseek-v4-pro')], tables });
    const { summaries, truncated } = await window(tables);

    // Complete, not truncated, and reporting only the one call that happened in the window.
    expect(truncated).toBe(false);
    expect(summaries).toEqual([expect.objectContaining({
      requestedModel: 'auto', requestsPerMinute: 1, tokensPerMinute: 460,
    })]);
  });

  it('reports truncation when genuinely more in-window rows exist than the cap', async () => {
    // The negative control for the test above: `truncated` must be able to be true, or asserting
    // it false proves nothing.
    const tables = emptyTables();
    for (let index = 0; index <= MAX_RATE_WINDOW_ROWS; index += 1) {
      tables.providerRateBuckets.push({
        _id: `providerRateBuckets:live-${index}`, schemaVersion: 1, worldId: WORLD_ID,
        requestedModel: `route-${index}`, bucketStartMs: T0 - index,
        requests: 1, served: 1, rateLimited: 0, failed: 0,
        inputTokens: 1, outputTokens: 1, callsWithoutUsage: 0,
        resolutions: [], allowance: null, updatedAt: T0,
      });
    }

    expect((await window(tables)).truncated).toBe(true);
  });
});

describe('AC#2 — the metering cannot quietly lie', () => {
  it('reports dropped records rather than losing them silently', async () => {
    const { recorder, error } = await authorWithMetering({
      responses: [served(scene(1), 'deepseek-v4-pro')],
      sinkFails: true,
    });

    // The call is already paid for by the time it is recorded, so the counter yields to the work
    // — but the caller learns the rate is a floor.
    expect(error).toBeNull();
    expect(recorder.dropped()).toBe(1);
  });

  it('the recorder attributes a body with no model to the configured route', async () => {
    // ART-52: a module inheriting the deployment's LLM_MODEL sends NO override, so the gateway
    // routes on its own default — which is that same id. Attributing it there is what happened.
    const records: Array<{ requestedModel: string }> = [];
    const recorder = createProviderCallRecorder({
      inner: () => Promise.resolve(jsonResponse({ model: 'x' })),
      fallbackModel: 'auto',
      clock: () => T0,
      sink: (record) => { records.push(record); return Promise.resolve(); },
    });

    await recorder.fetch('https://gateway.example.com/v1/chat/completions', {
      method: 'POST', body: JSON.stringify({ messages: [] }),
    });

    expect(records[0].requestedModel).toBe('auto');
  });

  it('records a transport-level throw as a real failed attempt', async () => {
    const records: Array<{ outcome: string; inputTokens: number | null }> = [];
    const recorder = createProviderCallRecorder({
      inner: () => Promise.reject(new Error('socket closed')),
      fallbackModel: 'auto',
      clock: () => T0,
      sink: (record) => { records.push(record); return Promise.resolve(); },
    });

    await expect(recorder.fetch('https://gateway.example.com/v1/chat/completions', {
      method: 'POST', body: JSON.stringify({ model: 'auto' }),
    })).rejects.toThrow('socket closed');

    // A request that left the process and produced no answer is what a caller experiences as a
    // failed call; omitting it would make a broken network look like an idle one.
    expect(records).toEqual([expect.objectContaining({ outcome: 'failed', inputTokens: null })]);
  });

  it('leaves the adapter a readable body after cloning it', async () => {
    // The recorder reads usage off a clone. If it consumed the real body instead, every live call
    // would fail to parse its own response — and it would fail AFTER paying for it.
    const { error, tables } = await authorWithMetering({ responses: [served(scene(1), 'deepseek-v4-pro')] });

    expect(error).toBeNull();
    expect(tables.sceneSimulationRuns).toHaveLength(1);
  });
});
