/**
 * FR-M003 / PRD §16.3 — the pure budget model (ART-59).
 *
 * Every assertion here is on a value, not on a log line. The five FR-M003 limits, the
 * deterministic over-budget selection, day rollover, retry accounting, the audit record, and the
 * two §16.3 ratios each have a named test below, and each of them is written so that it FAILS if
 * the property it names stops holding — the fault injections that prove this are recorded in the
 * task's implementation notes.
 *
 * The ratio tests deserve their own note. §16.3's two thresholds are ratios, and a ratio over an
 * empty sample computes 0/0 and asserts nothing. So every threshold test here builds a sample
 * with a non-empty denominator FIRST and asserts the denominator is non-empty, and the empty case
 * is asserted separately to be `null` WITH a reason rather than to be a number.
 */

import {
  BUDGET_LIMITS,
  BUDGET_ORIGINS,
  EMPTY_SAMPLE_REASONS,
  MODEL_METERING_MISMATCH_REASON,
  MAX_BUDGET_TOKENS,
  OVER_BUDGET_STRATEGIES,
  PUBLIC_READ_LLM_CALL_REASON,
  SECTION_16_3_MAX_RETRY_TOKEN_SHARE,
  SECTION_16_3_MIN_FAST_MODEL_SHARE,
  STRATEGY_FALLBACK_REASONS,
  TOKEN_BUDGET_POLICY_DEFAULTS,
  TokenBudgetError,
  WORK_IMPORTANCE_CLASSES,
  assertTokenBudgetPolicy,
  buildBudgetLedgerEntry,
  commitTokenBudgetPolicy,
  emptyBudgetCounters,
  evaluateReservation,
  grantReservation,
  hashTokenBudgetPolicy,
  isModelMeteringMismatch,
  refuseReservation,
  releaseReservation,
  resolveEffectiveTokenBudgetPolicy,
  routeModelForWork,
  selectOverBudgetStrategy,
  settleReservation,
  summarizeResourceUsage,
  tokensForModel,
  tokensForModule,
  type BudgetCounters,
  type BudgetLedgerEntry,
  type BudgetReservationRequest,
  type StoredBudgetLedgerEntry,
  type StoredTokenBudgetPolicy,
  type TokenBudgetPolicy,
  type TokenBudgetPolicyRecord,
  type TokenBudgetPolicyStore,
} from './tokenBudget';
import { FORBIDDEN_CONFIG_FIELDS } from './moduleModelConfig';

const WORLD = 'mistwood';
const MODEL = 'writer-large';
const FAST = 'writer-fast';

const policyWith = (overrides: Partial<TokenBudgetPolicy> = {}): TokenBudgetPolicy => ({
  ...TOKEN_BUDGET_POLICY_DEFAULTS,
  ...overrides,
});

const request = (overrides: Partial<BudgetReservationRequest> = {}): BudgetReservationRequest => ({
  worldId: WORLD,
  worldDay: 0,
  module: 'scene_simulation',
  requestedModel: MODEL,
  importance: 'standard',
  estimatedTokens: 100,
  attempt: 1,
  origin: 'scheduled_simulation',
  ...overrides,
});

const evaluate = (input: {
  policy?: TokenBudgetPolicy;
  moduleDailyTokenBudget?: number | null;
  counters?: BudgetCounters;
  request?: Partial<BudgetReservationRequest>;
}) => evaluateReservation({
  policy: input.policy ?? TOKEN_BUDGET_POLICY_DEFAULTS,
  moduleDailyTokenBudget: input.moduleDailyTokenBudget ?? null,
  counters: input.counters ?? emptyBudgetCounters(WORLD, 0),
  request: request(input.request),
});

/**
 * Settle `tokens` against a fresh day, the way the live path settles a granted call.
 *
 * `reportedModel` defaults to whatever `model` the caller settled under — the healthy case, where
 * the meter and the provider agree. A test that wants the two to DISAGREE says so explicitly,
 * which is the only way this helper can produce a metering mismatch.
 */
function spend(
  counters: BudgetCounters,
  tokens: number,
  overrides: Partial<Parameters<typeof settleReservation>[1]> = {},
): BudgetCounters {
  const model = overrides.model ?? MODEL;
  return settleReservation(counters, {
    module: 'scene_simulation',
    importance: 'standard',
    countedAsRetry: false,
    onFastModel: false,
    ...overrides,
    model,
    reportedModel: overrides.reportedModel ?? model,
    tokens,
  });
}

// ---------------------------------------------------------------------------
// AC#1 — the five FR-M003 limits
// ---------------------------------------------------------------------------

describe('AC#1 — an unconfigured world enforces nothing it did not before', () => {
  test('every default limit is null, so the defaults cannot quietly become a policy', () => {
    expect(TOKEN_BUDGET_POLICY_DEFAULTS).toEqual({
      worldDailyTokenBudget: null,
      modelDailyTokenBudgets: [],
      maxConcurrentCalls: null,
      retryTokenBudget: null,
      maxRetryTokenShare: null,
      fastModelClass: null,
      overBudgetStrategy: 'refuse',
    });
  });

  test('a huge request against an unconfigured world is allowed and breaches nothing', () => {
    const decision = evaluate({ request: { estimatedTokens: MAX_BUDGET_TOKENS } });
    expect(decision.outcome).toBe('allowed');
    expect(decision.breachedLimits).toEqual([]);
    expect(decision.boundLimit).toBeNull();
    expect(decision.model).toBe(MODEL);
  });
});

describe('AC#1 — daily token limit', () => {
  test('refuses the call that would take the world past its daily budget', () => {
    const counters = spend(emptyBudgetCounters(WORLD, 0), 950);
    const decision = evaluate({
      policy: policyWith({ worldDailyTokenBudget: 1_000 }),
      counters,
      request: { estimatedTokens: 51 },
    });
    expect(decision.outcome).toBe('over_budget');
    expect(decision.boundLimit).toBe('world_daily_tokens');
    expect(decision.observed.totalTokens).toBe(950);
  });

  test('allows the call that exactly fills the budget: a budget of N permits N tokens', () => {
    const counters = spend(emptyBudgetCounters(WORLD, 0), 950);
    expect(evaluate({
      policy: policyWith({ worldDailyTokenBudget: 1_000 }),
      counters,
      request: { estimatedTokens: 50 },
    }).outcome).toBe('allowed');
  });
});

describe('AC#1 — per-module limit, delegated to ART-52', () => {
  test('refuses on the module cap the caller supplies from moduleModelConfigs', () => {
    const counters = spend(emptyBudgetCounters(WORLD, 0), 400);
    const decision = evaluate({
      moduleDailyTokenBudget: 500,
      counters,
      request: { estimatedTokens: 200 },
    });
    expect(decision.boundLimit).toBe('module_daily_tokens');
    expect(decision.observed.moduleTokens).toBe(400);
  });

  test('another module\'s spend does not count against this one', () => {
    const counters = spend(emptyBudgetCounters(WORLD, 0), 900, { module: 'editorial' });
    expect(tokensForModule(counters, 'editorial')).toBe(900);
    expect(tokensForModule(counters, 'scene_simulation')).toBe(0);
    expect(evaluate({ moduleDailyTokenBudget: 500, counters }).outcome).toBe('allowed');
  });
});

describe('AC#1 — per-model limit', () => {
  test('refuses on the cap configured for the model the call will actually use', () => {
    const counters = spend(emptyBudgetCounters(WORLD, 0), 800);
    const decision = evaluate({
      policy: policyWith({ modelDailyTokenBudgets: [{ model: MODEL, dailyTokenBudget: 900 }] }),
      counters,
      request: { estimatedTokens: 200 },
    });
    expect(decision.boundLimit).toBe('model_daily_tokens');
    expect(decision.observed.modelTokens).toBe(800);
  });

  test('a model with no configured entry is uncapped', () => {
    const counters = spend(emptyBudgetCounters(WORLD, 0), 10_000, { model: 'other-model' });
    expect(tokensForModel(counters, 'other-model')).toBe(10_000);
    expect(evaluate({
      policy: policyWith({ modelDailyTokenBudgets: [{ model: MODEL, dailyTokenBudget: 900 }] }),
      counters,
      request: { requestedModel: 'other-model' },
    }).outcome).toBe('allowed');
  });

  test('the cap is checked against the ROUTED model, not the requested one', () => {
    // Low-importance work is routed to the fast class, so the fast class's own cap is what binds.
    // Checking the requested model instead would let routed traffic escape the cap it moved onto.
    const counters = spend(emptyBudgetCounters(WORLD, 0), 900, { model: FAST });
    const decision = evaluate({
      policy: policyWith({
        fastModelClass: FAST,
        modelDailyTokenBudgets: [{ model: FAST, dailyTokenBudget: 1_000 }],
      }),
      counters,
      request: { importance: 'low', estimatedTokens: 200 },
    });
    expect(decision.model).toBe(FAST);
    expect(decision.boundLimit).toBe('model_daily_tokens');
  });
});

describe('AC#1 — concurrency limit', () => {
  test('refuses the reservation that would exceed the in-flight ceiling', () => {
    const policy = policyWith({ maxConcurrentCalls: 2 });
    let counters = emptyBudgetCounters(WORLD, 0);
    counters = grantReservation(counters, evaluate({ policy, counters }));
    counters = grantReservation(counters, evaluate({ policy, counters }));
    expect(counters.inFlight).toBe(2);

    const third = evaluate({ policy, counters });
    expect(third.outcome).toBe('over_budget');
    expect(third.boundLimit).toBe('concurrency');
  });

  test('settling frees the slot, so the next reservation is granted again', () => {
    const policy = policyWith({ maxConcurrentCalls: 1 });
    let counters = grantReservation(emptyBudgetCounters(WORLD, 0), evaluate({ policy }));
    expect(evaluate({ policy, counters }).boundLimit).toBe('concurrency');
    counters = spend(counters, 100);
    expect(counters.inFlight).toBe(0);
    expect(evaluate({ policy, counters }).outcome).toBe('allowed');
  });

  test('releasing frees the slot too, so a provider failure cannot leak concurrency', () => {
    const policy = policyWith({ maxConcurrentCalls: 1 });
    let counters = grantReservation(emptyBudgetCounters(WORLD, 0), evaluate({ policy }));
    counters = releaseReservation(counters);
    expect(counters.inFlight).toBe(0);
    // A release books no tokens and no call: it did not happen.
    expect(counters.totalTokens).toBe(0);
    expect(counters.settledCalls).toBe(0);
    expect(evaluate({ policy, counters }).outcome).toBe('allowed');
  });

  test('in-flight never goes negative, so a double release cannot disable the limit', () => {
    // A negative in-flight count would make `inFlight + 1 > limit` false forever, which is a much
    // worse failure than over-counting one slot: the concurrency limit would silently stop
    // existing for the rest of the world day.
    const counters = releaseReservation(releaseReservation(emptyBudgetCounters(WORLD, 0)));
    expect(counters.inFlight).toBe(0);
  });
});

describe('AC#1 — retry budget', () => {
  test('attempt 1 is not a retry and never touches the retry budget', () => {
    const decision = evaluate({
      policy: policyWith({ retryTokenBudget: 1 }),
      request: { attempt: 1, estimatedTokens: 10_000 },
    });
    expect(decision.countedAsRetry).toBe(false);
    expect(decision.outcome).toBe('allowed');
  });

  test('attempt 2 is a retry and is refused once the absolute retry budget is exhausted', () => {
    const counters = spend(emptyBudgetCounters(WORLD, 0), 90, { countedAsRetry: true });
    expect(counters.retryTokens).toBe(90);
    const decision = evaluate({
      policy: policyWith({ retryTokenBudget: 100 }),
      counters,
      request: { attempt: 2, estimatedTokens: 20 },
    });
    expect(decision.countedAsRetry).toBe(true);
    expect(decision.boundLimit).toBe('retry_tokens');
  });

  test('retry tokens are counted into BOTH the retry total and the day total', () => {
    const counters = spend(emptyBudgetCounters(WORLD, 0), 40, { countedAsRetry: true });
    // A retry that did not count against the daily cap would let a failing world spend without
    // limit; a retry that did not count against the retry total would make §16.3 unmeasurable.
    expect(counters.retryTokens).toBe(40);
    expect(counters.totalTokens).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// AC#1 — day rollover
// ---------------------------------------------------------------------------

describe('AC#1 — day rollover is structural, not scheduled', () => {
  test('a new world day starts from zero without any rollover step', () => {
    const dayZero = spend(emptyBudgetCounters(WORLD, 0), 5_000);
    const dayOne = emptyBudgetCounters(WORLD, 1);
    expect(dayZero.totalTokens).toBe(5_000);
    expect(evaluate({
      policy: policyWith({ worldDailyTokenBudget: 5_000 }),
      counters: dayOne,
      request: { worldDay: 1, estimatedTokens: 5_000 },
    }).outcome).toBe('allowed');
  });

  test('a request evaluated against another day\'s counters is refused as a programming error', () => {
    expect(() => evaluate({
      counters: emptyBudgetCounters(WORLD, 3),
      request: { worldDay: 4 },
    })).toThrow(TokenBudgetError);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — deterministic selection
// ---------------------------------------------------------------------------

describe('AC#2 — the decision is deterministic and reports every breach', () => {
  test('the same inputs produce a byte-identical decision, evaluated twice', () => {
    const inputs = {
      policy: policyWith({ worldDailyTokenBudget: 100, retryTokenBudget: 10 }),
      moduleDailyTokenBudget: 50,
      counters: spend(emptyBudgetCounters(WORLD, 0), 90, { countedAsRetry: true }),
      request: { attempt: 2, estimatedTokens: 40 },
    };
    expect(JSON.stringify(evaluate(inputs))).toBe(JSON.stringify(evaluate(inputs)));
  });

  test('every breached limit is reported, not only the binding one', () => {
    const counters = spend(emptyBudgetCounters(WORLD, 0), 900, { countedAsRetry: true });
    const decision = evaluate({
      policy: policyWith({
        worldDailyTokenBudget: 1_000,
        retryTokenBudget: 1_000,
        modelDailyTokenBudgets: [{ model: MODEL, dailyTokenBudget: 1_000 }],
      }),
      moduleDailyTokenBudget: 1_000,
      counters,
      request: { attempt: 2, estimatedTokens: 500 },
    });
    // A caller told only about the bound limit would fix it and be refused again immediately.
    expect(decision.breachedLimits).toEqual([
      'world_daily_tokens', 'module_daily_tokens', 'model_daily_tokens', 'retry_tokens',
    ]);
    expect(decision.boundLimit).toBe('world_daily_tokens');
  });

  test('breached limits come back in BUDGET_LIMITS order whatever order they were found in', () => {
    const counters = grantReservation(
      spend(emptyBudgetCounters(WORLD, 0), 900, { countedAsRetry: true }),
      evaluate({}),
    );
    const decision = evaluate({
      policy: policyWith({
        maxConcurrentCalls: 1,
        worldDailyTokenBudget: 1_000,
        retryTokenBudget: 1_000,
      }),
      counters,
      request: { attempt: 2, estimatedTokens: 500 },
    });
    const positions = decision.breachedLimits.map((limit) => BUDGET_LIMITS.indexOf(limit));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(decision.boundLimit).toBe('concurrency');
  });
});

describe('AC#2 — the over-budget strategy is selected deterministically', () => {
  test('the configured strategy is what is selected', () => {
    for (const strategy of OVER_BUDGET_STRATEGIES) {
      const decision = evaluate({
        policy: policyWith({ overBudgetStrategy: strategy, worldDailyTokenBudget: 1, fastModelClass: FAST }),
        request: { estimatedTokens: 100 },
      });
      expect(decision.outcome).toBe('over_budget');
      expect(decision.strategy).toBe(strategy);
    }
  });

  test('a downgrade with no fast class configured falls back to refuse, and SAYS SO', () => {
    const decision = evaluate({
      policy: policyWith({ overBudgetStrategy: 'downgrade_to_fast_model', worldDailyTokenBudget: 1 }),
    });
    expect(decision.strategy).toBe('refuse');
    expect(decision.strategyFallbackReason).toBe('no_fast_model_configured');
  });

  test('a downgrade of a call already on the fast class falls back to refuse', () => {
    const decision = evaluate({
      policy: policyWith({
        overBudgetStrategy: 'downgrade_to_fast_model', worldDailyTokenBudget: 1, fastModelClass: MODEL,
      }),
    });
    expect(decision.strategy).toBe('refuse');
    expect(decision.strategyFallbackReason).toBe('already_on_fast_model');
  });

  test('a concurrency breach never downgrades: a cheaper model still occupies a slot', () => {
    const policy = policyWith({
      overBudgetStrategy: 'downgrade_to_fast_model', maxConcurrentCalls: 1, fastModelClass: FAST,
    });
    const counters = grantReservation(emptyBudgetCounters(WORLD, 0), evaluate({ policy }));
    const decision = evaluate({ policy, counters });
    expect(decision.boundLimit).toBe('concurrency');
    expect(decision.strategy).toBe('refuse');
    expect(decision.strategyFallbackReason).toBe('concurrency_is_not_relieved_by_a_cheaper_model');
  });

  test('selectOverBudgetStrategy reads no clock and no randomness: 100 calls agree', () => {
    const results = Array.from({ length: 100 }, () => JSON.stringify(selectOverBudgetStrategy(
      { overBudgetStrategy: 'downgrade_to_fast_model', fastModelClass: FAST },
      MODEL,
      ['world_daily_tokens'],
    )));
    expect(new Set(results).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC#5 — routing
// ---------------------------------------------------------------------------

describe('AC#5 — low-importance work is routed to the fast class by construction', () => {
  test('every low-importance request routes to the fast class when one is configured', () => {
    expect(routeModelForWork({ fastModelClass: FAST }, MODEL, 'low'))
      .toEqual({ model: FAST, routingReason: 'low_importance_fast_model', onFastModel: true });
  });

  test('standard work keeps its model and is not counted as fast-model work', () => {
    expect(routeModelForWork({ fastModelClass: FAST }, MODEL, 'standard'))
      .toEqual({ model: MODEL, routingReason: null, onFastModel: false });
  });

  test('with no fast class configured there is nothing to route to, and nothing is claimed', () => {
    expect(routeModelForWork({ fastModelClass: null }, MODEL, 'low'))
      .toEqual({ model: MODEL, routingReason: null, onFastModel: false });
  });

  test('a low request ALREADY on the fast class is on the fast model, with no routing reason', () => {
    // The third branch, which two docblocks used to deny existed. Nothing is re-routed — so
    // `routingReason` is null — but the call runs on the fast class all the same. Deriving
    // `onFastModel` from `routingReason !== null` reported this correctly-routed call as an AC#5
    // violation, which is the exact fabrication null-with-a-reason exists to prevent.
    expect(routeModelForWork({ fastModelClass: FAST }, FAST, 'low'))
      .toEqual({ model: FAST, routingReason: null, onFastModel: true });
  });

  test('standard work that happens to name the fast class still counts as fast-model work', () => {
    // `onFastModel` asks which model ran, not why. A standard call on the fast class is a real
    // fast-model call; it simply has no bearing on AC#5, whose denominator is low-importance work.
    expect(routeModelForWork({ fastModelClass: FAST }, FAST, 'standard'))
      .toEqual({ model: FAST, routingReason: null, onFastModel: true });
  });

  test('the decision carries onFastModel, so no caller re-derives it from routingReason', () => {
    const decision = evaluate({
      policy: policyWith({ fastModelClass: FAST }),
      request: { importance: 'low', requestedModel: FAST },
    });
    expect(decision.outcome).toBe('allowed');
    expect(decision.routingReason).toBeNull();
    expect(decision.onFastModel).toBe(true);
  });

  test('a REFUSED decision is never on any model: it ran nothing', () => {
    const decision = evaluate({
      policy: policyWith({ fastModelClass: FAST, worldDailyTokenBudget: 1 }),
      request: { importance: 'low' },
    });
    expect(decision.outcome).toBe('over_budget');
    expect(decision.onFastModel).toBe(false);
  });

  test('the importance vocabulary is exactly two classes', () => {
    expect([...WORK_IMPORTANCE_CLASSES]).toEqual(['low', 'standard']);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — the audit record
// ---------------------------------------------------------------------------

describe('AC#2 — every decision produces a durable, inspectable record', () => {
  const entry = (overrides: Partial<BudgetReservationRequest> = {}): BudgetLedgerEntry => {
    const req = request(overrides);
    return buildBudgetLedgerEntry({
      request: req,
      decision: evaluate({
        policy: policyWith({ worldDailyTokenBudget: 1, overBudgetStrategy: 'defer_to_next_world_day' }),
        request: overrides,
      }),
      decisionId: 'scene-1:budget:attempt:1',
      policyVersion: 4,
      recordedAt: 1_700_000_000_000,
    });
  };

  test('a refusal records the limit, the strategy and the counters it was measured against', () => {
    const row = entry({ estimatedTokens: 500 });
    expect(row.outcome).toBe('over_budget');
    expect(row.boundLimit).toBe('world_daily_tokens');
    expect(row.strategy).toBe('defer_to_next_world_day');
    expect(row.estimatedTokens).toBe(500);
    expect(row.policyVersion).toBe(4);
    // Counters move; a refusal explained by "the world was at N" is unreconstructable later
    // unless the snapshot travels with the decision.
    expect(row.observedTotalTokens).toBe(0);
  });

  test('the guard covers the STORED row, resolution fields included', () => {
    // `settledModel` was added to the Convex schema and the settle path but to no TypeScript type,
    // so a guard that iterates `BudgetLedgerEntry` could not see it — it was exactly "a string
    // field added later" of the kind this guard exists to catch, and it walked straight past.
    // `StoredBudgetLedgerEntry` is what closes that, and this asserts the resolution fields are
    // really in it rather than trusting the type name.
    const stored: StoredBudgetLedgerEntry = {
      ...entry(),
      resolution: 'settled',
      settledTokens: 1_200,
      settledModel: 'gpt-4o',
    };
    expect(Object.keys(stored)).toEqual(expect.arrayContaining([
      'resolution', 'settledTokens', 'settledModel',
    ]));
    // `settledModel` is a model identifier, and `resolution` is a closed enumeration — the same
    // two categories every other string on the row falls into.
    expect(['pending', 'settled', 'released']).toContain(stored.resolution);
    for (const field of FORBIDDEN_CONFIG_FIELDS) {
      expect(String(stored.settledModel).toLowerCase()).not.toContain(`${field}=`);
    }
  });

  test('every string on the record is an identifier or a closed-enum member — no free text', () => {
    // The reason this matters: `safetyStatusOverrides` and `operatorAuditLog` both carry an
    // operator `reason`, and both therefore need a credential sweep on write. This row carries no
    // reason and no prose, so there is nothing on it a secret could ride in on. Asserted
    // structurally rather than by listing field names, so a field ADDED later is caught: a new
    // string field is a failure here until it is either an identifier or an enum.
    const row = entry({ estimatedTokens: 500 });
    const identifiers = ['worldId', 'decisionId', 'module', 'requestedModel', 'model'];
    const closedEnums: Record<string, readonly string[]> = {
      importance: WORK_IMPORTANCE_CLASSES,
      origin: BUDGET_ORIGINS,
      outcome: ['allowed', 'over_budget'],
      strategy: OVER_BUDGET_STRATEGIES,
      strategyFallbackReason: STRATEGY_FALLBACK_REASONS,
      routingReason: ['low_importance_fast_model', 'over_budget_downgrade'],
      boundLimit: BUDGET_LIMITS,
    };
    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== 'string') continue;
      if (identifiers.includes(key)) continue;
      expect(closedEnums[key]).toBeDefined();
      expect(closedEnums[key]).toContain(value);
    }
    expect(row.breachedLimits.every((limit) => BUDGET_LIMITS.includes(limit))).toBe(true);
    // And the identifiers themselves cannot carry credential-shaped material past the
    // configuration write that named them.
    for (const key of identifiers) {
      for (const field of FORBIDDEN_CONFIG_FIELDS) {
        expect(String(row[key as keyof BudgetLedgerEntry]).toLowerCase()).not.toContain(`${field}=`);
      }
    }
  });

  test('an empty decision id is refused: an audit row nothing can be keyed on is not an audit row', () => {
    expect(() => buildBudgetLedgerEntry({
      request: request(), decision: evaluate({}), decisionId: '  ', policyVersion: null, recordedAt: 0,
    })).toThrow(TokenBudgetError);
  });
});

// ---------------------------------------------------------------------------
// Versioned configuration
// ---------------------------------------------------------------------------

class MemoryPolicyStore implements TokenBudgetPolicyStore {
  readonly rows: StoredTokenBudgetPolicy[] = [];
  private counter = 0;
  findCurrent(worldId: string): Promise<StoredTokenBudgetPolicy | null> {
    return Promise.resolve(this.rows.find((row) => row.worldId === worldId && row.isCurrent) ?? null);
  }
  insertVersion(row: TokenBudgetPolicyRecord): Promise<string> {
    this.counter += 1;
    const id = `row-${this.counter}`;
    this.rows.push({ ...row, id });
    return Promise.resolve(id);
  }
  demote(rowId: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === rowId);
    if (row) row.isCurrent = false;
    return Promise.resolve();
  }
}

describe('the policy is versioned, deduplicated and secret-safe', () => {
  const commit = (store: MemoryPolicyStore, policy: TokenBudgetPolicy, reason = 'why') =>
    commitTokenBudgetPolicy(store, { worldId: WORLD, policy, actor: 'ops-admin', reason, now: 1 });

  test('the first write is version 1 and a change appends version 2', async () => {
    const store = new MemoryPolicyStore();
    expect(await commit(store, policyWith({ worldDailyTokenBudget: 1_000 })))
      .toMatchObject({ version: 1, deduplicated: false });
    expect(await commit(store, policyWith({ worldDailyTokenBudget: 2_000 })))
      .toMatchObject({ version: 2, deduplicated: false });
    expect(store.rows.filter((row) => row.isCurrent)).toHaveLength(1);
    expect(store.rows).toHaveLength(2);
  });

  test('a byte-identical resubmission appends nothing', async () => {
    const store = new MemoryPolicyStore();
    const policy = policyWith({ maxConcurrentCalls: 3 });
    await commit(store, policy);
    expect(await commit(store, policy, 'a different reason'))
      .toMatchObject({ version: 1, deduplicated: true });
    expect(store.rows).toHaveLength(1);
  });

  test('the hash ignores actor and reason: a new reason for the same numbers is not a change', () => {
    expect(hashTokenBudgetPolicy(policyWith({ retryTokenBudget: 5 })))
      .toBe(hashTokenBudgetPolicy(policyWith({ retryTokenBudget: 5 })));
    expect(hashTokenBudgetPolicy(policyWith({ retryTokenBudget: 5 })))
      .not.toBe(hashTokenBudgetPolicy(policyWith({ retryTokenBudget: 6 })));
  });

  test('credential material in a model id is refused before anything is stored', async () => {
    const store = new MemoryPolicyStore();
    await expect(commit(store, policyWith({ fastModelClass: 'fast apikey=sk-live-1' })))
      .rejects.toThrow(/MODULE_CONFIG_SECRET_LEAK/u);
    expect(store.rows).toEqual([]);
  });

  test('an unreasoned write is refused (NFR-005)', async () => {
    await expect(commit(new MemoryPolicyStore(), policyWith(), '   ')).rejects.toThrow(TokenBudgetError);
  });

  test('model budgets must be sorted and duplicate-free, so the hash is stable', () => {
    expect(() => assertTokenBudgetPolicy(policyWith({
      modelDailyTokenBudgets: [{ model: 'b', dailyTokenBudget: 1 }, { model: 'a', dailyTokenBudget: 1 }],
    }))).toThrow(TokenBudgetError);
    expect(() => assertTokenBudgetPolicy(policyWith({
      modelDailyTokenBudgets: [{ model: 'a', dailyTokenBudget: 1 }, { model: 'a', dailyTokenBudget: 2 }],
    }))).toThrow(TokenBudgetError);
  });

  test('a retry share outside (0, 1] is refused', () => {
    for (const share of [0, -0.1, 1.5, Number.NaN]) {
      expect(() => assertTokenBudgetPolicy(policyWith({ maxRetryTokenShare: share })))
        .toThrow(TokenBudgetError);
    }
    expect(() => assertTokenBudgetPolicy(policyWith({ maxRetryTokenShare: 0.1 }))).not.toThrow();
  });

  test('a stored row that no longer validates resolves to the defaults, not to a throw', () => {
    // A malformed policy must not be able to stop a world simulating. It resolves to UNLIMITED
    // and says `source: 'default'`, so the fallback is visible to the operator read.
    const resolved = resolveEffectiveTokenBudgetPolicy({
      ...policyWith({ maxConcurrentCalls: -5 }), version: 7,
    });
    expect(resolved.source).toBe('default');
    expect(resolved.version).toBeNull();
    expect(resolved.maxConcurrentCalls).toBeNull();
  });

  test('a world with no row resolves to the documented defaults', () => {
    expect(resolveEffectiveTokenBudgetPolicy(null))
      .toEqual({ source: 'default', version: null, ...TOKEN_BUDGET_POLICY_DEFAULTS });
  });
});

// ---------------------------------------------------------------------------
// AC#4 — §16.3 retry token share
// ---------------------------------------------------------------------------

describe('AC#4 — §16.3 retry tokens must not exceed 10% of total', () => {
  const report = (input: { counters: BudgetCounters[]; policy?: Partial<TokenBudgetPolicy> }) =>
    summarizeResourceUsage({
      worldId: WORLD,
      policy: policyWith(input.policy),
      counters: input.counters,
      ledger: [],
    });

  test('the threshold is the PRD number', () => {
    expect(SECTION_16_3_MAX_RETRY_TOKEN_SHARE).toBe(0.1);
  });

  test('measures the share over a NON-EMPTY sample and passes at 5%', () => {
    let counters = spend(emptyBudgetCounters(WORLD, 0), 950);
    counters = spend(counters, 50, { countedAsRetry: true });
    const result = report({ counters: [counters] });
    // Assert the denominator FIRST: a ratio over an empty sample asserts nothing.
    expect(result.totalTokens).toBe(1_000);
    expect(result.retryTokens).toBe(50);
    expect(result.retryTokenShare).toBeCloseTo(0.05, 10);
    expect(result.retryTokenShareCompliant).toBe(true);
  });

  test('FAILS the threshold at 20%: the assertion is capable of failing', () => {
    let counters = spend(emptyBudgetCounters(WORLD, 0), 800);
    counters = spend(counters, 200, { countedAsRetry: true });
    const result = report({ counters: [counters] });
    expect(result.totalTokens).toBe(1_000);
    expect(result.retryTokenShare).toBeCloseTo(0.2, 10);
    expect(result.retryTokenShareCompliant).toBe(false);
  });

  test('exactly 10% is compliant: the PRD says "not exceeding"', () => {
    let counters = spend(emptyBudgetCounters(WORLD, 0), 900);
    counters = spend(counters, 100, { countedAsRetry: true });
    expect(report({ counters: [counters] }).retryTokenShareCompliant).toBe(true);
  });

  test('an empty sample reports null WITH a reason, never 0 and never 0/0', () => {
    const result = report({ counters: [emptyBudgetCounters(WORLD, 0)] });
    expect(result.totalTokens).toBe(0);
    expect(result.retryTokenShare).toBeNull();
    expect(result.retryTokenShareCompliant).toBeNull();
    expect(result.retryTokenShareReason).toBe(EMPTY_SAMPLE_REASONS.retryTokenShare);
  });

  test('the share is ENFORCEABLE: a configured ceiling refuses the retry that would breach it', () => {
    // 900 spent, none of it retried. A 200-token retry would make the share 200/1100 = 18%.
    const counters = spend(emptyBudgetCounters(WORLD, 0), 900);
    const decision = evaluate({
      policy: policyWith({ maxRetryTokenShare: SECTION_16_3_MAX_RETRY_TOKEN_SHARE }),
      counters,
      request: { attempt: 2, estimatedTokens: 200 },
    });
    expect(decision.boundLimit).toBe('retry_token_share');
    expect(report({ counters: [counters], policy: { maxRetryTokenShare: 0.1 } }).retryTokenShareEnforced)
      .toBe(true);
  });

  test('a retry that keeps the share under the ceiling is granted', () => {
    const counters = spend(emptyBudgetCounters(WORLD, 0), 900);
    // 50/950 = 5.3%.
    expect(evaluate({
      policy: policyWith({ maxRetryTokenShare: 0.1 }),
      counters,
      request: { attempt: 2, estimatedTokens: 50 },
    }).outcome).toBe('allowed');
  });

  test('the ceiling is unset by default, and the report says the threshold is only measured', () => {
    // A share ceiling has an unavoidable bootstrap: at the start of a day total spend is 0, so
    // the first retry always computes a share of 1.0. Defaulting it on would turn "retry once
    // after a transient provider failure" into a refusal.
    expect(TOKEN_BUDGET_POLICY_DEFAULTS.maxRetryTokenShare).toBeNull();
    expect(report({ counters: [spend(emptyBudgetCounters(WORLD, 0), 10)] }).retryTokenShareEnforced)
      .toBe(false);
    expect(evaluate({ request: { attempt: 2, estimatedTokens: 999 } }).outcome).toBe('allowed');
  });
});

// ---------------------------------------------------------------------------
// AC#5 — §16.3 fast-model routing share
// ---------------------------------------------------------------------------

describe('AC#5 — §16.3 fast-model routing share above 80%', () => {
  const withLowImportance = (calls: number, onFast: number): BudgetCounters => {
    let counters = emptyBudgetCounters(WORLD, 0);
    for (let index = 0; index < calls; index += 1) {
      counters = spend(counters, 10, {
        importance: 'low',
        model: index < onFast ? FAST : MODEL,
        onFastModel: index < onFast,
      });
    }
    return counters;
  };
  const report = (counters: BudgetCounters) => summarizeResourceUsage({
    worldId: WORLD,
    policy: policyWith({ fastModelClass: FAST }),
    counters: [counters],
    ledger: [],
  });

  test('the threshold is the PRD number', () => {
    expect(SECTION_16_3_MIN_FAST_MODEL_SHARE).toBe(0.8);
  });

  test('measures the share over a NON-EMPTY sample and passes at 100%', () => {
    const result = report(withLowImportance(10, 10));
    expect(result.lowImportanceCalls).toBe(10);
    expect(result.fastModelRoutingShare).toBe(1);
    expect(result.fastModelRoutingShareCompliant).toBe(true);
  });

  test('FAILS the threshold at 70%: the assertion is capable of failing', () => {
    const result = report(withLowImportance(10, 7));
    expect(result.lowImportanceCalls).toBe(10);
    expect(result.fastModelRoutingShare).toBeCloseTo(0.7, 10);
    expect(result.fastModelRoutingShareCompliant).toBe(false);
  });

  test('exactly 80% FAILS: the PRD says "higher than 80%", not "at least"', () => {
    const result = report(withLowImportance(10, 8));
    expect(result.fastModelRoutingShare).toBeCloseTo(0.8, 10);
    expect(result.fastModelRoutingShareCompliant).toBe(false);
  });

  test('an empty denominator reports null WITH the honest reason, never 1 and never 0', () => {
    const result = report(spend(emptyBudgetCounters(WORLD, 0), 500));
    expect(result.lowImportanceCalls).toBe(0);
    expect(result.fastModelRoutingShare).toBeNull();
    expect(result.fastModelRoutingShareCompliant).toBeNull();
    expect(result.fastModelRoutingShareReason).toBe(EMPTY_SAMPLE_REASONS.fastModelRoutingShare);
    expect(result.fastModelRoutingShareReason).toContain('MAX_MAJOR_SCENES_PER_SLOT');
  });

  test('low-importance work with no fast class configured reports null with its OWN reason', () => {
    const result = summarizeResourceUsage({
      worldId: WORLD,
      policy: policyWith({ fastModelClass: null }),
      counters: [withLowImportance(5, 0)],
      ledger: [],
    });
    expect(result.lowImportanceCalls).toBe(5);
    expect(result.fastModelRoutingShare).toBeNull();
    expect(result.fastModelRoutingShareReason).toBe(EMPTY_SAMPLE_REASONS.fastModelClassUnconfigured);
  });

  test('the routing rule makes 100% the only reachable share for a metered path', () => {
    // Not a measurement of traffic: a property of the router. Every `low` request ends up on the
    // fast class, so a run in which low-importance work exists AND a fast class is configured
    // cannot produce a share below 1 unless `routeModelForWork` itself changes.
    //
    // The generator INCLUDES `FAST` itself. An earlier version drew from `model-${index}`, none of
    // which can equal the fast class — so it excluded the single input that breaks the property
    // (a request already naming the fast class takes the no-switch branch) and proved nothing
    // about it. A universal claim tested only over inputs chosen to satisfy it is not evidence.
    const requested = [FAST, MODEL, ...Array.from({ length: 48 }, (_, index) => `model-${index}`)];
    const routed = requested.map((model) => routeModelForWork({ fastModelClass: FAST }, model, 'low'));
    expect(routed.every((entry) => entry.model === FAST)).toBe(true);
    // And every one of them counts toward the AC#5 numerator, including the no-switch branch.
    expect(routed.every((entry) => entry.onFastModel)).toBe(true);
    expect(requested).toContain(FAST);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — the rest of the §16.3 report
// ---------------------------------------------------------------------------

describe('AC#3 — public-read LLM calls are structurally zero and provably so', () => {
  test('the origin vocabulary declares no public-read origin', () => {
    // Pinned exhaustively: adding a public-read origin has to be a deliberate edit here, and
    // that is what keeps the zero below a PROOF rather than an assumption.
    expect([...BUDGET_ORIGINS]).toEqual(['scheduled_simulation', 'operator_command']);
  });

  test('the report counts zero and states why, referencing the guarantee suite', () => {
    const result = summarizeResourceUsage({
      worldId: WORLD, policy: policyWith(), counters: [], ledger: [],
    });
    expect(result.publicReadLlmCalls).toBe(0);
    expect(result.publicReadLlmCallsReason).toBe(PUBLIC_READ_LLM_CALL_REASON);
    expect(result.publicReadLlmCallsReason).toContain('publicReadOnlyGuarantee.test.ts');
  });
});

describe('metering integrity — the ART-72 landmine, detected at runtime', () => {
  const report = (counters: BudgetCounters) => summarizeResourceUsage({
    worldId: WORLD, policy: policyWith(), counters: [counters], ledger: [],
  });

  test('a healthy settlement, where the meter and the provider agree, counts no mismatch', () => {
    const counters = spend(emptyBudgetCounters(WORLD, 0), 500);
    expect(counters.settledCalls).toBe(1);
    expect(counters.modelMeteringMismatches).toBe(0);
    // Reported as null rather than as an empty string: there is nothing to explain.
    expect(report(counters).modelMeteringMismatches).toBe(0);
    expect(report(counters).modelMeteringMismatchReason).toBeNull();
  });

  test('booking against a model the provider did not run is counted and explained', () => {
    // This is the ART-72 shape exactly: the meter keys on the fake author while a real model ran.
    const counters = spend(emptyBudgetCounters(WORLD, 0), 500, {
      model: 'fake-whole-scene-v1',
      reportedModel: 'gpt-4o',
    });
    expect(isModelMeteringMismatch({
      module: 'scene_simulation', model: 'fake-whole-scene-v1', reportedModel: 'gpt-4o',
      importance: 'standard', tokens: 500, countedAsRetry: false, onFastModel: false,
    })).toBe(true);
    expect(counters.modelMeteringMismatches).toBe(1);

    const result = report(counters);
    expect(result.modelMeteringMismatches).toBe(1);
    // The number is only actionable if the reader is told the known cause.
    expect(result.modelMeteringMismatchReason).toBe(MODEL_METERING_MISMATCH_REASON);
    expect(result.modelMeteringMismatchReason).toContain('ART-72');
    expect(result.modelMeteringMismatchReason).toContain('sceneBudgetProviderPin.test.ts');
  });

  test('the tokens are still booked under the METERED key, so the cap stays coherent', () => {
    // Counting the mismatch must not also move the spend to the other bucket: the cap that was
    // evaluated is the cap that has to be charged, or the reservation and the settlement would
    // disagree about which limit they were about.
    const counters = spend(emptyBudgetCounters(WORLD, 0), 500, {
      model: MODEL, reportedModel: 'something-else',
    });
    expect(tokensForModel(counters, MODEL)).toBe(500);
    expect(tokensForModel(counters, 'something-else')).toBe(0);
  });

  test('a mismatch is never thrown: a pinned model revision is legitimate', () => {
    // `gpt-4o` -> `gpt-4o-2024-08-06` is a gateway answering honestly. Throwing would take the
    // world down over a naming convention; counting it surfaces the divergence without doing so.
    expect(() => spend(emptyBudgetCounters(WORLD, 0), 10, {
      model: 'gpt-4o', reportedModel: 'gpt-4o-2024-08-06',
    })).not.toThrow();
  });
});

describe('AC#3 — availability under refusal, and daily cap compliance', () => {
  const ledgerRow = (overrides: Partial<BudgetLedgerEntry>): BudgetLedgerEntry => ({
    ...buildBudgetLedgerEntry({
      request: request(),
      decision: evaluate({ policy: policyWith({ worldDailyTokenBudget: 1 }) }),
      decisionId: 'd-1',
      policyVersion: null,
      recordedAt: 1,
    }),
    ...overrides,
  });

  test('refusals are counted per limit, with every limit present so a zero is measured', () => {
    const result = summarizeResourceUsage({
      worldId: WORLD,
      policy: policyWith(),
      counters: [refuseReservation(refuseReservation(emptyBudgetCounters(WORLD, 0)))],
      ledger: [
        ledgerRow({ decisionId: 'a', boundLimit: 'world_daily_tokens', strategy: 'refuse' }),
        ledgerRow({ decisionId: 'b', boundLimit: 'concurrency', strategy: 'refuse' }),
      ],
    });
    expect(result.refusedCalls).toBe(2);
    expect(Object.keys(result.refusedByLimit).sort()).toEqual([...BUDGET_LIMITS].sort());
    expect(result.refusedByLimit.world_daily_tokens).toBe(1);
    expect(result.refusedByLimit.concurrency).toBe(1);
    expect(result.refusedByLimit.retry_tokens).toBe(0);
    expect(result.refusalsByStrategy.refuse).toBe(2);
  });

  test('daily cap compliance is measured per world day and names the days over cap', () => {
    const result = summarizeResourceUsage({
      worldId: WORLD,
      policy: policyWith({ worldDailyTokenBudget: 1_000 }),
      counters: [
        spend(emptyBudgetCounters(WORLD, 0), 900),
        spend(emptyBudgetCounters(WORLD, 1), 1_500),
        spend(emptyBudgetCounters(WORLD, 2), 200),
      ],
      ledger: [],
    });
    expect(result.worldDays).toEqual([0, 1, 2]);
    expect(result.maxObservedDailyTokens).toBe(1_500);
    expect(result.worldDaysOverCap).toEqual([1]);
    expect(result.dailyCapCompliant).toBe(false);
  });

  test('with no cap configured, compliance is null with a reason, not true', () => {
    // "Complied with no limit" and "complied with a limit" are different statements and a
    // dashboard cannot tell a green tick apart from a missing one.
    const result = summarizeResourceUsage({
      worldId: WORLD,
      policy: policyWith(),
      counters: [spend(emptyBudgetCounters(WORLD, 0), 10_000_000)],
      ledger: [],
    });
    expect(result.dailyCapCompliant).toBeNull();
    expect(result.dailyCapReason).toBe(EMPTY_SAMPLE_REASONS.dailyCap);
  });
});
