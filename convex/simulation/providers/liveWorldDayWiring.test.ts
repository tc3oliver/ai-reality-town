/**
 * The live authoring path, end to end, without a gateway (ART-159).
 *
 * ## Why this is not a helper test
 *
 * ART-158 shipped `callWithFreeRouteFallback` with a thorough unit test and NO CALLER — the
 * fallback's behaviour was a property of that test rather than of the system. A second unit test
 * would have repeated the mistake, so everything below drives the REAL chain:
 *
 *   authorSlotScenes → simulateWholeScene → runBudgetedAttempt
 *     → FreeRouteChainProvider → withPreGenerationSafety → OpenAICompatibleProvider → fetch
 *   and, through a fake `ActionCtx`, the REAL registered mutations:
 *     reserveSceneBudget / settleSceneBudget / releaseSceneBudget / persistValidatedSceneSimulation
 *
 * The only stub is `fetch`. Everything between the world-day slot and the socket is the shipped
 * code, so an HTTP status is classified by the adapter that ships, the budget is decided by the
 * accountant that ships, and a scene is persisted by the validator that ships.
 *
 * That matters most for the classification tests: "429 is a route-level failure and 400 is not"
 * is a claim about `isRouteLevelFailure` AND about which error the adapter raises for each status.
 * Testing the predicate alone would leave the adapter free to map both onto the same code.
 */

import { getFunctionName } from 'convex/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AcceptedEvent } from '../../canon/model';
import { assertPreGenerationSafe } from '../../safety/preGeneration';
import type { GroupedScene, SceneGroupingResult } from '../sceneGrouping';
import { authorSlotScenes, SCENE_AUTHORING_DEFERRED, type SceneAuthoringPlan } from '../worldDayLive';
import { persistValidatedSceneSimulation, findReusableSceneSimulation } from '../sceneSimulationFunctions';
import {
  reserveSceneBudget, settleSceneBudget, releaseSceneBudget,
} from '../tokenBudgetGateFunctions';
import { FREE_ROUTES_EXHAUSTED } from './freeRouteChain';
import { createLiveSceneAuthor, LIVE_ROUTE_CHAIN_ENV } from './liveSceneAuthor';
import { actionAuthoringStore } from './liveWorldDayActions';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const WORLD_ID = 'mistwood';
const GROUPING_RUN_ID = 'group-1';
const NOW = 1_700_000_000_000;

const ENV = {
  LLM_API_URL: 'https://gateway.example.com/v1',
  LLM_MODEL: 'auto',
  LLM_EMBEDDING_MODEL: 'bge-m3',
  LLM_EMBEDDING_DIMENSION: '1024',
  LLM_API_KEY: 'test-key-never-a-real-credential',
  // Two routes, so a fallback is possible and its absence is observable.
  [LIVE_ROUTE_CHAIN_ENV]: 'auto, gemini-2.5-flash',
  // One HTTP attempt per route: the adapter's own retry ladder is ART-72's and is tested there.
  // Pinning it to 1 here makes every fetch in these tests a ROUTE decision rather than a
  // transport one, which is the thing under test.
  LLM_MAX_ATTEMPTS: '1',
};

const scene = (index: number): GroupedScene => ({
  schemaVersion: 1, sceneId: `${GROUPING_RUN_ID}:scene:${index}`, groupingRunId: GROUPING_RUN_ID,
  directorRunId: 'director-1', worldId: WORLD_ID, worldDay: 2, timeSlot: 'evening',
  locationId: 'mistwood-station', participantIds: ['lin-yingxue', 'wu-zhen'],
  sourceIntentIds: [`intent-${index}a`, `intent-${index}b`], arcIds: ['arc-station-ledger'],
  trigger: '打開封存的置物櫃', dramaticPressure: '鎮長黃昏時抵達',
});

const plan = (scenes: GroupedScene[], requestedModel = 'auto'): SceneAuthoringPlan => ({
  slot: { worldId: WORLD_ID, worldDay: 2, timeSlot: 'evening' },
  groupingRunId: GROUPING_RUN_ID,
  scenes,
  options: { maxAttempts: 1, temperature: 0.4, maxTokens: 4_000 },
  requestedModel,
  legalDestinationIds: Object.fromEntries(scenes.map((entry) => [entry.sceneId, ['mistwood-square']])),
  // ART-91: no fallback configured, so rung 2 keeps the requested model.
  fallbackModel: null,
  maxConcurrentScenes: 1,
});

/** A well-formed whole-scene output for `scene`, as the gateway would return it. */
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

/** The gateway's success envelope, with ART-148's route attribution and ART-158's allowance. */
const served = (target: GroupedScene, routedModel: string, remaining = 118): Response => jsonResponse({
  choices: [{ message: { content: JSON.stringify(sceneOutput(target)) } }],
  usage: { prompt_tokens: 120, completion_tokens: 340 },
  model: routedModel,
  _routed_via: { platform: 'xkiro', model: routedModel },
}, 200, {
  'x-ratelimit-limit': '120', 'x-ratelimit-remaining': String(remaining),
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
          const constraints: Array<[string, unknown]> = [];
          const q = { eq(field: string, value: unknown) { constraints.push([field, value]); return q; } };
          build(q);
          rows = rows.filter((row) => constraints.every(([field, value]) => row[field] === value));
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
    get(id: string) {
      for (const rows of Object.values(tables)) {
        const found = rows.find((row) => row._id === id);
        if (found) return Promise.resolve(found);
      }
      return Promise.resolve(null);
    },
  };
}

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handlerFor = (fn: unknown): Registered => fn as Registered;

/**
 * The function paths the live action refers to, mapped to the real handlers.
 *
 * Keyed by the SAME string `internalFunctionRef` is given in `liveWorldDayActions.ts`, so a typo
 * in one of those paths makes the dispatch below throw `unregistered function` rather than
 * silently doing nothing. `pathsResolveToRealExports` below closes the remaining hole — that both
 * sides could be wrong in the same way — by checking each path against the file it names.
 */
const FUNCTION_PATHS = {
  findReusable: 'simulation/sceneSimulationFunctions:findReusableSceneSimulation',
  persist: 'simulation/sceneSimulationFunctions:persistValidatedSceneSimulation',
  reserve: 'simulation/tokenBudgetGateFunctions:reserveSceneBudget',
  settle: 'simulation/tokenBudgetGateFunctions:settleSceneBudget',
  release: 'simulation/tokenBudgetGateFunctions:releaseSceneBudget',
  /** FR-M002 / ART-90: one trace per authoring attempt, written from the action that makes it. */
  recordAttempt: 'simulation/qualityEvidenceFunctions:recordAuthoringAttempt',
  /** FR-M004 / ART-91: the slot outcome the degradation ladder folds; only the action knows it. */
  recordSlotOutcome: 'simulation/degradationFunctions:recordSlotOutcome',
} as const;

/**
 * An `ActionCtx` that dispatches to the REAL registered handlers.
 *
 * This is what makes the assertions below statements about the deployed wiring. A hand-written
 * budget double would have let the accountant and this test agree with each other while both
 * disagreed with production — the exact failure mode `sceneBudget.ts` warns about for its own
 * in-memory accountant.
 */
function actionCtx(tables: Tables) {
  const calls: string[] = [];
  const registry = new Map<string, Registered>([
    [FUNCTION_PATHS.findReusable, handlerFor(findReusableSceneSimulation)],
    [FUNCTION_PATHS.persist, handlerFor(persistValidatedSceneSimulation)],
    [FUNCTION_PATHS.reserve, handlerFor(reserveSceneBudget)],
    [FUNCTION_PATHS.settle, handlerFor(settleSceneBudget)],
    [FUNCTION_PATHS.release, handlerFor(releaseSceneBudget)],
  ]);
  const dispatch = (ref: unknown, args: unknown) => {
    const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
    const target = registry.get(name);
    // The E2E fixture transport throws on an unregistered query for the same reason: a silent
    // `undefined` here would let a test pass while the wiring it claims to cover never ran.
    if (!target) throw new Error(`unregistered function ${name}`);
    calls.push(name);
    return target._handler({ db: fakeDb(tables) }, args);
  };
  return {
    ctx: { runQuery: dispatch, runMutation: dispatch } as never,
    calls,
  };
}

const emptyTables = (): Tables => ({
  sceneSimulationRuns: [],
  groupedSceneRuns: [{
    worldId: WORLD_ID, groupingRunId: GROUPING_RUN_ID,
    result: { scenes: [scene(1), scene(2)], decisions: [] } satisfies SceneGroupingResult,
  }],
  moduleModelConfigs: [],
  tokenBudgetPolicies: [],
  tokenBudgetCounters: [],
  tokenBudgetLedger: [],
});

/** Run the live authoring half against a scripted gateway. Returns everything worth asserting. */
async function authorLive(options: {
  responses: Array<Response | Error>;
  scenes?: GroupedScene[];
  env?: Record<string, string>;
  tables?: Tables;
}) {
  const tables = options.tables ?? emptyTables();
  const requests: Array<{ model: string; url: string }> = [];
  const queue = [...options.responses];
  let overflowed = false;
  const provider = createLiveSceneAuthor({ ...ENV, ...options.env }, {
    fetch: (url, init) => {
      const body = JSON.parse(String(init?.body)) as { model?: string };
      requests.push({ model: body.model ?? '(none)', url: String(url) });
      const next = queue.shift();
      if (next === undefined) {
        // Recorded rather than thrown-and-asserted-on: the adapter catches everything from
        // `fetch` and maps it to a transient network error, so a thrown marker would be
        // indistinguishable from a scripted outage by the time it reached the assertion.
        overflowed = true;
        return Promise.reject(new Error('unscripted gateway call'));
      }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    now: () => NOW,
    delay: () => Promise.resolve(),
  });
  const { ctx, calls } = actionCtx(tables);
  const scenes = options.scenes ?? [scene(1)];
  const outcome = await authorSlotScenes(provider, actionAuthoringStore(ctx, NOW), plan(scenes))
    .then((results) => ({ results, error: null as unknown }))
    .catch((error: unknown) => ({ results: [], error }));
  return { ...outcome, requests, calls, tables, overflowed, unusedResponses: queue.length };
}

const ledgerOf = (tables: Tables) => tables.tokenBudgetLedger;
const countersOf = (tables: Tables) => tables.tokenBudgetCounters[0];

// --- AC#4: the primary route succeeding must not call a fallback ------------

describe('AC#4 — a route that serves is the only route called', () => {
  it('calls the gateway exactly once and never reaches the second route', async () => {
    const target = scene(1);
    const { results, requests, error } = await authorLive({ responses: [served(target, 'deepseek-v4-pro')] });

    expect(error).toBeNull();
    expect(results).toHaveLength(1);
    // The assertion that matters: ONE request, and it named the FIRST route. A chain that always
    // walked every route would still produce a scene, so counting the scenes proves nothing.
    expect(requests.map(({ model }) => model)).toEqual(['auto']);
  });

  it('authors each scene once, so a two-scene slot makes two calls and not four', async () => {
    const { results, requests } = await authorLive({
      scenes: [scene(1), scene(2)],
      responses: [served(scene(1), 'deepseek-v4-pro'), served(scene(2), 'deepseek-v4-pro')],
    });

    expect(results).toHaveLength(2);
    expect(requests.map(({ model }) => model)).toEqual(['auto', 'auto']);
  });
});

// --- AC#5/#6: 429 falls over; other failures do not -------------------------

describe('AC#5 — a genuine 429 moves to the next route', () => {
  it('retries on the SECOND route and returns the scene it served', async () => {
    const target = scene(1);
    const { results, requests, error } = await authorLive({
      responses: [jsonResponse({ error: 'rate limited' }, 429), served(target, 'gemini-2.5-flash')],
    });

    expect(error).toBeNull();
    expect(results).toHaveLength(1);
    expect(requests.map(({ model }) => model)).toEqual(['auto', 'gemini-2.5-flash']);
  });

  it('books the settlement against the route that actually served, not the one first asked for', async () => {
    const target = scene(1);
    const { tables } = await authorLive({
      responses: [jsonResponse({}, 429), served(target, 'gemini-2.5-flash')],
    });

    const settled = ledgerOf(tables).filter((row) => row.resolution === 'settled');
    expect(settled).toHaveLength(1);
    // ART-148/ART-159 together: the reservation is keyed on the alias, the SPEND is booked
    // against what the gateway said served it. Booking `auto` here would meter a bucket the
    // world never spends from.
    expect(settled[0].settledModel).toBe('gemini-2.5-flash');
    expect(settled[0].requestedModel).toBe('auto');
  });
});

describe('AC#6 — a general failure is classified differently from a 429', () => {
  /**
   * The distinction, stated as behaviour rather than as a predicate call: a 400 is about the
   * REQUEST, so every route would refuse it identically and trying them would burn the whole
   * chain's allowance to arrive at the same answer.
   */
  it('does NOT try the next route when the gateway rejects the request itself', async () => {
    const { requests, error } = await authorLive({
      responses: [jsonResponse({ error: 'bad request' }, 400)],
    });

    expect(requests.map(({ model }) => model)).toEqual(['auto']);
    expect(error).toBeTruthy();
    // And it surfaces as ITSELF, not buried under an exhaustion error — the caller has to be able
    // to see that the request was rejected rather than that routes ran out.
    expect((error as { code: string }).code).not.toBe(FREE_ROUTES_EXHAUSTED);
  });

  it('DOES try the next route when the gateway itself is broken (500)', async () => {
    const target = scene(1);
    const { requests, error } = await authorLive({
      responses: [jsonResponse({}, 500), served(target, 'gemini-2.5-flash')],
    });

    expect(error).toBeNull();
    expect(requests.map(({ model }) => model)).toEqual(['auto', 'gemini-2.5-flash']);
  });

  /**
   * A broken gateway is not an exhausted allowance.
   *
   * Fault injection found this untested: reporting EVERY retryable status as rate-limited passed
   * every assertion here, because the tests above only counted ATTEMPTS. `LLM_HTTP_RETRYABLE`
   * covers 408, 429 and all 5xx — they are all worth retrying — but only one of them says the key
   * ran out, and an operator reading `rateLimited` on a 500 goes hunting for a quota problem while
   * the gateway is simply down.
   */
  it('books a 500 as a failure, NOT as rate limiting', async () => {
    const { tables } = await authorLive({
      responses: [jsonResponse({}, 500), jsonResponse({}, 500)],
    });

    const usage = countersOf(tables).usageByRoute as Array<Row>;
    expect(usage.some((entry) => Number(entry.failures) > 0)).toBe(true);
    expect(usage.every((entry) => Number(entry.rateLimited) === 0)).toBe(true);
  });

  it('books a 429 as rate limiting, NOT as a plain failure — the paired control', async () => {
    const { tables } = await authorLive({
      responses: [jsonResponse({}, 429), jsonResponse({}, 429)],
    });

    const usage = countersOf(tables).usageByRoute as Array<Row>;
    expect(usage.some((entry) => Number(entry.rateLimited) > 0)).toBe(true);
    expect(usage.every((entry) => Number(entry.failures) === 0)).toBe(true);
  });

  it('a 429 and a 400 do not produce the same number of attempts', async () => {
    // The comparison the two tests above imply, made explicit so a change that collapsed both
    // onto one classification fails HERE with a message about classification rather than as two
    // unrelated expectations.
    const rateLimited = await authorLive({
      responses: [jsonResponse({}, 429), served(scene(1), 'gemini-2.5-flash')],
    });
    const rejected = await authorLive({ responses: [jsonResponse({}, 400)] });

    expect(rateLimited.requests).toHaveLength(2);
    expect(rejected.requests).toHaveLength(1);
  });
});

// --- AC#7: exhaustion is honest --------------------------------------------

describe('AC#7 — an exhausted key is not a routing problem and is not treated as one', () => {
  it('fails once every route has been tried, rather than looping', async () => {
    const { requests, error } = await authorLive({
      responses: [jsonResponse({}, 429), jsonResponse({}, 429)],
    });

    // Two routes configured, two attempts, then a stop. Not three, and not a retry of the first.
    expect(requests.map(({ model }) => model)).toEqual(['auto', 'gemini-2.5-flash']);
    expect((error as { code: string }).code).toBe(FREE_ROUTES_EXHAUSTED);
  });

  it('raises a PERMANENT error, so no outer retry re-spends the whole chain', async () => {
    const { error } = await authorLive({ responses: [jsonResponse({}, 429), jsonResponse({}, 429)] });

    // ART-158 measured that a REFUSED call still costs one unit of key allowance. If exhaustion
    // were transient, `simulateWholeScene`'s retry loop would spend the chain again for the same
    // reason — the "switching route restores my quota" mistake, one level up.
    expect((error as { kind: string }).kind).toBe('permanent');
  });

  it('records every hop as a failure against its own route, so an exhausted key is visible', async () => {
    const { tables } = await authorLive({
      responses: [jsonResponse({}, 429), jsonResponse({}, 429)],
    });

    const counters = countersOf(tables);
    // The reservation was RELEASED, not settled: nothing ran, so nothing is booked as spent.
    // Reporting tokens here would inflate the day's usage with calls that never happened.
    expect(counters.totalTokens).toBe(0);
    expect(counters.inFlight).toBe(0);
    const usage = counters.usageByRoute as Array<Row>;
    expect(usage.some((entry) => Number(entry.rateLimited) > 0)).toBe(true);
  });

  it('a single configured route means a 429 fails immediately with no second hop', async () => {
    // The honest consequence of "the allowance is per KEY": with one route there is nowhere to go,
    // and inventing a hop would spend allowance to ask the same key the same question.
    const { requests, error } = await authorLive({
      env: { [LIVE_ROUTE_CHAIN_ENV]: 'auto' },
      responses: [jsonResponse({}, 429)],
    });

    expect(requests).toHaveLength(1);
    expect((error as { code: string }).code).toBe(FREE_ROUTES_EXHAUSTED);
  });
});

// --- AC#8: the budget really runs on this path ------------------------------

describe('AC#8 — reserve / settle / release execute on the live wiring', () => {
  it('reserves before the call and settles the provider\'s own reported usage after it', async () => {
    const target = scene(1);
    const { tables, calls } = await authorLive({ responses: [served(target, 'deepseek-v4-pro')] });

    // Order, not merely presence: a settlement that preceded the call would be booking a number
    // that did not exist yet.
    expect(calls.filter((name) => name.includes('SceneBudget'))).toEqual([
      expect.stringContaining('reserveSceneBudget'),
      expect.stringContaining('settleSceneBudget'),
    ]);
    const counters = countersOf(tables);
    // 120 + 340 from the scripted `usage` block — the GATEWAY's numbers, not the 4000-token
    // reservation bound. Booking the bound would over-report every call by roughly ten times.
    expect(counters.totalTokens).toBe(460);
    expect(counters.grantedCalls).toBe(1);
    expect(counters.settledCalls).toBe(1);
    expect(counters.inFlight).toBe(0);
  });

  it('records the free-tier allowance the gateway reported, which is what can stop the world', async () => {
    const { tables } = await authorLive({ responses: [served(scene(1), 'deepseek-v4-pro', 117)] });

    const usage = countersOf(tables).usageByRoute as Array<Row>;
    const entry = usage.find((row) => row.model === 'deepseek-v4-pro');
    expect(entry?.allowance).toMatchObject({ limit: 120, remaining: 117 });
  });

  it('releases the reservation when the call throws, so a failure cannot leak a concurrency slot', async () => {
    const { tables } = await authorLive({ responses: [jsonResponse({}, 400)] });

    const counters = countersOf(tables);
    // The failure mode this prevents: a leaked in-flight count permanently consumes one of
    // `maxConcurrentCalls` for the world day, so a world with a limit of 2 stops simulating
    // entirely after two provider failures.
    expect(counters.inFlight).toBe(0);
    expect(counters.grantedCalls).toBe(1);
    expect(counters.settledCalls).toBe(0);
    expect(ledgerOf(tables)[0].resolution).toBe('released');
  });

  it('the whole chain is ONE reservation, not one per hop', async () => {
    const { tables } = await authorLive({
      responses: [jsonResponse({}, 429), served(scene(1), 'gemini-2.5-flash')],
    });

    // The chain is a property of the provider, below the accountant. Reserving per hop would
    // make a fallback count as two calls against `maxConcurrentCalls` while only one is in
    // flight — and would double-count the day's call census.
    expect(ledgerOf(tables)).toHaveLength(1);
    expect(countersOf(tables).grantedCalls).toBe(1);
  });
});

// --- AC#9: the route id is not the model -----------------------------------

describe('AC#9 — the requested route is never assumed to be the model that served', () => {
  it('keeps the alias and the resolved model apart on a persisted scene', async () => {
    const { tables } = await authorLive({ responses: [served(scene(1), 'deepseek-v4-pro')] });

    const stored = tables.sceneSimulationRuns[0].result as { trace: Row };
    expect(stored.trace).toMatchObject({
      requestedModel: 'auto', resolvedModel: 'deepseek-v4-pro', upstreamProvider: 'xkiro',
    });
  });

  it('treats a CONCRETE-LOOKING id as a router too, and still books what the gateway said', async () => {
    // `gemini-2.5-flash` looks like a model and is a route: the gateway answered with a different
    // id. Nothing may assume the two agree just because the requested one is not `auto`.
    const { tables } = await authorLive({
      env: { LLM_MODEL: 'gemini-2.5-flash', [LIVE_ROUTE_CHAIN_ENV]: 'gemini-2.5-flash' },
      responses: [served(scene(1), 'gemini-2.5-flash-8b-001')],
    });

    const stored = tables.sceneSimulationRuns[0].result as { trace: Row };
    expect(stored.trace.requestedModel).toBe('gemini-2.5-flash');
    expect(stored.trace.resolvedModel).toBe('gemini-2.5-flash-8b-001');
    expect(ledgerOf(tables)[0].settledModel).toBe('gemini-2.5-flash-8b-001');
  });

  it('leaves usage unattributed when the gateway does not say what served the call', async () => {
    const target = scene(1);
    const { tables } = await authorLive({
      responses: [jsonResponse({
        choices: [{ message: { content: JSON.stringify(sceneOutput(target)) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      })],
    });

    const stored = tables.sceneSimulationRuns[0].result as { trace: Row };
    expect(stored.trace.resolvedModel).toBeNull();
    // Visible as unattributed rather than silently booked against the alias.
    expect(countersOf(tables).unattributedCalls).toBe(1);
  });
});

// --- AC#10 / AC#3: what the split did not weaken ----------------------------

describe('AC#10 — the action cannot bypass safety, and does not touch Canon', () => {
  it('screens the prompt at the PORT, before ANY route is called', async () => {
    // A phrase the shipped policy actually prohibits (`EXTREME_VIOLENCE_DETAIL`). Asserted first
    // against the policy itself, so this test cannot pass because the phrase became harmless.
    const prohibited = 'graphic dismemberment';
    expect(() => assertPreGenerationSafe({ worldText: '', promptText: prohibited, contextText: [] }))
      .toThrow();

    const { requests, error } = await authorLive({
      responses: [served(scene(1), 'deepseek-v4-pro')],
      scenes: [{ ...scene(1), trigger: prohibited }],
    });

    // ZERO fetches is the wiring claim: the gate is INSIDE the chain, so it refuses before the
    // transport rather than after the first hop. A gate placed outside the chain would screen hop
    // one and let the fallbacks through unscreened.
    expect(requests).toHaveLength(0);
    expect(error).toBeTruthy();
  });

  it('a refused prompt costs ONE refusal, not the whole chain\'s allowance', async () => {
    const { requests } = await authorLive({
      responses: [served(scene(1), 'deepseek-v4-pro')],
      scenes: [{ ...scene(1), trigger: 'graphic dismemberment' }],
    });

    // A safety refusal is request-level: every route would refuse it identically, so walking the
    // chain would spend real allowance to arrive at the same answer.
    expect(requests).toHaveLength(0);
  });

  it('a scene the classifier withholds is still PERSISTED, and marked for review', async () => {
    // The safety verdict is computed by `persistValidatedSceneSimulation` — inside a mutation,
    // not in the action — so the action cannot decide a scene is safe. Whatever it authored, the
    // stored row carries the classifier's own answer.
    const { tables } = await authorLive({ responses: [served(scene(1), 'deepseek-v4-pro')] });

    const row = tables.sceneSimulationRuns[0];
    expect(['validated', 'review_required']).toContain(row.status);
    expect((row.result as { safety: Row }).safety).toBeTruthy();
  });

  it('writes NOTHING to Canon: authoring touches only its own tables', async () => {
    const { tables } = await authorLive({ responses: [served(scene(1), 'deepseek-v4-pro')] });

    // The action's entire write surface. `canonEvents` is absent because nothing in the authoring
    // half may append an event — that happens in the finishing mutation, behind Canon validation.
    expect(Object.keys(tables).filter((table) => (tables[table] ?? []).length > 0).sort())
      .toEqual(['groupedSceneRuns', 'sceneSimulationRuns', 'tokenBudgetCounters', 'tokenBudgetLedger']);
    expect(tables.canonEvents).toBeUndefined();
  });

  it('a proposal the author invented is still only a PROPOSAL at this point', async () => {
    const { results } = await authorLive({ responses: [served(scene(1), 'deepseek-v4-pro')] });

    // No `eventId`, no `sequenceNumber`: nothing here has been accepted by Canon. Those are added
    // by `commitProposedEvent` in the finishing mutation, after `validateCanon`.
    const proposed = results[0].output.proposedEvents[0] as Partial<AcceptedEvent>;
    expect(proposed.eventId).toBeUndefined();
    expect(proposed.sequenceNumber).toBeUndefined();
  });
});

describe('AC#1/#3 — the transactional pass may not author, and reuse still works', () => {
  it('refuses to author when handed no provider, and calls no gateway', async () => {
    const tables = emptyTables();
    const { ctx, calls } = actionCtx(tables);

    await expect(authorSlotScenes(null, actionAuthoringStore(ctx, NOW), plan([scene(1)])))
      .rejects.toMatchObject({ code: SCENE_AUTHORING_DEFERRED });
    // And it refused BEFORE reserving. A "deferring provider" that threw from inside the call
    // would have taken a reservation and released it, moving the day's counters for a call that
    // was never going to happen.
    expect(calls.filter((name) => name.includes('reserveSceneBudget'))).toHaveLength(0);
    expect(tables.tokenBudgetLedger).toHaveLength(0);
  });

  it('the transactional pass SUCCEEDS once the action has authored, without a gateway', async () => {
    // The live sequence, in order: the action authors, then the mutation finishes. This is the
    // property the whole split rests on — the second pass must not need a provider.
    const first = await authorLive({ responses: [served(scene(1), 'deepseek-v4-pro')] });
    const { ctx } = actionCtx(first.tables);

    const reused = await authorSlotScenes(null, actionAuthoringStore(ctx, NOW), plan([scene(1)]));

    expect(reused).toHaveLength(1);
    expect(reused[0].simulationRunId).toBe(`${GROUPING_RUN_ID}:scene:1:simulation`);
  });

  it('a re-run authors only the scenes that are missing, so a partial failure is not re-paid', async () => {
    // Scene 1 serves, scene 2's route is exhausted.
    const first = await authorLive({
      scenes: [scene(1), scene(2)],
      responses: [served(scene(1), 'deepseek-v4-pro'), jsonResponse({}, 429), jsonResponse({}, 429)],
    });
    expect(first.error).toBeTruthy();
    expect(first.tables.sceneSimulationRuns).toHaveLength(1);

    // The retry: scene 1 is reused, so the gateway is asked only about scene 2.
    const second = await authorLive({
      scenes: [scene(1), scene(2)],
      tables: first.tables,
      responses: [served(scene(2), 'deepseek-v4-pro')],
    });

    expect(second.error).toBeNull();
    expect(second.requests).toHaveLength(1);
    expect(second.results).toHaveLength(2);
  });
});

// --- the fixture is not lying to itself -------------------------------------

describe('the harness would notice if the wiring stopped running', () => {
  it('notices when the chain calls the gateway more times than the test scripted', async () => {
    const { overflowed } = await authorLive({ responses: [jsonResponse({}, 429)] });
    // Two routes are configured but only one response is scripted, so the second hop runs off the
    // end of the script. A harness that quietly served a default response instead would make every
    // fallback assertion in this file meaningless.
    expect(overflowed).toBe(true);
  });

  it('notices when a scripted response is never consumed', () => {
    // The other direction, and the one the `toHaveLength` assertions cannot see: if the chain
    // stopped calling the gateway altogether they would pass by asserting a shorter list.
    return authorLive({ responses: [served(scene(1), 'deepseek-v4-pro')] })
      .then(({ unusedResponses, overflowed }) => {
        expect(unusedResponses).toBe(0);
        expect(overflowed).toBe(false);
      });
  });

  it('dispatches to real handlers, and refuses an unregistered one', () => {
    const { ctx } = actionCtx(emptyTables());
    expect(() => (ctx as unknown as { runMutation: (r: unknown, a: unknown) => unknown })
      .runMutation({ _name: 'nope' }, {})).toThrow();
  });
});

describe('the function paths the live action uses name real exports', () => {
  /**
   * The dispatch above throws on an unknown path, which catches the action and this test
   * disagreeing. It cannot catch them agreeing on a path that does not exist — which would
   * deploy as a runtime `Could not find function` on the first live slot, long after CI.
   */
  it.each(Object.values(FUNCTION_PATHS))('%s is exported by the module it names', (path) => {
    const [modulePath, name] = path.split(':');
    const source = readFileSync(join(ROOT, 'convex', `${modulePath}.ts`), 'utf8');
    expect(source).toContain(`export const ${name} = internal`);
  });

  it('the live action refers to exactly these paths and no others', () => {
    const source = readFileSync(join(ROOT, 'convex/simulation/providers/liveWorldDayActions.ts'), 'utf8');
    const referenced = [...source.matchAll(/internalFunctionRef<[^>]+>\(\s*'([^']+)'/gu)].map(([, path]) => path);
    // The two slot mutations are driven through `runQueuedWorldDaySlot` / `prepareQueuedWorldDaySlot`,
    // which this fixture does not stand in for — it exercises the AUTHORING half. Naming them
    // here keeps that omission explicit rather than leaving the set looking complete.
    expect(referenced.sort()).toEqual([
      ...Object.values(FUNCTION_PATHS),
      'simulation/worldDayLiveFunctions:prepareQueuedWorldDaySlot',
      'simulation/worldDayLiveFunctions:runQueuedWorldDaySlot',
      // ART-158 AC#2. Exercised by `providerRateWiring.test.ts`, which drives the recorder the
      // action installs; named here so the set stays exhaustive rather than merely passing.
      'simulation/providerRateFunctions:recordProviderCall',
      // ART-160. Exercised by `liveOrchestration.test.ts`, which drives the cron entry point.
      'simulation/schedulerOperations:listDrivableWorlds',
    ].sort());
  });
});
