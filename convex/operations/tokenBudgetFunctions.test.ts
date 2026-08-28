/**
 * The authorized FR-M003 budget surface (ART-59).
 *
 * Handler-level, following the pattern `moduleModelConfigFunctions.test.ts` and
 * `safetyOverrideFunctions.test.ts` established: the registered `mutation`/`query`'s `_handler`
 * runs against a hand-rolled in-memory `ctx`, so the gate, the versioned append and the audit row
 * are exercised as they actually run rather than as they are declared.
 *
 * The unauthenticated cases use a `ctx` whose database THROWS on any access. That is the only way
 * to assert "authorize first" as a fact: a denial test against a working database proves the
 * caller got an error, not that the handler refused before it read anything.
 */

import {
  TOKEN_BUDGET_POLICY_DEFAULTS,
  type TokenBudgetPolicy,
} from '../shared/tokenBudget';
import { OPS_CAPABILITY_MINIMUM_ROLE, OPS_UNAUTHORIZED } from './operatorAuthorization';
import {
  describeTokenBudgetDefaults,
  inspectTokenBudget,
  listTokenBudgetLedger,
  setTokenBudgetPolicy,
} from './tokenBudgetFunctions';

const WORLD_ID = 'mistwood';
const NOW = 1_700_000_000_000;
const REASON = 'cap the festival arc while the provider quota is halved';

type Registered = {
  isMutation?: boolean;
  isQuery?: boolean;
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const write = setTokenBudgetPolicy as unknown as Registered;
const inspect = inspectTokenBudget as unknown as Registered;
const ledger = listTokenBudgetLedger as unknown as Registered;
const defaults = describeTokenBudgetDefaults as unknown as Registered;

const REGISTRY = JSON.stringify([
  { operatorId: 'op-admin', role: 'admin', subjects: [], token: 'correct-horse-battery-staple' },
  { operatorId: 'op-plain', role: 'operator', subjects: [], token: 'a-different-long-token-value' },
  { operatorId: 'op-read', role: 'viewer', subjects: [], token: 'a-third-distinct-token-value' },
]);

const ADMIN = { operatorId: 'op-admin', operatorToken: 'correct-horse-battery-staple' };
const OPERATOR = { operatorId: 'op-plain', operatorToken: 'a-different-long-token-value' };
const VIEWER = { operatorId: 'op-read', operatorToken: 'a-third-distinct-token-value' };

type Row = Record<string, unknown>;
type Tables = {
  tokenBudgetPolicies: Row[];
  tokenBudgetCounters: Row[];
  tokenBudgetLedger: Row[];
  moduleModelConfigs: Row[];
  operatorAuditLog: Row[];
};

/** The slice of Convex these handlers use. Index constraints are `eq` chains. */
function memoryCtx(tables: Tables) {
  const db = {
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
  return { auth: { getUserIdentity: () => Promise.resolve(null) }, db };
}

function anonymousCtx() {
  return {
    auth: { getUserIdentity: () => Promise.resolve(null) },
    db: new Proxy({}, {
      get(_target, property) {
        throw new Error(`unauthorized caller reached the database: .${String(property)}`);
      },
    }),
  };
}

const emptyTables = (): Tables => ({
  tokenBudgetPolicies: [], tokenBudgetCounters: [], tokenBudgetLedger: [],
  moduleModelConfigs: [], operatorAuditLog: [],
});

const writeArgs = (over: Partial<TokenBudgetPolicy> & Row = {}) => ({
  ...ADMIN,
  worldId: WORLD_ID,
  reason: REASON,
  ...TOKEN_BUDGET_POLICY_DEFAULTS,
  now: NOW,
  ...over,
});

const withRegistry = () => {
  const prior = process.env.SIMULATION_OPS_OPERATORS;
  const priorIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
  beforeEach(() => {
    process.env.SIMULATION_OPS_OPERATORS = REGISTRY;
    delete process.env.CLERK_JWT_ISSUER_DOMAIN;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.SIMULATION_OPS_OPERATORS;
    else process.env.SIMULATION_OPS_OPERATORS = prior;
    if (priorIssuer === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
    else process.env.CLERK_JWT_ISSUER_DOMAIN = priorIssuer;
  });
};

// ---------------------------------------------------------------------------

describe('setTokenBudgetPolicy', () => {
  withRegistry();

  it('appends a versioned policy and audits it in the same transaction', async () => {
    const tables = emptyTables();
    const result = await write._handler(memoryCtx(tables), writeArgs({ worldDailyTokenBudget: 500_000 }));

    expect(result).toMatchObject({ version: 1, deduplicated: false });
    expect(tables.tokenBudgetPolicies).toHaveLength(1);
    expect(tables.tokenBudgetPolicies[0]).toMatchObject({
      worldId: WORLD_ID, version: 1, worldDailyTokenBudget: 500_000, isCurrent: true,
      actor: 'op-admin', reason: REASON, createdAt: NOW,
    });
    expect(tables.operatorAuditLog).toHaveLength(1);
    expect(tables.operatorAuditLog[0]).toMatchObject({
      capability: 'budget.write', outcome: 'applied', target: 'budget:v1',
    });
  });

  it('appends version 2 and demotes version 1, never editing it', async () => {
    const tables = emptyTables();
    const ctx = memoryCtx(tables);
    await write._handler(ctx, writeArgs({ worldDailyTokenBudget: 500_000 }));
    await write._handler(ctx, writeArgs({ worldDailyTokenBudget: 100_000 }));

    expect(tables.tokenBudgetPolicies.map((row) => row.version)).toEqual([1, 2]);
    // The old row keeps its numbers. A budget history that rewrote itself could not answer
    // "what was this world allowed to spend last Tuesday".
    expect(tables.tokenBudgetPolicies[0]).toMatchObject({ worldDailyTokenBudget: 500_000, isCurrent: false });
    expect(tables.tokenBudgetPolicies[1]).toMatchObject({ worldDailyTokenBudget: 100_000, isCurrent: true });
  });

  it('deduplicates an unchanged resubmission, and still audits the no-op', async () => {
    const tables = emptyTables();
    const ctx = memoryCtx(tables);
    await write._handler(ctx, writeArgs({ maxConcurrentCalls: 4 }));
    const repeat = await write._handler(ctx, writeArgs({ maxConcurrentCalls: 4, reason: 'a different reason' }));

    expect(repeat).toMatchObject({ version: 1, deduplicated: true });
    expect(tables.tokenBudgetPolicies).toHaveLength(1);
    // An operator pressing save on an unchanged form is part of the account of what happened.
    expect(tables.operatorAuditLog).toHaveLength(2);
    expect(tables.operatorAuditLog[1]).toMatchObject({ outcome: 'no_op', resultCode: 'OPS_NO_OP' });
  });

  it('refuses an unknown over-budget strategy before storing anything', async () => {
    const tables = emptyTables();
    // Cast because the argument validator declares `v.string()` — the enumeration is owned by the
    // pure model, and this asserts the HANDLER refuses a value the validator would let through.
    await expect(write._handler(memoryCtx(tables), { ...writeArgs(), overBudgetStrategy: 'panic' }))
      .rejects.toThrow(/TOKEN_BUDGET_INVALID/u);
    expect(tables.tokenBudgetPolicies).toEqual([]);
  });

  it('refuses an invalid policy before storing anything', async () => {
    const tables = emptyTables();
    await expect(write._handler(memoryCtx(tables), writeArgs({ maxRetryTokenShare: 1.5 })))
      .rejects.toThrow(/TOKEN_BUDGET_INVALID/u);
    expect(tables.tokenBudgetPolicies).toEqual([]);
  });

  it('is admin-only: an operator and a viewer are both refused', async () => {
    for (const credentials of [OPERATOR, VIEWER]) {
      await expect(write._handler(anonymousCtx(), { ...writeArgs(), ...credentials }))
        .rejects.toThrow(OPS_UNAUTHORIZED);
    }
    expect(OPS_CAPABILITY_MINIMUM_ROLE['budget.write']).toBe('admin');
  });

  it('refuses an unauthenticated caller BEFORE reading any row', async () => {
    // The database proxy throws on any access, so reaching it at all fails with a different
    // message than the gate's.
    await expect(write._handler(anonymousCtx(), { worldId: WORLD_ID, reason: REASON, ...TOKEN_BUDGET_POLICY_DEFAULTS }))
      .rejects.toThrow(OPS_UNAUTHORIZED);
  });
});

describe('inspectTokenBudget', () => {
  withRegistry();

  it('reports the effective policy, the day counters and the §16.3 report', async () => {
    const tables = emptyTables();
    const ctx = memoryCtx(tables);
    await write._handler(ctx, writeArgs({ worldDailyTokenBudget: 1_000 }));
    tables.tokenBudgetCounters.push({
      schemaVersion: 1, worldId: WORLD_ID, worldDay: 0, totalTokens: 900, retryTokens: 45,
      tokensByModule: [{ module: 'scene_simulation', tokens: 900 }],
      tokensByModel: [{ model: 'writer', tokens: 900 }],
      inFlight: 0, grantedCalls: 3, settledCalls: 3, refusedCalls: 0,
      lowImportanceCalls: 0, lowImportanceCallsOnFastModel: 0,
    });

    const result = await inspect._handler(ctx, {
      ...VIEWER, worldId: WORLD_ID, fromWorldDay: 0, toWorldDay: 0,
    }) as Record<string, Record<string, unknown>>;

    expect(result.policy).toMatchObject({ source: 'configured', version: 1, worldDailyTokenBudget: 1_000 });
    expect(result.counters).toHaveLength(1);
    expect(result.report).toMatchObject({
      totalTokens: 900, retryTokens: 45, dailyCapCompliant: true, worldDaysOverCap: [],
    });
    // The retry share is a real ratio over a non-empty denominator: 45/900 = 5%.
    expect(result.report.retryTokenShare).toBeCloseTo(0.05, 10);
    expect(result.report.retryTokenShareCompliant).toBe(true);
  });

  it('shows ART-52\'s per-module caps beside the world policy rather than folded into it', async () => {
    const tables = emptyTables();
    const result = await inspect._handler(memoryCtx(tables), {
      ...VIEWER, worldId: WORLD_ID, fromWorldDay: 0, toWorldDay: 0,
    }) as { moduleDailyTokenBudgets: Array<{ module: string; dailyTokenBudget: number | null }> };

    // One entry per configurable module, including modules with no row — reporting only the
    // configured ones would read as "scene simulation is the only module", which is false.
    expect(result.moduleDailyTokenBudgets.map(({ module }) => module))
      .toEqual(['scene_simulation', 'director_plan', 'character_intent', 'editorial']);
    expect(result.moduleDailyTokenBudgets.every(({ dailyTokenBudget }) => dailyTokenBudget === null)).toBe(true);
  });

  it('a world day with no counter row is reported as zero, not omitted', async () => {
    // A quiet day and a day outside the window are different things.
    const result = await inspect._handler(memoryCtx(emptyTables()), {
      ...VIEWER, worldId: WORLD_ID, fromWorldDay: 0, toWorldDay: 2,
    }) as { counters: Array<{ worldDay: number; totalTokens: number }> };
    expect(result.counters.map(({ worldDay }) => worldDay)).toEqual([0, 1, 2]);
    expect(result.counters.every(({ totalTokens }) => totalTokens === 0)).toBe(true);
  });

  it('clamps a huge range and REPORTS the clamp instead of truncating silently', async () => {
    const result = await inspect._handler(memoryCtx(emptyTables()), {
      ...VIEWER, worldId: WORLD_ID, fromWorldDay: 0, toWorldDay: 5_000,
    }) as { clampedToWorldDay: number | null; counters: unknown[] };
    expect(result.counters).toHaveLength(90);
    expect(result.clampedToWorldDay).toBe(89);
  });

  it('bounds the ledger fan-out across the whole range, and reports when it truncated', async () => {
    // A Convex query refuses to read more than 16,384 documents. Fanning MAX_LEDGER_LIMIT (500)
    // over 90 world days asks for 45,000, so a wide inspect on a busy world used to THROW rather
    // than answer. The budget is total across the range, and truncation is REPORTED — a partial
    // refusal count is a different statement from a complete one.
    const tables = emptyTables();
    for (let worldDay = 0; worldDay < 3; worldDay += 1) {
      for (let index = 0; index < 4_000; index += 1) {
        tables.tokenBudgetLedger.push({
          schemaVersion: 1, worldId: WORLD_ID, worldDay, decisionId: `d-${worldDay}-${index}`,
          module: 'scene_simulation', requestedModel: 'writer', model: 'writer',
          importance: 'standard', origin: 'scheduled_simulation', attempt: 1, countedAsRetry: false,
          estimatedTokens: 4_000, onFastModel: false, outcome: 'over_budget', strategy: 'refuse',
          strategyFallbackReason: null, routingReason: null, boundLimit: 'world_daily_tokens',
          breachedLimits: ['world_daily_tokens'], observedTotalTokens: 0, observedRetryTokens: 0,
          observedModuleTokens: 0, observedModelTokens: 0, observedInFlight: 0, policyVersion: null,
          recordedAt: NOW, resolution: 'settled', settledTokens: 0, settledModel: null,
        });
      }
    }

    const result = await inspect._handler(memoryCtx(tables), {
      ...VIEWER, worldId: WORLD_ID, fromWorldDay: 0, toWorldDay: 2,
    }) as { ledgerScanLimitReached: boolean; report: { refusedByLimit: Record<string, number> } };

    expect(result.ledgerScanLimitReached).toBe(true);
    // It still answers, over the prefix it did read, rather than throwing.
    expect(result.report.refusedByLimit.world_daily_tokens).toBe(8_000);
  });

  it('a range within the budget reports no truncation — the negative control', async () => {
    const result = await inspect._handler(memoryCtx(emptyTables()), {
      ...VIEWER, worldId: WORLD_ID, fromWorldDay: 0, toWorldDay: 2,
    }) as { ledgerScanLimitReached: boolean };
    expect(result.ledgerScanLimitReached).toBe(false);
  });

  it('refuses a descending range rather than returning an empty report', async () => {
    await expect(inspect._handler(memoryCtx(emptyTables()), {
      ...VIEWER, worldId: WORLD_ID, fromWorldDay: 5, toWorldDay: 1,
    })).rejects.toThrow(/TOKEN_BUDGET_INVALID/u);
  });

  it('is viewer-readable but never anonymous', async () => {
    expect(OPS_CAPABILITY_MINIMUM_ROLE['budget.inspect']).toBe('viewer');
    await expect(inspect._handler(anonymousCtx(), { worldId: WORLD_ID, fromWorldDay: 0, toWorldDay: 0 }))
      .rejects.toThrow(OPS_UNAUTHORIZED);
  });
});

describe('listTokenBudgetLedger', () => {
  withRegistry();

  const row = (decisionId: string): Row => ({
    schemaVersion: 1, worldId: WORLD_ID, worldDay: 0, decisionId,
    module: 'scene_simulation', requestedModel: 'writer', model: 'writer',
    importance: 'standard', origin: 'scheduled_simulation', attempt: 1, countedAsRetry: false,
    estimatedTokens: 4_000, outcome: 'over_budget', strategy: 'refuse', strategyFallbackReason: null,
    routingReason: null, boundLimit: 'world_daily_tokens', breachedLimits: ['world_daily_tokens'],
    observedTotalTokens: 900, observedRetryTokens: 0, observedModuleTokens: 900,
    observedModelTokens: 900, observedInFlight: 0, policyVersion: 1, recordedAt: NOW,
    resolution: 'settled', settledTokens: 0,
  });

  it('returns the world day\'s decisions with their limits and counter snapshots', async () => {
    const tables = emptyTables();
    tables.tokenBudgetLedger.push(row('d-1'), row('d-2'));
    const result = await ledger._handler(memoryCtx(tables), { ...VIEWER, worldId: WORLD_ID, worldDay: 0 }) as
      { entries: Array<Record<string, unknown>>; truncated: boolean };

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      boundLimit: 'world_daily_tokens', strategy: 'refuse', observedTotalTokens: 900, policyVersion: 1,
    });
    expect(result.truncated).toBe(false);
  });

  it('reports truncation rather than leaving a caller to infer it from the row count', async () => {
    // A caller cannot tell a day with exactly `limit` decisions from a day with more.
    const tables = emptyTables();
    tables.tokenBudgetLedger.push(row('d-1'), row('d-2'), row('d-3'));
    const result = await ledger._handler(memoryCtx(tables), {
      ...VIEWER, worldId: WORLD_ID, worldDay: 0, limit: 2,
    }) as { entries: unknown[]; truncated: boolean };

    expect(result.entries).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('refuses an unauthenticated caller before reading any row', async () => {
    await expect(ledger._handler(anonymousCtx(), { worldId: WORLD_ID, worldDay: 0 }))
      .rejects.toThrow(OPS_UNAUTHORIZED);
  });
});

describe('describeTokenBudgetDefaults', () => {
  withRegistry();

  it('returns the documented defaults, so a console can show what unconfigured means', async () => {
    const result = await defaults._handler(memoryCtx(emptyTables()), { ...VIEWER, worldId: WORLD_ID });
    expect(result).toEqual({ defaults: TOKEN_BUDGET_POLICY_DEFAULTS });
  });

  it('is not anonymously enumerable', async () => {
    await expect(defaults._handler(anonymousCtx(), { worldId: WORLD_ID })).rejects.toThrow(OPS_UNAUTHORIZED);
  });
});
