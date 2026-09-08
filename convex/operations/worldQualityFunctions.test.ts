/**
 * The FR-M002 operator read surfaces, driven as they actually run (ART-166).
 *
 * `convex/quality/*.test.ts` proves each evaluator divides the right numbers when it is HANDED
 * the right evidence. Nothing proved that the queries hand it the right evidence, and two of them
 * did not: `getStoryQualityMetrics` never passed `pendingWorldDays`, and
 * `getOperationalQualityMetrics` hardcoded `errorCode: null` over a trace row whose writer had
 * already thrown the code away. Both defects are invisible to a fixture that constructs the
 * evidence by hand, because the hand-written fixture is the thing the query was supposed to build.
 *
 * So this file invokes the registered function's `_handler` against an in-memory `db` — the
 * ART-128 pattern `dynamicViewMetricsFunctions.test.ts` established — and for the operational half
 * it writes the evidence through the REAL `recordAuthoringAttempt` mutation first, so the
 * assertion spans writer → table → reader rather than restating either side's mapping.
 */

import { TIME_SLOTS } from '../canon/eventTypes';
import { deriveEventId } from '../shared/ids';
import { recordAuthoringAttempt } from '../simulation/qualityEvidenceFunctions';
import { getOperationalQualityMetrics, getStoryQualityMetrics } from './worldQualityFunctions';

const WORLD = 'mistwood';
const T0 = 1_700_000_000_000;
const REGISTRY = JSON.stringify([
  { operatorId: 'op-real', role: 'viewer', subjects: [], token: 'correct-horse-battery-staple' },
]);
const CREDENTIALS = { operatorId: 'op-real', operatorToken: 'correct-horse-battery-staple' };

type Registered = {
  isQuery?: boolean;
  isMutation?: boolean;
  isInternal?: boolean;
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const storyQuery = getStoryQualityMetrics as unknown as Registered;
const operationalQuery = getOperationalQualityMetrics as unknown as Registered;
const attemptMutation = recordAuthoringAttempt as unknown as Registered;

// ---------------------------------------------------------------------------
// An in-memory `db` that answers from fixture arrays, keyed by table.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/**
 * `withIndex` is modelled as the equality / range constraints the caller asked for, applied in
 * insertion order, which is the order these fixtures seed the index's own key in. `order('desc')`
 * reverses that, so `by_world_and_sequence` + `order('desc').first()` really does answer with the
 * highest sequence number rather than with whatever happened to be first.
 */
function fakeDb(tables: Tables) {
  let counter = 0;
  const rowsOf = (table: string): Row[] => {
    if (!(table in tables)) tables[table] = [];
    return tables[table];
  };
  return {
    insert(table: string, doc: Row) {
      const _id = `${table}:${(counter += 1)}`;
      rowsOf(table).push({ ...doc, _id });
      return Promise.resolve(_id);
    },
    query(table: string) {
      let rows = [...rowsOf(table)];
      const chain = {
        withIndex(_index: string, build?: (q: unknown) => unknown) {
          const tests: ((row: Row) => boolean)[] = [];
          const q = {
            eq(field: string, value: unknown) { tests.push((row) => row[field] === value); return q; },
            gte(field: string, value: unknown) { tests.push((row) => (row[field] as number) >= (value as number)); return q; },
            lte(field: string, value: unknown) { tests.push((row) => (row[field] as number) <= (value as number)); return q; },
            lt(field: string, value: unknown) { tests.push((row) => (row[field] as number) < (value as number)); return q; },
          };
          build?.(q);
          rows = rows.filter((row) => tests.every((test) => test(row)));
          return chain;
        },
        order(direction: 'asc' | 'desc') {
          if (direction === 'desc') rows = [...rows].reverse();
          return chain;
        },
        take(count: number) { return Promise.resolve(rows.slice(0, count)); },
        collect() { return Promise.resolve(rows); },
        first() { return Promise.resolve(rows[0] ?? null); },
        unique() {
          if (rows.length > 1) throw new Error(`unique() matched ${rows.length} rows in ${table}`);
          return Promise.resolve(rows[0] ?? null);
        },
      };
      return chain;
    },
  };
}

const ctxFor = (tables: Tables) => ({
  auth: { getUserIdentity: () => Promise.resolve(null) },
  db: fakeDb(tables),
});

function emptyTables(): Tables {
  return {
    canonEvents: [],
    storyArcEventClassifications: [],
    episodeCoverageReports: [],
    coverageExclusions: [],
    storyArcLifecycles: [],
    storyArcProjectionEvents: [],
    storyArcResolutionDecisions: [],
    canonValidationOutcomes: [],
    llmTraces: [],
    sceneSimulationRuns: [],
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One accepted event, and the arc classification that makes it high-importance. */
function seedHighImportanceEvent(tables: Tables, sequenceNumber: number, worldDay: number) {
  tables.canonEvents.push({
    worldId: WORLD, sequenceNumber, worldDay, timeSlot: TIME_SLOTS[0],
    idempotencyKey: `${WORLD}:day:${worldDay}:seq:${sequenceNumber}`, acceptedAt: T0,
  });
  tables.storyArcEventClassifications.push({
    worldId: WORLD, sourceEventSequenceNumber: sequenceNumber,
    memberships: [{ arcId: 'arc-well', importance: 0.9 }],
  });
  return deriveEventId(WORLD, sequenceNumber);
}

/** A releasable published content for one day, citing exactly the events it covered. */
function seedReleasableEpisode(tables: Tables, worldDay: number, coveredEventIds: string[]) {
  tables.episodeCoverageReports.push({
    worldId: WORLD, worldDay, contentRef: `episode:${WORLD}:${worldDay}`,
    releasable: true, findingCodes: [], errorCode: null,
    report: { findings: [], coveredEventIds },
  });
}

type Observation = {
  key: string;
  numerator: number;
  denominator: number;
  rate: number | null;
  excluded: number;
  excludedReason: string | null;
  meetsTarget: boolean | null;
};

type StoryResponse = {
  report: {
    metrics: Observation[];
    findings: { code: string; subjectId: string; worldDay: number }[];
  };
};

type OperationalResponse = {
  report: { metrics: Observation[] };
  breakdown: {
    structuredOutputReasons: { code: string; count: number }[];
    providerFailureReasons: { code: string; count: number }[];
    models: { code: string; count: number }[];
  };
};

const metricOf = (response: StoryResponse | OperationalResponse, key: string) => {
  const metric = response.report.metrics.find((entry) => entry.key === key);
  if (!metric) throw new Error(`the report carries no ${key} metric`);
  return metric;
};

const priorRegistry = process.env.SIMULATION_OPS_OPERATORS;
const priorIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
beforeEach(() => {
  process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
  delete process.env.CLERK_JWT_ISSUER_DOMAIN;
});
afterEach(() => {
  if (priorRegistry === undefined) delete process.env.SIMULATION_OPS_OPERATORS;
  else process.env.SIMULATION_OPS_OPERATORS = priorRegistry;
  if (priorIssuer === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
  else process.env.CLERK_JWT_ISSUER_DOMAIN = priorIssuer;
});

// =============================================================================
// ART-166 defect 1 — the not-yet-due world day
// =============================================================================

describe('getStoryQualityMetrics: the world day whose Episode is not due yet', () => {
  /**
   * Two days of high-importance events, and only the earlier day published — which is not a
   * degraded world, it is EVERY world. `completedWorldDaysOf` admits a day only once the world has
   * moved past it, so the newest accepted day never has an Episode while it is still the newest.
   */
  function twoDayWorld(): Tables {
    const tables = emptyTables();
    const day3 = [seedHighImportanceEvent(tables, 1, 3), seedHighImportanceEvent(tables, 2, 3)];
    seedHighImportanceEvent(tables, 3, 4);
    seedHighImportanceEvent(tables, 4, 4);
    seedReleasableEpisode(tables, 3, day3);
    return tables;
  }

  const inspect = (tables: Tables, args: Row = {}) =>
    storyQuery._handler(ctxFor(tables), { ...CREDENTIALS, worldId: WORLD, ...args }) as Promise<StoryResponse>;

  it('excludes the newest accepted day from the coverage denominator with a reason', async () => {
    const response = await inspect(twoDayWorld());
    const coverage = metricOf(response, 'recap_coverage');

    // Day 3's two events are covered; day 4's two are not answerable yet, so they are excluded
    // and COUNTED as excluded rather than charged against the 0.95 target.
    expect(coverage.numerator).toBe(2);
    expect(coverage.denominator).toBe(2);
    expect(coverage.excluded).toBe(2);
    expect(coverage.rate).toBe(1);
    expect(coverage.meetsTarget).toBe(true);
    expect(coverage.excludedReason).toContain('not due yet');
  });

  it('reports no uncovered finding and no unpublished day for the newest accepted day', async () => {
    const response = await inspect(twoDayWorld());

    expect(response.report.findings.filter(({ code }) => code === 'HIGH_IMPORTANCE_EVENT_UNCOVERED')).toEqual([]);
    expect(response.report.findings.filter(({ code }) => code === 'WORLD_DAY_UNPUBLISHED')).toEqual([]);
  });

  it('agrees with the long-run harness, which passed the exclusion all along', async () => {
    // The harness passes `pendingWorldDays: [latestAcceptedWorldDay]` and reads 100% on a fully
    // published run. The console read the same evidence and reported 50% — one world, two answers
    // to §16.2's headline question, depending on which surface asked it.
    const coverage = metricOf(await inspect(twoDayWorld()), 'recap_coverage');
    expect(coverage.rate).toBe(1);
  });

  it('still charges an un-published day the world HAS moved past', async () => {
    // Day 3 is complete and unpublished; only day 4 is pending. The exclusion must not become a
    // blanket amnesty for every day that failed to publish.
    const tables = emptyTables();
    seedHighImportanceEvent(tables, 1, 3);
    seedHighImportanceEvent(tables, 2, 4);

    const response = await inspect(tables);
    const coverage = metricOf(response, 'recap_coverage');
    expect(coverage.numerator).toBe(0);
    expect(coverage.denominator).toBe(1);
    expect(coverage.excluded).toBe(1);
    expect(response.report.findings.filter(({ code }) => code === 'HIGH_IMPORTANCE_EVENT_UNCOVERED')
      .map(({ worldDay }) => worldDay)).toEqual([3]);
    expect(response.report.findings.filter(({ code }) => code === 'WORLD_DAY_UNPUBLISHED')
      .map(({ worldDay }) => worldDay)).toEqual([3]);
  });

  it('excludes nothing when the operator asked for a window the world has already moved past', async () => {
    // `toWorldDay: 3` with the world on day 4: day 3 IS due, so nothing in the window is pending
    // and the full denominator is measured. A pending set keyed off the requested window instead
    // of the world's own latest day would wrongly excuse day 3 here.
    const tables = twoDayWorld();
    tables.episodeCoverageReports = [];

    const coverage = metricOf(await inspect(tables, { toWorldDay: 3 }), 'recap_coverage');
    expect(coverage.denominator).toBe(2);
    expect(coverage.excluded).toBe(0);
    expect(coverage.rate).toBe(0);
  });
});

// =============================================================================
// ART-166 defects 2 and 3 — what the authoring attempt recorder keeps
// =============================================================================

describe('recordAuthoringAttempt → llmTraces → getOperationalQualityMetrics', () => {
  type AttemptSeed = {
    attempt: number;
    outcome: 'parsed' | 'output_rejected' | 'provider_failed';
    errorCode: string | null;
    sceneId?: string;
  };

  /** Write attempts through the real mutation, then read them through the real query. */
  async function recordThenRead(seeds: AttemptSeed[]): Promise<{ response: OperationalResponse; tables: Tables }> {
    const tables = emptyTables();
    tables.canonEvents.push({ worldId: WORLD, sequenceNumber: 1, worldDay: 2, timeSlot: TIME_SLOTS[0] });
    const ctx = ctxFor(tables);
    for (const seed of seeds) {
      const sceneId = seed.sceneId ?? `scene-${seed.attempt}`;
      await attemptMutation._handler(ctx, {
        worldId: WORLD, worldDay: 2, timeSlot: TIME_SLOTS[0], sceneId,
        simulationRunId: `${sceneId}:simulation`, attempt: seed.attempt,
        outcome: seed.outcome, errorCode: seed.errorCode,
        requestedModel: 'test-model', resolvedModel: 'test-model',
        transportRetries: 0, now: T0,
      });
    }
    const response = await operationalQuery._handler(ctxFor(tables), {
      ...CREDENTIALS, worldId: WORLD,
    }) as OperationalResponse;
    return { response, tables };
  }

  it('keeps two different provider failure codes apart in the reason dimension', async () => {
    // The live driver argues these call for different operator responses: a retryable HTTP error
    // is a wait, an exhausted free-route chain is a configuration problem. Collapsing them to one
    // constant makes the dimension unable to say which outage this was.
    const { response } = await recordThenRead([
      { attempt: 1, outcome: 'provider_failed', errorCode: 'LLM_HTTP_RETRYABLE', sceneId: 'scene-a' },
      { attempt: 1, outcome: 'provider_failed', errorCode: 'LLM_FREE_ROUTES_EXHAUSTED', sceneId: 'scene-b' },
    ]);

    expect(response.breakdown.providerFailureReasons).toEqual([
      { code: 'LLM_FREE_ROUTES_EXHAUSTED', count: 1 },
      { code: 'LLM_HTTP_RETRYABLE', count: 1 },
    ]);
  });

  it('keeps the specific schema code an answer was refused with', async () => {
    const { response } = await recordThenRead([
      { attempt: 1, outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_INVALID', sceneId: 'scene-a' },
      { attempt: 1, outcome: 'output_rejected', errorCode: 'SCENE_OUTPUT_PROVENANCE_MISMATCH', sceneId: 'scene-b' },
    ]);

    expect(response.breakdown.structuredOutputReasons).toEqual([
      { code: 'SCENE_OUTPUT_INVALID', count: 1 },
      { code: 'SCENE_OUTPUT_PROVENANCE_MISMATCH', count: 1 },
    ]);
    expect(metricOf(response, 'structured_output_success_rate')).toMatchObject({ numerator: 0, denominator: 2 });
  });

  it('records no code for an attempt that had none, without inventing one', async () => {
    const { response, tables } = await recordThenRead([
      { attempt: 1, outcome: 'parsed', errorCode: null, sceneId: 'scene-a' },
    ]);

    expect(tables.llmTraces).toHaveLength(1);
    expect(tables.llmTraces[0].errorCode).toBeUndefined();
    expect(response.breakdown.providerFailureReasons).toEqual([]);
    expect(response.breakdown.structuredOutputReasons).toEqual([]);
  });

  it('books no token count and no latency it never observed', async () => {
    // ART-90 wrote literal zeros here. The rate metrics never read them, but the FR-K002 Model
    // Trace panel does, and it showed a call that really happened as 0 tokens and 0 ms — which is
    // a measurement, not an absence. The settled usage is ART-59's ledger's to report.
    const { tables } = await recordThenRead([
      { attempt: 1, outcome: 'parsed', errorCode: null, sceneId: 'scene-a' },
    ]);

    const row = tables.llmTraces[0];
    for (const field of ['inputTokens', 'outputTokens', 'latencyMs']) {
      expect(row[field]).toBeUndefined();
      expect(Object.keys(row)).not.toContain(field);
    }
    // What the recorder DID observe is still written.
    expect(row).toMatchObject({ retryCount: 0, validationResult: 'passed', finalStatus: 'succeeded' });
  });

  it('re-recording one attempt does not double its reason', async () => {
    const tables = emptyTables();
    tables.canonEvents.push({ worldId: WORLD, sequenceNumber: 1, worldDay: 2, timeSlot: TIME_SLOTS[0] });
    const args = {
      worldId: WORLD, worldDay: 2, timeSlot: TIME_SLOTS[0], sceneId: 'scene-a',
      simulationRunId: 'scene-a:simulation', attempt: 1,
      outcome: 'provider_failed', errorCode: 'LLM_HTTP_RETRYABLE',
      requestedModel: 'test-model', resolvedModel: null, transportRetries: 0, now: T0,
    };
    const first = await attemptMutation._handler(ctxFor(tables), args) as { deduplicated: boolean };
    const second = await attemptMutation._handler(ctxFor(tables), args) as { deduplicated: boolean };

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    const response = await operationalQuery._handler(ctxFor(tables), { ...CREDENTIALS, worldId: WORLD }) as OperationalResponse;
    expect(response.breakdown.providerFailureReasons).toEqual([{ code: 'LLM_HTTP_RETRYABLE', count: 1 }]);
  });
});
