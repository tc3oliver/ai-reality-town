/**
 * The scene-persistence trace contract (ART-159).
 *
 * ## Why this file exists
 *
 * `persistValidatedSceneSimulation` is the ONLY way an authored scene reaches the database, and
 * its `trace` argument is `v.any()` — so Convex validates nothing and `parseTrace` is the entire
 * contract. That function had no test at all, and when ART-148 renamed `ProviderTraceMetadata.model`
 * to `requestedModel` and added `resolvedModel` / `upstreamProvider` / `rateLimit`, nothing turned
 * red. The validator kept demanding a key the type no longer has and kept rejecting every key the
 * type had gained, so EVERY live slot would have failed at persistence — with a
 * `SCENE_SIMULATION_INVALID` that names the trace rather than the rename that broke it.
 *
 * It went unnoticed because the fake provider's trace travels this path only in production: the
 * unit tests call `simulateWholeScene` directly and never persist, and the E2E fixture serves
 * pre-built read models rather than running a slot.
 *
 * The tests below are written against the PORT TYPE rather than a literal, so the next change to
 * `ProviderTraceMetadata` cannot pass by updating a fixture — `traceOf` gets its value from a real
 * provider call, and the exhaustiveness test fails if a field is added to the type without a
 * decision being made here about whether persistence accepts it.
 */

import type { ProviderTraceMetadata } from './provider';
import type { GroupedScene, SceneGroupingResult } from './sceneGrouping';
import { FakeWholeSceneProvider, FAKE_SCENE_MODEL } from './fakeSceneNarrator';
import { simulateWholeScene } from './sceneSimulation';
import { persistValidatedSceneSimulation } from './sceneSimulationFunctions';

type Row = Record<string, unknown>;

const WORLD_ID = 'mistwood';
const GROUPING_RUN_ID = 'group-1';
const SIMULATION_RUN_ID = 'group-1:scene:1:simulation';

const scene: GroupedScene = {
  schemaVersion: 1, sceneId: 'group-1:scene:1', groupingRunId: GROUPING_RUN_ID, directorRunId: 'director-1',
  worldId: WORLD_ID, worldDay: 2, timeSlot: 'evening', locationId: 'mistwood-station',
  participantIds: ['lin-yingxue', 'wu-zhen'], sourceIntentIds: ['intent-1', 'intent-2'],
  arcIds: ['arc-station-ledger'], trigger: '打開封存的置物櫃', dramaticPressure: '鎮長黃昏時抵達',
};

const groupingResult: SceneGroupingResult = { scenes: [scene], decisions: [] };

/** The registered mutation, invoked through `_handler` with a fake `ctx` — the pattern
 *  `shareFormatFunctions.test.ts` established for exercising a Convex function without a
 *  deployment. */
type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<never> };
const persistFn = persistValidatedSceneSimulation as unknown as Registered;

/**
 * A minimal `sceneSimulationRuns` / `groupedSceneRuns` store.
 *
 * `by_world_and_run` is modelled as the equality filter it is, so a handler that forgot the index
 * and collected the table would read the same rows and this fixture would not notice. That is
 * acceptable here only because the read volume is not what these tests are about — the trace
 * contract is.
 */
function fakeDb(tables: { sceneSimulationRuns: Row[]; groupedSceneRuns: Row[] }) {
  return {
    query(table: 'sceneSimulationRuns' | 'groupedSceneRuns') {
      let rows = [...tables[table]];
      const chain = {
        withIndex(_name: string, build: (q: unknown) => unknown) {
          const constraints: Array<[string, unknown]> = [];
          const q = { eq(field: string, value: unknown) { constraints.push([field, value]); return q; } };
          build(q);
          rows = rows.filter((row) => constraints.every(([field, value]) => row[field] === value));
          return chain;
        },
        unique() { return Promise.resolve(rows[0] ?? null); },
        first() { return Promise.resolve(rows[0] ?? null); },
        collect() { return Promise.resolve(rows); },
      };
      return chain;
    },
    insert(table: 'sceneSimulationRuns' | 'groupedSceneRuns', row: Row) {
      tables[table].push(row);
      return Promise.resolve(`${table}-${tables[table].length}`);
    },
  };
}

const emptyTables = () => ({
  sceneSimulationRuns: [] as Row[],
  groupedSceneRuns: [{ worldId: WORLD_ID, groupingRunId: GROUPING_RUN_ID, result: groupingResult }] as Row[],
});

const persist = (tables: ReturnType<typeof emptyTables>, args: Row) =>
  persistFn._handler({ db: fakeDb(tables) }, {
    worldId: WORLD_ID, simulationRunId: SIMULATION_RUN_ID, groupingRunId: GROUPING_RUN_ID,
    sceneId: scene.sceneId, attemptCount: 1, createdAt: 1_000, ...args,
  });

/**
 * A real authored scene, produced by the provider the live path actually used.
 *
 * Deliberately NOT a hand-written fixture: the defect this file was written for is a disagreement
 * between what a provider PRODUCES and what persistence ACCEPTS, and a fixture written by hand
 * would be a third opinion that could agree with neither.
 */
async function authored(): Promise<{ output: unknown; trace: ProviderTraceMetadata }> {
  const result = await simulateWholeScene(new FakeWholeSceneProvider(), SIMULATION_RUN_ID, scene, { maxAttempts: 1 });
  return { output: result.output, trace: result.trace };
}

describe('ART-159 — persistence accepts the trace its own providers emit', () => {
  it('persists a scene the deterministic provider authored', async () => {
    const tables = emptyTables();
    const { output, trace } = await authored();

    const stored = await persist(tables, { output, trace }) as { deduplicated: boolean };

    expect(stored.deduplicated).toBe(false);
    expect(tables.sceneSimulationRuns).toHaveLength(1);
    // The stored trace is the provider's own, field for field. Persisting a trimmed copy would
    // lose exactly the ART-148 attribution the budget report is rebuilt from.
    expect((tables.sceneSimulationRuns[0].result as { trace: ProviderTraceMetadata }).trace)
      .toEqual(trace);
  });

  /**
   * The live-path shape: a gateway trace, with a routing alias requested and a concrete model
   * resolved. This is the case a free-only deployment produces on every call, and the one that
   * `FakeWholeSceneProvider` cannot exercise because it always resolves to itself.
   */
  it('persists a gateway trace whose requested route is not the model that served it', async () => {
    const tables = emptyTables();
    const { output, trace } = await authored();
    const gatewayTrace: ProviderTraceMetadata = {
      ...trace,
      provider: 'openai-compatible',
      requestedModel: 'auto',
      resolvedModel: 'deepseek-v4-pro',
      upstreamProvider: 'xkiro',
      rateLimit: { limit: 120, remaining: 118, resetAtEpochSeconds: 1_800_000_000 },
    };

    await persist(tables, { output, trace: gatewayTrace });

    expect((tables.sceneSimulationRuns[0].result as { trace: ProviderTraceMetadata }).trace)
      .toEqual(gatewayTrace);
  });

  /**
   * `resolvedModel: null` is a REAL state — a gateway that did not say what served the call — and
   * ART-148 chose to keep it visible as unattributed rather than book it against the alias.
   * Persistence has to accept it, or that decision is unreachable from the live path.
   */
  it('persists a trace the gateway declined to attribute', async () => {
    const tables = emptyTables();
    const { output, trace } = await authored();

    await persist(tables, {
      output,
      trace: { ...trace, provider: 'openai-compatible', requestedModel: 'auto', resolvedModel: null, upstreamProvider: null },
    });

    expect(tables.sceneSimulationRuns).toHaveLength(1);
  });

  it('still refuses a trace that is missing a required field', async () => {
    const tables = emptyTables();
    const { output, trace } = await authored();
    const { inputTokens: _dropped, ...incomplete } = trace;

    await expect(persist(tables, { output, trace: incomplete }))
      .rejects.toMatchObject({ code: 'SCENE_SIMULATION_INVALID' });
    expect(tables.sceneSimulationRuns).toHaveLength(0);
  });

  it('still refuses a trace carrying a field the port does not declare', async () => {
    const tables = emptyTables();
    const { output, trace } = await authored();

    await expect(persist(tables, { output, trace: { ...trace, promptText: 'the system prompt' } }))
      .rejects.toMatchObject({ code: 'SCENE_SIMULATION_INVALID' });
    // The point of the whitelist: an adapter that attached the prompt to its trace would otherwise
    // write it to a table an operator can read.
    expect(tables.sceneSimulationRuns).toHaveLength(0);
  });

  it('still refuses a trace from an adapter the port does not name', async () => {
    const tables = emptyTables();
    const { output, trace } = await authored();

    await expect(persist(tables, { output, trace: { ...trace, provider: 'some-other-vendor' } }))
      .rejects.toMatchObject({ code: 'SCENE_SIMULATION_INVALID' });
  });

  /**
   * The guard against the defect recurring rather than against its symptom.
   *
   * `parseTrace`'s whitelist is a hand-maintained list of the port type's keys, and the two went
   * out of step silently once already. This asserts the list is COMPLETE with respect to a real
   * trace value: adding a field to `ProviderTraceMetadata` and forgetting persistence makes the
   * loop below fail on that field by name.
   */
  it('accepts every field of the port type, one field at a time', async () => {
    const { output, trace } = await authored();
    const fields = Object.keys(trace) as Array<keyof ProviderTraceMetadata>;
    // Guards the guard: an empty or shrunken key list would make the loop below vacuous.
    expect(fields).toEqual(expect.arrayContaining([
      'provider', 'requestedModel', 'resolvedModel', 'upstreamProvider',
      'rateLimit', 'inputTokens', 'outputTokens', 'latencyMs', 'retryCount',
    ]));

    for (const field of fields) {
      const tables = emptyTables();
      const { [field]: _omitted, ...without } = trace;
      // Every declared field is REQUIRED: dropping any one is refused. That is what makes the
      // acceptance above a contract rather than a permissive `v.any()` in disguise.
      await expect(persist(tables, { output, trace: without }))
        .rejects.toMatchObject({ code: 'SCENE_SIMULATION_INVALID' });
    }
  });

  it('reuses the stored row rather than authoring a second one for the same run id', async () => {
    const tables = emptyTables();
    const { output, trace } = await authored();

    await persist(tables, { output, trace });
    const second = await persist(tables, { output, trace }) as { deduplicated: boolean };

    expect(second.deduplicated).toBe(true);
    expect(tables.sceneSimulationRuns).toHaveLength(1);
  });

  it('records the model the fake author reports, so the meter and the author agree', async () => {
    const tables = emptyTables();
    const { output, trace } = await authored();

    await persist(tables, { output, trace });

    expect((tables.sceneSimulationRuns[0].result as { trace: ProviderTraceMetadata }).trace.resolvedModel)
      .toBe(FAKE_SCENE_MODEL);
  });
});

describe('ART-159 — the provider port and the persisted trace cannot drift', () => {
  it('a provider returning a stale pre-ART-148 trace is refused, not silently stored', async () => {
    const tables = emptyTables();
    const { output } = await authored();
    // The shape `parseTrace` used to demand. It must now be REFUSED: a `model` key names neither
    // the route asked for nor the model that served, and storing it would resurrect exactly the
    // ambiguity ART-148 removed.
    const stale = {
      provider: 'openai-compatible', model: 'auto',
      inputTokens: 10, outputTokens: 20, latencyMs: 5, retryCount: 0,
    };

    await expect(persist(tables, { output, trace: stale }))
      .rejects.toMatchObject({ code: 'SCENE_SIMULATION_INVALID' });
  });

  it('a provider that reports no trace at all is refused', async () => {
    const tables = emptyTables();
    const { output } = await authored();

    await expect(persist(tables, { output, trace: null }))
      .rejects.toMatchObject({ code: 'SCENE_SIMULATION_INVALID' });
  });
});
