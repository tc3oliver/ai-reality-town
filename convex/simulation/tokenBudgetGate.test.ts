/**
 * `createConvexBudgetPort` — the ONLY budget binding that runs in the deployment (ART-59, M1).
 *
 * ## Why this file exists
 *
 * Every other ART-59 enforcement test drives `InMemoryBudgetAccountant`. That class's own
 * docblock says it differs from this port "only in where the three records are kept" — which is
 * the problem, not the mitigation: the reserve/settle/release protocol is written twice and, until
 * this file, only the double was exercised. A review injection proved it. Replacing the resolved
 * policy with unlimited defaults AND nulling the module cap here — the deployed path enforcing
 * literally nothing — left the whole suite green, as did blinding `settle` to metering mismatches
 * so the per-decision record affirmatively lied about which model ran.
 *
 * So every test below drives the REAL port against a database, and asserts on the ROWS it wrote.
 * Nothing here re-implements the decision: that is `tokenBudget.test.ts`'s job. What is proven
 * here is the plumbing the deployment depends on and nothing else covered — the three reads
 * (`tokenBudgetPolicies`, `moduleModelConfigs` via ART-52's own resolver, `tokenBudgetCounters`),
 * the ledger insert/patch protocol, `writeCounters`' insert-vs-patch, `resolvablePending`, and the
 * grant-replay / refusal-re-evaluation asymmetry.
 *
 * The in-memory `db` models the exact `withIndex`/`unique`/`take` shapes these reads use, in the
 * style `tokenBudgetFunctions.test.ts` and `moduleModelConfigFunctions.test.ts` established.
 */

import type { GenericDatabaseWriter } from 'convex/server';

import type { DataModel } from '../_generated/dataModel';
import { FAKE_SCENE_MODEL } from './fakeSceneNarrator';
import { MODULE_MODEL_DEFAULTS } from '../shared/moduleModelConfig';
import { TOKEN_BUDGET_POLICY_DEFAULTS, type BudgetReservationRequest, type BudgetSettlement } from '../shared/tokenBudget';
import { createConvexBudgetPort, loadBudgetCounters, listBudgetLedger, resolveTokenBudgetPolicy } from './tokenBudgetGate';

const WORLD_ID = 'mistwood';
const NOW = 1_700_000_000_000;
const OTHER_MODEL = 'gpt-4o';

type Row = Record<string, unknown>;
type Tables = {
  tokenBudgetPolicies: Row[];
  tokenBudgetCounters: Row[];
  tokenBudgetLedger: Row[];
  moduleModelConfigs: Row[];
};

/** The slice of Convex the gate uses. Index constraints are `eq` chains. */
function memoryDb(tables: Tables) {
  return {
    query(table: keyof Tables) {
      return {
        withIndex(_index: string, build?: (q: unknown) => unknown) {
          const constraints: Row = {};
          const builder = { eq(field: string, value: unknown) { constraints[field] = value; return builder; } };
          if (build) build(builder);
          const matched = (tables[table] ?? []).filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          const chain = (rows: Row[]) => ({
            order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
            take: (count: number) => Promise.resolve(rows.slice(0, count)),
            collect: () => Promise.resolve(rows),
            first: () => Promise.resolve(rows[0] ?? null),
            unique: () => Promise.resolve(rows[0] ?? null),
          });
          return chain(matched);
        },
      };
    },
    insert(table: keyof Tables, row: Row) {
      const _id = `${table}:${(tables[table] ?? []).length}`;
      (tables[table] ??= []).push({ ...row, _id });
      return Promise.resolve(_id);
    },
    patch(id: string, patch: Row) {
      for (const rows of Object.values(tables)) {
        const row = rows.find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      }
      return Promise.resolve();
    },
  };
}

const emptyTables = (): Tables => ({
  tokenBudgetPolicies: [], tokenBudgetCounters: [], tokenBudgetLedger: [], moduleModelConfigs: [],
});

/**
 * The in-memory `db`, narrowed to the surface the gate actually uses.
 *
 * A double cast rather than `any`: `GenericDatabaseWriter` carries Convex's whole generic surface
 * and this fake implements only the `withIndex`/`unique`/`take`/`insert`/`patch` shapes the gate
 * calls. Casting once here keeps every call site below strongly typed, so the port is exercised
 * through its REAL signature — if `createConvexBudgetPort`'s contract changes, these tests stop
 * compiling rather than silently passing an `any`.
 */
const dbOf = (tables: Tables) => memoryDb(tables) as unknown as GenericDatabaseWriter<DataModel>;
const portFor = (tables: Tables, modelId: string = FAKE_SCENE_MODEL) =>
  createConvexBudgetPort(dbOf(tables), NOW, () => Promise.resolve(modelId));

const request = (over: Partial<BudgetReservationRequest> = {}): BudgetReservationRequest => ({
  worldId: WORLD_ID,
  worldDay: 0,
  module: 'scene_simulation',
  requestedModel: FAKE_SCENE_MODEL,
  importance: 'standard',
  estimatedTokens: 4_000,
  attempt: 1,
  origin: 'scheduled_simulation',
  ...over,
});

const settlement = (over: Partial<BudgetSettlement> = {}): BudgetSettlement => ({
  module: 'scene_simulation',
  model: FAKE_SCENE_MODEL,
  reportedModel: FAKE_SCENE_MODEL,
  importance: 'standard',
  tokens: 1_200,
  countedAsRetry: false,
  onFastModel: false,
  ...over,
});

/** A real `tokenBudgetPolicies` row, as `setTokenBudgetPolicy` would have appended it. */
function seedPolicy(tables: Tables, over: Row = {}): void {
  tables.tokenBudgetPolicies.push({
    _id: `tokenBudgetPolicies:${tables.tokenBudgetPolicies.length}`,
    schemaVersion: 1, worldId: WORLD_ID, version: 1,
    ...TOKEN_BUDGET_POLICY_DEFAULTS,
    contentHash: 'tbp:test', actor: 'op-admin', reason: 'test', createdAt: NOW, isCurrent: true,
    ...over,
  });
}

/** A real `moduleModelConfigs` row, as ART-52's `setModuleModelConfig` would have appended it. */
function seedModuleConfig(tables: Tables, dailyTokenBudget: number | null): void {
  tables.moduleModelConfigs.push({
    _id: `moduleModelConfigs:${tables.moduleModelConfigs.length}`,
    schemaVersion: 1, worldId: WORLD_ID, module: 'scene_simulation', version: 1,
    ...MODULE_MODEL_DEFAULTS.scene_simulation,
    dailyTokenBudget,
    contentHash: 'mmc:test', actor: 'op-admin', reason: 'test', createdAt: NOW, isCurrent: true,
  });
}

const counters = (tables: Tables, worldDay = 0) => loadBudgetCounters(dbOf(tables), WORLD_ID, worldDay);
const ledger = (tables: Tables, worldDay = 0) => listBudgetLedger(dbOf(tables), WORLD_ID, worldDay, 100);

// ---------------------------------------------------------------------------

describe('the deployed port reads the three rows it is supposed to read', () => {
  it('resolves the world policy from a real tokenBudgetPolicies row', async () => {
    const tables = emptyTables();
    seedPolicy(tables, { worldDailyTokenBudget: 12_345, maxConcurrentCalls: 7 });

    const resolved = await resolveTokenBudgetPolicy(dbOf(tables), WORLD_ID);
    expect(resolved).toMatchObject({ source: 'configured', version: 1, worldDailyTokenBudget: 12_345, maxConcurrentCalls: 7 });
  });

  it('a world with no policy row resolves to the defaults, and enforces nothing', async () => {
    const tables = emptyTables();
    const decision = await portFor(tables).reserve(request({ estimatedTokens: 999_999 }), 'd-1');

    expect((await resolveTokenBudgetPolicy(dbOf(tables), WORLD_ID)).source).toBe('default');
    expect(decision.outcome).toBe('allowed');
    expect(decision.breachedLimits).toEqual([]);
  });

  it('enforces the world daily cap read from the stored policy', async () => {
    const tables = emptyTables();
    seedPolicy(tables, { worldDailyTokenBudget: 1_000 });

    const decision = await portFor(tables).reserve(request(), 'd-1');
    expect(decision.outcome).toBe('over_budget');
    expect(decision.boundLimit).toBe('world_daily_tokens');
    // The stored policy's version reaches the audit row, so a refusal can be traced to the
    // configuration that caused it.
    expect((await ledger(tables))[0]).toMatchObject({ policyVersion: 1, boundLimit: 'world_daily_tokens' });
  });

  it('AC#1 — enforces ART-52\'s per-module cap through the PRODUCTION resolveModuleConfig read', async () => {
    // The delegation, driven end to end against a real `moduleModelConfigs` row rather than
    // through the harness's injectable callback. This is the claim "one owner for the per-module
    // budget" actually rests on, and it was previously only exercised in the double.
    const tables = emptyTables();
    seedModuleConfig(tables, 1_000);

    const decision = await portFor(tables).reserve(request(), 'd-1');
    expect(decision.outcome).toBe('over_budget');
    expect(decision.boundLimit).toBe('module_daily_tokens');
  });

  it('a module row with a null cap enforces nothing — the negative control for the delegation', async () => {
    const tables = emptyTables();
    seedModuleConfig(tables, null);
    expect((await portFor(tables).reserve(request(), 'd-1')).outcome).toBe('allowed');
  });

  it('measures against the counters already stored for that world day', async () => {
    const tables = emptyTables();
    seedPolicy(tables, { worldDailyTokenBudget: 5_000 });
    const port = portFor(tables);
    await port.reserve(request(), 'd-1');
    await port.settle(request(), 'd-1', settlement({ tokens: 4_500 }));

    const decision = await port.reserve(request({ estimatedTokens: 1_000 }), 'd-2');
    expect(decision.outcome).toBe('over_budget');
    // Not zero: the second decision saw the first one's settled spend.
    expect(decision.observed.totalTokens).toBe(4_500);
  });
});

describe('reserve → settle writes both records', () => {
  it('grants, then books the reported usage and resolves the ledger row', async () => {
    const tables = emptyTables();
    const port = portFor(tables);
    await port.reserve(request(), 'd-1');

    const afterGrant = await counters(tables);
    expect(afterGrant).toMatchObject({ grantedCalls: 1, inFlight: 1, settledCalls: 0, totalTokens: 0 });
    expect((await ledger(tables))[0]).toMatchObject({ outcome: 'allowed', resolution: 'pending', settledTokens: null });

    await port.settle(request(), 'd-1', settlement({ tokens: 1_200 }));

    const afterSettle = await counters(tables);
    // The SPEND is booked, not the 4_000-token reservation.
    expect(afterSettle).toMatchObject({ totalTokens: 1_200, settledCalls: 1, inFlight: 0 });
    expect(afterSettle.tokensByModel).toEqual([{ model: FAKE_SCENE_MODEL, tokens: 1_200 }]);
    expect(afterSettle.tokensByModule).toEqual([{ module: 'scene_simulation', tokens: 1_200 }]);
    expect((await ledger(tables))[0]).toMatchObject({
      resolution: 'settled', settledTokens: 1_200, settledModel: FAKE_SCENE_MODEL,
    });
  });

  it('reserve → release frees the slot and books nothing', async () => {
    const tables = emptyTables();
    const port = portFor(tables);
    await port.reserve(request(), 'd-1');
    await port.release(request(), 'd-1');

    expect(await counters(tables)).toMatchObject({ inFlight: 0, totalTokens: 0, settledCalls: 0, grantedCalls: 1 });
    expect((await ledger(tables))[0]).toMatchObject({ resolution: 'released', settledTokens: null, settledModel: null });
  });

  it('resolvablePending — a second settle books nothing twice', async () => {
    const tables = emptyTables();
    const port = portFor(tables);
    await port.reserve(request(), 'd-1');
    await port.settle(request(), 'd-1', settlement({ tokens: 1_200 }));
    await port.settle(request(), 'd-1', settlement({ tokens: 1_200 }));

    expect(await counters(tables)).toMatchObject({ totalTokens: 1_200, settledCalls: 1 });
  });

  it('resolvablePending — settling a reservation that was never made books nothing', async () => {
    const tables = emptyTables();
    await portFor(tables).settle(request(), 'never-reserved', settlement());
    expect(tables.tokenBudgetCounters).toEqual([]);
  });

  it('writeCounters inserts once and patches thereafter — one row per world day', async () => {
    const tables = emptyTables();
    const port = portFor(tables);
    await port.reserve(request(), 'd-1');
    await port.settle(request(), 'd-1', settlement());
    await port.reserve(request(), 'd-2');
    await port.settle(request(), 'd-2', settlement());

    expect(tables.tokenBudgetCounters).toHaveLength(1);
    expect(await counters(tables)).toMatchObject({ grantedCalls: 2, settledCalls: 2, totalTokens: 2_400 });
  });

  it('day rollover is structural — a second world day gets its own zeroed row', async () => {
    const tables = emptyTables();
    seedPolicy(tables, { worldDailyTokenBudget: 5_000 });
    const port = portFor(tables);
    await port.reserve(request(), 'd-1');
    await port.settle(request(), 'd-1', settlement({ tokens: 4_500 }));

    const nextDay = request({ worldDay: 1 });
    expect((await port.reserve(nextDay, 'd-2')).outcome).toBe('allowed');
    expect(tables.tokenBudgetCounters).toHaveLength(2);
    expect(await counters(tables, 1)).toMatchObject({ totalTokens: 0, grantedCalls: 1 });
  });
});

describe('metering integrity is enforced by the DEPLOYED settle, not only by the double', () => {
  it('counts the mismatch and records which model actually ran', async () => {
    const tables = emptyTables();
    const port = portFor(tables);
    await port.reserve(request(), 'd-1');
    await port.settle(request(), 'd-1', settlement({ reportedModel: OTHER_MODEL }));

    expect(await counters(tables)).toMatchObject({ modelMeteringMismatches: 1 });
    // The per-decision record must say which model ran, not repeat the metered key — a row that
    // echoed the metered key would affirmatively lie about the divergence it is there to expose.
    expect((await ledger(tables))[0]).toMatchObject({ model: FAKE_SCENE_MODEL, settledModel: OTHER_MODEL });
    // Tokens stay under the METERED key, so the cap that was evaluated is the cap that is charged.
    expect((await counters(tables)).tokensByModel).toEqual([{ model: FAKE_SCENE_MODEL, tokens: 1_200 }]);
  });

  it('an honest settle counts no mismatch — the negative control', async () => {
    const tables = emptyTables();
    const port = portFor(tables);
    await port.reserve(request(), 'd-1');
    await port.settle(request(), 'd-1', settlement());

    expect(await counters(tables)).toMatchObject({ modelMeteringMismatches: 0, settledCalls: 1 });
    expect((await ledger(tables))[0]).toMatchObject({ settledModel: FAKE_SCENE_MODEL });
  });
});

describe('a GRANT is replayed verbatim; a REFUSAL is re-evaluated (M2)', () => {
  it('replays a grant without taking a second slot or writing a second row', async () => {
    const tables = emptyTables();
    const port = portFor(tables);
    const first = await port.reserve(request(), 'd-1');
    // A retried Convex mutation re-runs the whole attempt with the same decision id, and with
    // counters that have since moved.
    const replay = await port.reserve(request({ estimatedTokens: 999_999 }), 'd-1');

    expect(replay).toEqual(first);
    expect(tables.tokenBudgetLedger).toHaveLength(1);
    expect(await counters(tables)).toMatchObject({ grantedCalls: 1, inFlight: 1 });
  });

  it('a SETTLED grant is re-evaluated, so the retry\'s call is metered instead of spent silently', async () => {
    // The stale-grant hazard, on the deployed port. Replay was gated on `outcome` but not on
    // `resolution`, so a settled grant was handed back verbatim: the caller believed it held a
    // reservation, called the provider, and `settle` then no-opped via `resolvablePending`. The
    // tokens were spent and never booked — no row, no counter, nothing in the report.
    const tables = emptyTables();
    const port = portFor(tables);
    await port.reserve(request(), 'd-1');
    await port.settle(request(), 'd-1', settlement({ tokens: 1_200 }));

    const again = await port.reserve(request(), 'd-1');
    expect(again.outcome).toBe('allowed');
    // Pending again, so the NEXT settlement is accepted rather than declined as already-resolved.
    expect((await ledger(tables))[0]).toMatchObject({ resolution: 'pending', settledTokens: null });

    await port.settle(request(), 'd-1', settlement({ tokens: 900 }));

    const after = await counters(tables);
    // Two calls, two grants, two settlements, both spends booked. THE property.
    expect(after).toMatchObject({ grantedCalls: 2, settledCalls: 2, totalTokens: 2_100, inFlight: 0 });
    expect(tables.tokenBudgetLedger).toHaveLength(1);
  });

  it('a RELEASED grant is re-evaluated too: the retry after a provider failure is a new call', async () => {
    const tables = emptyTables();
    const port = portFor(tables);
    await port.reserve(request(), 'd-1');
    await port.release(request(), 'd-1');

    const again = await port.reserve(request(), 'd-1');
    expect(again.outcome).toBe('allowed');
    await port.settle(request(), 'd-1', settlement({ tokens: 900 }));

    // The released call booked nothing; the retried one books its own spend.
    expect(await counters(tables)).toMatchObject({ grantedCalls: 2, settledCalls: 1, totalTokens: 900 });
  });

  it('a PENDING grant is still replayed verbatim, so one in-flight call holds one slot', async () => {
    // The narrower situation replay is actually for: a Convex mutation retried MID-FLIGHT.
    const tables = emptyTables();
    const port = portFor(tables);
    const first = await port.reserve(request(), 'd-1');
    const replay = await port.reserve(request({ estimatedTokens: 999_999 }), 'd-1');

    expect(replay).toEqual(first);
    expect(await counters(tables)).toMatchObject({ grantedCalls: 1, inFlight: 1 });
  });

  it('a refusal does NOT become permanent: raising the cap lets the same decision id through', async () => {
    // The operator remedy. `decisionId` is derived from the scene, so an FR-K001 `run.retry`
    // re-drives the slot with the SAME id; replaying the stored refusal made the refusal
    // unclearable by any means, including raising the budget.
    const tables = emptyTables();
    seedPolicy(tables, { worldDailyTokenBudget: 1_000 });
    expect((await portFor(tables).reserve(request(), 'd-1')).outcome).toBe('over_budget');

    tables.tokenBudgetPolicies[0].worldDailyTokenBudget = 100_000;
    const retried = await portFor(tables).reserve(request(), 'd-1');

    expect(retried.outcome).toBe('allowed');
    expect(retried.boundLimit).toBeNull();
  });

  it('re-evaluating a refusal REPLACES its row, so refusedCalls keeps matching the ledger', async () => {
    const tables = emptyTables();
    seedPolicy(tables, { worldDailyTokenBudget: 1_000 });
    const port = portFor(tables);
    await port.reserve(request(), 'd-1');
    await port.reserve(request(), 'd-1');
    await port.reserve(request(), 'd-1');

    // Three operator retries, one call, one row — and one refusal in the tally. Appending instead
    // would make the §16.3 availability metric a measure of how often someone pressed retry.
    expect(tables.tokenBudgetLedger).toHaveLength(1);
    const after = await counters(tables);
    expect(after.refusedCalls).toBe(1);
    expect(after.refusedCalls).toBe((await ledger(tables)).filter((row) => row.outcome === 'over_budget').length);
  });

  it('re-evaluating a resolved GRANT leaves an unrelated refusal in the tally', async () => {
    // The two prior states need different counter transitions, and this is the case that tells
    // them apart. `reevaluateRefusal` drops one from `refusedCalls` because the row it replaced
    // stopped saying `over_budget`; applying that to a resolved GRANT would decrement a tally
    // that no row of its own contributed to, silently erasing an unrelated refusal.
    //
    // Invisible when the world has no refusals — the tally floors at 0 — so the fixture below
    // deliberately banks one first.
    const tables = emptyTables();
    seedPolicy(tables, { worldDailyTokenBudget: 1_000 });
    await portFor(tables).reserve(request(), 'd-refused');
    expect((await counters(tables)).refusedCalls).toBe(1);

    tables.tokenBudgetPolicies[0].worldDailyTokenBudget = 100_000;
    const port = portFor(tables);
    await port.reserve(request(), 'd-grant');
    await port.settle(request(), 'd-grant', settlement());

    // The retry: a resolved grant re-evaluated, with an unrelated refusal on the books.
    await portFor(tables).reserve(request(), 'd-grant');

    const after = await counters(tables);
    expect(after.refusedCalls).toBe(1);
    // The invariant M2 rests on: the tally equals the number of `over_budget` rows.
    expect(after.refusedCalls)
      .toBe((await ledger(tables)).filter((row) => row.outcome === 'over_budget').length);
    expect(after.grantedCalls).toBe(2);
  });

  it('a refusal that becomes a grant drops out of the refusal tally, matching the row it replaced', async () => {
    const tables = emptyTables();
    seedPolicy(tables, { worldDailyTokenBudget: 1_000 });
    await portFor(tables).reserve(request(), 'd-1');
    expect((await counters(tables)).refusedCalls).toBe(1);

    tables.tokenBudgetPolicies[0].worldDailyTokenBudget = 100_000;
    await portFor(tables).reserve(request(), 'd-1');

    const after = await counters(tables);
    expect(after).toMatchObject({ refusedCalls: 0, grantedCalls: 1, inFlight: 1 });
    expect(tables.tokenBudgetLedger).toHaveLength(1);
    expect((await ledger(tables))[0]).toMatchObject({ outcome: 'allowed', resolution: 'pending' });
    // And the re-granted reservation is settleable, so the retry produces a usable call.
    await portFor(tables).settle(request(), 'd-1', settlement());
    expect(await counters(tables)).toMatchObject({ settledCalls: 1, totalTokens: 1_200 });
  });
});

describe('the deployed port records the AC#5 routing decision', () => {
  it('routes low-importance work to the configured fast class and marks the row', async () => {
    const tables = emptyTables();
    seedPolicy(tables, { fastModelClass: OTHER_MODEL });
    const decision = await portFor(tables).reserve(request({ importance: 'low' }), 'd-1');

    expect(decision.model).toBe(OTHER_MODEL);
    expect(decision.onFastModel).toBe(true);
    expect((await ledger(tables))[0]).toMatchObject({
      requestedModel: FAKE_SCENE_MODEL, model: OTHER_MODEL, onFastModel: true,
      routingReason: 'low_importance_fast_model',
    });
  });

  it('a low-importance call that ALREADY names the fast class is still on the fast model', async () => {
    // The branch that used to be denied: nothing is re-routed, so `routingReason` is null — and
    // reading "did it run on the fast model" off that reported a fabricated AC#5 violation.
    const tables = emptyTables();
    seedPolicy(tables, { fastModelClass: FAKE_SCENE_MODEL });
    const decision = await portFor(tables).reserve(request({ importance: 'low' }), 'd-1');

    expect(decision.routingReason).toBeNull();
    expect(decision.onFastModel).toBe(true);
    expect((await ledger(tables))[0]).toMatchObject({ onFastModel: true, routingReason: null });
  });
});
