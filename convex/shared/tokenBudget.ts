/**
 * Token budget, rate and concurrency ENFORCEMENT (FR-M003, PRD §16.3, ART-59).
 *
 * ## The ART-52 boundary
 *
 * ART-52 (FR-K005) shipped the CONFIGURATION layer and said so in its own header: the eight
 * per-module settings are "stored, versioned, authorized, audited and readable — and nothing
 * here spends, meters, or switches on them". This module is the other half. It does not
 * restate any setting ART-52 already owns:
 *
 * | FR-M003 dimension  | Where the limit comes from                                        |
 * | ------------------ | ----------------------------------------------------------------- |
 * | 每模組上限          | ART-52's `dailyTokenBudget`, read through `EffectiveModuleConfig`  |
 * | 每日 Token 上限     | {@link TokenBudgetPolicy.worldDailyTokenBudget} (world-level)      |
 * | 每模型上限          | {@link TokenBudgetPolicy.modelDailyTokenBudgets}                   |
 * | 最大並行數          | {@link TokenBudgetPolicy.maxConcurrentCalls}                       |
 * | Retry 預算          | {@link TokenBudgetPolicy.retryTokenBudget} (+ the §16.3 share)     |
 * | 超額降級策略        | {@link TokenBudgetPolicy.overBudgetStrategy}                       |
 *
 * The per-module cap is DELEGATED, not copied. {@link evaluateReservation} takes it as a
 * parameter (`moduleDailyTokenBudget`) supplied by the caller from ART-52's resolver, so there
 * is exactly one place in the system that answers "what is this module's daily budget" and a
 * console change to it takes effect here without a second write. The other five dimensions have
 * no home in a per-module row — `maxConcurrentCalls` is world-wide and a per-MODEL cap is keyed
 * on a model id, not a module — so they need a record of their own, and that record reuses
 * ART-52's exact versioning protocol rather than inventing a second one.
 *
 * ## What this module does NOT own
 *
 * The ORDER in which a degraded system falls back — same model, then compatible model, then
 * fewer scenes (FR-M004) — is ART-91, which depends on this task. This module selects a
 * strategy and records the selection; it does not implement a ladder. `downgrade_to_fast_model`
 * is the one degrading strategy here and it is a single hop to a configured model class, not an
 * ordering.
 *
 * ## Determinism (AC#2)
 *
 * {@link evaluateReservation} is a pure function of (policy, module budget, counters, request).
 * No clock, no randomness, no I/O — `now` is only ever a parameter of the versioned write, the
 * way `commitModuleModelConfig` takes it. The limits are checked in the fixed {@link BUDGET_LIMITS}
 * order and the FIRST breach in that order is the `boundLimit`, so two evaluations of the same
 * inputs name the same limit and select the same strategy. Every breach is reported, not only
 * the binding one: a caller that fixed the bound limit alone would otherwise be refused again
 * with no warning that a second limit was also over.
 *
 * ## §16.3 thresholds: what is ENFORCED and what is MEASURED
 *
 * Both §16.3 ratios are stated over real traffic, and the two behave differently here.
 *
 * - **Retry tokens ≤ 10% of total.** ENFORCEABLE — set {@link TokenBudgetPolicy.maxRetryTokenShare}
 *   and a retry whose tokens would push the day's retry share past it is refused, so the
 *   threshold holds by construction. It is NOT enforced by default (the default is `null`),
 *   because a share ceiling has an unavoidable bootstrap: at the start of a world day total
 *   spend is 0, so the very first retry of the day always computes a share of 1.0 and would be
 *   refused however healthy the day went on to be. Defaulting it on would turn "retry once after
 *   a transient provider failure" — the behaviour ART-74 AC#1 pins — into a refusal. So the
 *   default is to MEASURE it ({@link summarizeResourceUsage}) and to let a deployment that wants
 *   the hard ceiling configure it.
 * - **>80% of low-importance work on the fast model.** ENFORCEABLE BY ROUTING —
 *   {@link routeModelForWork} sends every `low` request to the configured fast model class, so
 *   whenever the sample is non-empty the share is 1.0. But this deployment produces NO
 *   low-importance LLM work: the only LLM call path is whole-scene simulation, and
 *   `parseAndValidateDirectorPlan` admits at most `MAX_MAJOR_SCENES_PER_SLOT` MAJOR scenes per
 *   slot. The denominator is therefore empty, and {@link summarizeResourceUsage} reports the
 *   share as `null` with a reason rather than as a number. A ratio over an empty sample is not
 *   0 and it is not 1; reporting either would be a fabricated measurement, and the
 *   `dynamicViewMetrics` surface already established `value: null` + `reason` as this
 *   repository's answer to that.
 */

import { assertNoCredentialMaterial, type ConfigurableModule } from './moduleModelConfig';

export const TOKEN_BUDGET_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// PRD §16.3 constants
// ---------------------------------------------------------------------------

/** §16.3: "Retry Token 不超過總量 10%". The reporting threshold, always applied. */
export const SECTION_16_3_MAX_RETRY_TOKEN_SHARE = 0.1;

/** §16.3: "低重要度工作使用快速模型比例高於 80%". Strictly greater than, as written. */
export const SECTION_16_3_MIN_FAST_MODEL_SHARE = 0.8;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The importance class of one unit of LLM work — §16.3's 低重要度工作 and everything else.
 *
 * Two values, not a scale. §16.3 asks a single yes/no question ("is this low importance?") and a
 * finer scale would need a mapping nothing in this system can currently supply: the Director
 * plans only major scenes, and arc importance is assigned AFTER the commit, by the post-commit
 * classifier, long after the model call it would have to have priced.
 */
export const WORK_IMPORTANCE_CLASSES = ['low', 'standard'] as const;
export type WorkImportance = (typeof WORK_IMPORTANCE_CLASSES)[number];

export function isWorkImportance(value: unknown): value is WorkImportance {
  return typeof value === 'string' && (WORK_IMPORTANCE_CLASSES as readonly string[]).includes(value);
}

/**
 * Where a reservation came from.
 *
 * A CLOSED enumeration with no public-read member, and that absence is the point. §16.3 asks for
 * "公開訪客流量不增加 LLM 呼叫" to be measured, and AC#3 restates it as "public-read LLM calls".
 * The honest expected value is zero, and this makes the zero PROVABLE rather than assumed: the
 * public surface is queries-only (`publicReadOnlyGuarantee.test.ts`), a Convex query can neither
 * write nor schedule, and a reservation is a WRITE — so a public read cannot produce a ledger row
 * even if it somehow reached a provider. `tokenBudget.test.ts` pins this list, so adding a
 * public-read origin is a deliberate act that fails a named test.
 */
export const BUDGET_ORIGINS = ['scheduled_simulation', 'operator_command'] as const;
export type BudgetOrigin = (typeof BUDGET_ORIGINS)[number];

/**
 * The FR-M003 limit dimensions, in DECISION order.
 *
 * The order is the contract, not an accident of writing: `boundLimit` is the first entry in this
 * list that a request breaches, so the audit record names the same limit every time the same
 * request is evaluated (AC#2). Concurrency comes first because it is the only limit whose breach
 * is about the world's state right now rather than about the day's accumulated spend, and it is
 * the one a caller can clear by waiting rather than by spending less.
 */
export const BUDGET_LIMITS = [
  'concurrency',
  'world_daily_tokens',
  'module_daily_tokens',
  'model_daily_tokens',
  'retry_tokens',
  'retry_token_share',
] as const;
export type BudgetLimit = (typeof BUDGET_LIMITS)[number];

/**
 * What the system does with a request it cannot afford (FR-M003 超額降級策略).
 *
 * `refuse` is the floor and the default: it is the only strategy that is always available and
 * always honours the limit. The other two are chosen by configuration and fall back to `refuse`
 * when they cannot be carried out, which {@link selectOverBudgetStrategy} records rather than
 * performs silently.
 */
export const OVER_BUDGET_STRATEGIES = [
  'refuse',
  'downgrade_to_fast_model',
  'defer_to_next_world_day',
] as const;
export type OverBudgetStrategy = (typeof OVER_BUDGET_STRATEGIES)[number];

export function isOverBudgetStrategy(value: unknown): value is OverBudgetStrategy {
  return typeof value === 'string' && (OVER_BUDGET_STRATEGIES as readonly string[]).includes(value);
}

/** Why a configured strategy could not be carried out and fell back to `refuse`. */
export const STRATEGY_FALLBACK_REASONS = [
  'no_fast_model_configured',
  'already_on_fast_model',
  'concurrency_is_not_relieved_by_a_cheaper_model',
] as const;
export type StrategyFallbackReason = (typeof STRATEGY_FALLBACK_REASONS)[number];

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * The five FR-M003 dimensions ART-52's per-module row has no place for, plus the §16.3 knobs.
 *
 * `null` consistently means "no limit", exactly as `null` in `ModuleModelSettings` means "inherit
 * the deployment value" — in both cases it is a statement distinguishable from a number, and
 * collapsing it into `0` would make "unlimited" and "may spend nothing" the same configuration.
 */
export type TokenBudgetPolicy = {
  /** FR-M003 每日 Token 上限, world-wide, per world day. `null` = unlimited. */
  worldDailyTokenBudget: number | null;
  /**
   * FR-M003 每模型上限, per world day. A model with no entry is uncapped.
   *
   * A list of pairs rather than a `Record`, because it is stored, hashed and compared: an object
   * has no defined key order, so two byte-identical configurations could hash differently and
   * defeat the dedup that makes the version history mean "someone changed something".
   * {@link assertTokenBudgetPolicy} requires it sorted and duplicate-free.
   */
  modelDailyTokenBudgets: ReadonlyArray<{ model: string; dailyTokenBudget: number }>;
  /** FR-M003 最大並行數: in-flight provider calls for this world. `null` = unlimited. */
  maxConcurrentCalls: number | null;
  /** FR-M003 Retry 預算: absolute retry tokens per world day. `null` = unlimited. */
  retryTokenBudget: number | null;
  /**
   * §16.3 retry share ceiling, 0…1. `null` = measured but not enforced, which is the default;
   * see the module header for why a share ceiling cannot be defaulted on.
   */
  maxRetryTokenShare: number | null;
  /** §16.3 fast model class for low-importance work. `null` = no fast class configured. */
  fastModelClass: string | null;
  /** FR-M003 超額降級策略 (AC#2). */
  overBudgetStrategy: OverBudgetStrategy;
};

/**
 * Behaviour-preserving defaults: an unconfigured world enforces nothing it did not before.
 *
 * Every limit is `null`, so a world nobody has configured runs exactly as it ran before this
 * module existed and every reservation is `allowed`. That is the same promise
 * `MODULE_MODEL_DEFAULTS` makes, and `tokenBudget.test.ts` pins it rather than trusting this
 * comment. The one non-null field is the strategy, because "what would you do if you were over"
 * has to have an answer even when nothing is over, and `refuse` is the only answer that is always
 * honest.
 */
export const TOKEN_BUDGET_POLICY_DEFAULTS: Readonly<TokenBudgetPolicy> = {
  worldDailyTokenBudget: null,
  modelDailyTokenBudgets: [],
  maxConcurrentCalls: null,
  retryTokenBudget: null,
  maxRetryTokenShare: null,
  fastModelClass: null,
  overBudgetStrategy: 'refuse',
};

/** Upper bounds. These refuse absurdity; they are not a policy. Mirrors ART-52's ceilings. */
export const MAX_BUDGET_TOKENS = 1_000_000_000;
export const MAX_CONCURRENT_CALLS = 1_000;
export const MAX_MODEL_BUDGET_ENTRIES = 50;
export const MAX_BUDGET_MODEL_ID_LENGTH = 200;
export const MAX_BUDGET_REASON_LENGTH = 500;
export const MAX_BUDGET_ACTOR_LENGTH = 200;

export class TokenBudgetError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'TokenBudgetError';
  }
}

const invalid = (message: string): TokenBudgetError =>
  new TokenBudgetError('TOKEN_BUDGET_INVALID', message);

/**
 * Refuse credential material before it can be stored.
 *
 * The same two-sweep rule as `assertNoCredentialMaterial` in `./moduleModelConfig.ts`, and
 * deliberately delegated to it rather than reimplemented: one forbidden-field list, one place to
 * change it. A model id is caller-supplied free text on this path too, so it is swept the same
 * way a configured `model` is.
 */
export { assertNoCredentialMaterial };

function assertNullableBoundedInteger(value: number | null, label: string, max: number): void {
  if (value === null) return;
  if (!Number.isSafeInteger(value) || value < 1) throw invalid(`${label} must be a positive integer or null`);
  if (value > max) throw invalid(`${label} must be at most ${max}`);
}

function assertBoundedModelId(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid(`${label} must be a non-empty string`);
  if (value.length > MAX_BUDGET_MODEL_ID_LENGTH) {
    throw invalid(`${label} must be at most ${MAX_BUDGET_MODEL_ID_LENGTH} characters`);
  }
}

/** Validate one policy. Throws on the first problem; never normalises silently. */
export function assertTokenBudgetPolicy(policy: TokenBudgetPolicy): void {
  assertNullableBoundedInteger(policy.worldDailyTokenBudget, 'worldDailyTokenBudget', MAX_BUDGET_TOKENS);
  assertNullableBoundedInteger(policy.maxConcurrentCalls, 'maxConcurrentCalls', MAX_CONCURRENT_CALLS);
  assertNullableBoundedInteger(policy.retryTokenBudget, 'retryTokenBudget', MAX_BUDGET_TOKENS);
  if (!Array.isArray(policy.modelDailyTokenBudgets)) throw invalid('modelDailyTokenBudgets must be an array');
  if (policy.modelDailyTokenBudgets.length > MAX_MODEL_BUDGET_ENTRIES) {
    throw invalid(`modelDailyTokenBudgets must hold at most ${MAX_MODEL_BUDGET_ENTRIES} entries`);
  }
  let previous: string | null = null;
  // Iterated as `unknown` because this validator also guards values that arrived across a wire:
  // narrowing the declared type would let TypeScript assume the shape it is here to check.
  for (const candidate of policy.modelDailyTokenBudgets as readonly unknown[]) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      throw invalid('each modelDailyTokenBudgets entry must be an object');
    }
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.model !== 'string') throw invalid('modelDailyTokenBudgets[].model must be a string');
    assertBoundedModelId(entry.model, 'modelDailyTokenBudgets[].model');
    if (typeof entry.dailyTokenBudget !== 'number') {
      throw invalid('modelDailyTokenBudgets[].dailyTokenBudget must be a number');
    }
    assertNullableBoundedInteger(entry.dailyTokenBudget, 'modelDailyTokenBudgets[].dailyTokenBudget', MAX_BUDGET_TOKENS);
    // Sorted and unique, so the content hash is a function of the configuration rather than of
    // the order an operator happened to type it in.
    if (previous !== null && entry.model <= previous) {
      throw invalid('modelDailyTokenBudgets must be sorted by model and free of duplicates');
    }
    previous = entry.model;
  }
  if (policy.maxRetryTokenShare !== null) {
    if (typeof policy.maxRetryTokenShare !== 'number' || !Number.isFinite(policy.maxRetryTokenShare)
      || policy.maxRetryTokenShare <= 0 || policy.maxRetryTokenShare > 1) {
      throw invalid('maxRetryTokenShare must be a finite number in (0, 1] or null');
    }
  }
  if (policy.fastModelClass !== null) assertBoundedModelId(policy.fastModelClass, 'fastModelClass');
  if (!isOverBudgetStrategy(policy.overBudgetStrategy)) {
    throw invalid(`unknown overBudgetStrategy: ${String(policy.overBudgetStrategy)}`);
  }
}

// ---------------------------------------------------------------------------
// Versioned, audited storage (AC#2 "audited")
// ---------------------------------------------------------------------------

/**
 * Deterministic stable serialisation, then a djb2 digest — the protocol
 * `hashModuleModelSettings` uses, with its own `tbp:` prefix so the two hash spaces stay
 * distinguishable in a log. Not cryptographic; uniqueness is for dedup, not tamper evidence.
 */
export function hashTokenBudgetPolicy(policy: TokenBudgetPolicy): string {
  const payload: Record<string, unknown> = {
    worldDailyTokenBudget: policy.worldDailyTokenBudget,
    modelDailyTokenBudgets: policy.modelDailyTokenBudgets.map(({ model, dailyTokenBudget }) =>
      [model, dailyTokenBudget]),
    maxConcurrentCalls: policy.maxConcurrentCalls,
    retryTokenBudget: policy.retryTokenBudget,
    maxRetryTokenShare: policy.maxRetryTokenShare,
    fastModelClass: policy.fastModelClass,
    overBudgetStrategy: policy.overBudgetStrategy,
  };
  const text = `{${Object.keys(payload).sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(payload[key] ?? null)}`)
    .join(',')}}`;
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return `tbp:${hash.toString(16)}`;
}

/** A persisted policy version. Append-only: a change writes a new row. */
export type TokenBudgetPolicyRecord = TokenBudgetPolicy & {
  schemaVersion: typeof TOKEN_BUDGET_SCHEMA_VERSION;
  worldId: string;
  /** Monotonic per world. Version 1 is the first policy ever written. */
  version: number;
  contentHash: string;
  actor: string;
  reason: string;
  createdAt: number;
  /** True for the live version. At most one per world. */
  isCurrent: boolean;
};

export type StoredTokenBudgetPolicy = TokenBudgetPolicyRecord & { id: string };

export interface TokenBudgetPolicyStore {
  findCurrent(worldId: string): Promise<StoredTokenBudgetPolicy | null>;
  insertVersion(row: TokenBudgetPolicyRecord): Promise<string>;
  demote(rowId: string): Promise<void>;
}

export type CommitTokenBudgetPolicyResult = {
  version: number;
  contentHash: string;
  deduplicated: boolean;
};

/**
 * Commit a new policy version, using ART-52's commit protocol unchanged.
 *
 * Monotonic per world; content-hash dedup so re-saving an unchanged form appends nothing;
 * insert-then-demote so a failed insert leaves the previous policy being served rather than
 * opening a window with no current policy at all. `actor` and `reason` are outside the hash: a
 * new reason for the same numbers is not a configuration change.
 */
export async function commitTokenBudgetPolicy(
  store: TokenBudgetPolicyStore,
  input: { worldId: string; policy: TokenBudgetPolicy; actor: string; reason: string; now: number },
): Promise<CommitTokenBudgetPolicyResult> {
  if (input.worldId.trim().length === 0) throw invalid('worldId must be non-empty');
  if (input.actor.trim().length === 0 || input.actor.length > MAX_BUDGET_ACTOR_LENGTH) {
    throw invalid(`actor must be a non-empty string of at most ${MAX_BUDGET_ACTOR_LENGTH} characters`);
  }
  if (input.reason.trim().length === 0 || input.reason.length > MAX_BUDGET_REASON_LENGTH) {
    throw invalid(`reason must be a non-empty string of at most ${MAX_BUDGET_REASON_LENGTH} characters`);
  }
  if (!Number.isFinite(input.now)) throw invalid('now must be finite');
  assertNoCredentialMaterial({
    worldId: input.worldId,
    actor: input.actor,
    reason: input.reason,
    fastModelClass: input.policy.fastModelClass,
    ...Object.fromEntries(input.policy.modelDailyTokenBudgets.map(({ model }, index) =>
      [`modelDailyTokenBudgets_${index}`, model])),
  });
  assertTokenBudgetPolicy(input.policy);

  const contentHash = hashTokenBudgetPolicy(input.policy);
  const current = await store.findCurrent(input.worldId);
  if (current && current.contentHash === contentHash) {
    return { version: current.version, contentHash, deduplicated: true };
  }
  const version = current ? current.version + 1 : 1;
  await store.insertVersion({
    schemaVersion: TOKEN_BUDGET_SCHEMA_VERSION,
    worldId: input.worldId,
    version,
    ...input.policy,
    modelDailyTokenBudgets: input.policy.modelDailyTokenBudgets.map((entry) => ({ ...entry })),
    contentHash,
    actor: input.actor,
    reason: input.reason,
    createdAt: input.now,
    isCurrent: true,
  });
  if (current) await store.demote(current.id);
  return { version, contentHash, deduplicated: false };
}

export type EffectiveTokenBudgetPolicy = TokenBudgetPolicy & {
  /** `'default'` when no policy row exists for this world. */
  source: 'default' | 'configured';
  version: number | null;
};

/**
 * Turn "the current row, if any" into the policy the enforcement path acts on.
 *
 * A world with no row resolves to {@link TOKEN_BUDGET_POLICY_DEFAULTS}. A stored row that no
 * longer validates resolves to the defaults too rather than throwing, for the reason
 * `resolveEffectiveModuleConfig` does the same: a malformed policy must not be able to stop a
 * world simulating. It resolves to UNLIMITED rather than to a refusal, which is the safe
 * direction here — the alternative is a corrupt row silently halting every scene in the world,
 * and `source: 'default'` makes the fallback visible to the operator read.
 */
export function resolveEffectiveTokenBudgetPolicy(
  row: (TokenBudgetPolicy & { version: number }) | null,
): EffectiveTokenBudgetPolicy {
  if (!row) return { source: 'default', version: null, ...TOKEN_BUDGET_POLICY_DEFAULTS };
  const policy: TokenBudgetPolicy = {
    worldDailyTokenBudget: row.worldDailyTokenBudget,
    modelDailyTokenBudgets: row.modelDailyTokenBudgets.map((entry) => ({ ...entry })),
    maxConcurrentCalls: row.maxConcurrentCalls,
    retryTokenBudget: row.retryTokenBudget,
    maxRetryTokenShare: row.maxRetryTokenShare,
    fastModelClass: row.fastModelClass,
    overBudgetStrategy: row.overBudgetStrategy,
  };
  try {
    assertTokenBudgetPolicy(policy);
  } catch {
    return { source: 'default', version: null, ...TOKEN_BUDGET_POLICY_DEFAULTS };
  }
  return { source: 'configured', version: row.version, ...policy };
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/**
 * Everything the day's limits are measured against, for one (world, world day).
 *
 * DAY ROLLOVER IS STRUCTURAL. The counters are keyed on `worldDay`, so the first call of a new
 * world day is evaluated against a fresh zeroed record and nothing has to detect a rollover or
 * run at midnight. `worldDay` is the simulation's own day number, not a wall-clock date, which is
 * what keeps the whole path clock-free (AC#2) — a calendar-day budget would need `Date.now()` in
 * the decision and two replays of the same run could then disagree.
 */
export type BudgetCounters = {
  schemaVersion: typeof TOKEN_BUDGET_SCHEMA_VERSION;
  worldId: string;
  worldDay: number;
  /** Settled tokens, all modules and models, this world day. */
  totalTokens: number;
  /** The subset of {@link totalTokens} spent on attempts after the first. */
  retryTokens: number;
  /** Sorted by module; a module with no entry has spent nothing today. */
  tokensByModule: ReadonlyArray<{ module: string; tokens: number }>;
  /** Sorted by model. */
  tokensByModel: ReadonlyArray<{ model: string; tokens: number }>;
  /** Reservations granted and not yet settled or released. */
  inFlight: number;
  /** Reservations granted today, settled or not. */
  grantedCalls: number;
  /** Granted reservations that reported real usage. Never exceeds `grantedCalls` in a sane run. */
  settledCalls: number;
  /** Reservations refused today. */
  refusedCalls: number;
  /** Granted `low`-importance reservations, and how many of those ran on the fast class. */
  lowImportanceCalls: number;
  lowImportanceCallsOnFastModel: number;
  /**
   * Settled calls whose tokens were booked against a different model from the one the provider
   * reported running. Expected to be 0 forever; see {@link BudgetSettlement.reportedModel}.
   */
  modelMeteringMismatches: number;
};

export function emptyBudgetCounters(worldId: string, worldDay: number): BudgetCounters {
  return {
    schemaVersion: TOKEN_BUDGET_SCHEMA_VERSION,
    worldId,
    worldDay,
    totalTokens: 0,
    retryTokens: 0,
    tokensByModule: [],
    tokensByModel: [],
    inFlight: 0,
    grantedCalls: 0,
    settledCalls: 0,
    refusedCalls: 0,
    lowImportanceCalls: 0,
    lowImportanceCallsOnFastModel: 0,
    modelMeteringMismatches: 0,
  };
}

export function tokensForModule(counters: BudgetCounters, module: string): number {
  return counters.tokensByModule.find((entry) => entry.module === module)?.tokens ?? 0;
}

export function tokensForModel(counters: BudgetCounters, model: string): number {
  return counters.tokensByModel.find((entry) => entry.model === model)?.tokens ?? 0;
}

/**
 * Add `tokens` against `name` in a sorted name/tokens list, returning a NEW sorted list.
 *
 * Sorted on every write rather than on read, so the counters are canonical wherever they are
 * observed: they are hashed into the long-run digest, and a list whose order depended on which
 * module happened to spend first would make two identical runs digest differently.
 */
function addModuleTokens(
  entries: ReadonlyArray<{ module: string; tokens: number }>,
  module: string,
  tokens: number,
): Array<{ module: string; tokens: number }> {
  const next = entries.map((entry) => ({ ...entry }));
  const existing = next.find((entry) => entry.module === module);
  if (existing) existing.tokens += tokens;
  else next.push({ module, tokens });
  return next.sort((left, right) => (left.module < right.module ? -1 : left.module > right.module ? 1 : 0));
}

function addModelTokens(
  entries: ReadonlyArray<{ model: string; tokens: number }>,
  model: string,
  tokens: number,
): Array<{ model: string; tokens: number }> {
  const next = entries.map((entry) => ({ ...entry }));
  const existing = next.find((entry) => entry.model === model);
  if (existing) existing.tokens += tokens;
  else next.push({ model, tokens });
  return next.sort((left, right) => (left.model < right.model ? -1 : left.model > right.model ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The decision (AC#1 + AC#2)
// ---------------------------------------------------------------------------

export type BudgetReservationRequest = {
  worldId: string;
  worldDay: number;
  module: ConfigurableModule;
  /** The model the caller would use if nothing routed it. */
  requestedModel: string;
  importance: WorkImportance;
  /**
   * The tokens this call may consume — an UPPER BOUND, not a prediction.
   *
   * The caller supplies the configured per-request completion cap (`maxTokens`). It deliberately
   * excludes prompt tokens: counting those before the call would need a tokenizer for the
   * configured model, and there is none in the Convex runtime. The reservation therefore
   * UNDER-reserves by roughly the prompt size and {@link settleReservation} corrects it with the
   * provider's own reported usage, so the day's accounting is exact even though the reservation
   * is not. The consequence is stated rather than hidden: a limit can be crossed by up to one
   * call's prompt before it binds.
   */
  estimatedTokens: number;
  /** 1 for the first attempt. Anything higher makes this call a RETRY. */
  attempt: number;
  origin: BudgetOrigin;
};

export type BudgetDecision = {
  schemaVersion: typeof TOKEN_BUDGET_SCHEMA_VERSION;
  outcome: 'allowed' | 'over_budget';
  /** The model the call must use. Routing (AC#5) is applied to an allowed decision. */
  model: string;
  routingReason: 'low_importance_fast_model' | 'over_budget_downgrade' | null;
  /**
   * Whether {@link model} IS the configured fast class — the §16.3 AC#5 numerator.
   *
   * A separate field from {@link routingReason}, because they answer different questions: that one
   * says whether the model was CHANGED, this one says which model it is. A low-importance request
   * that already named the fast class is not re-routed and still runs on the fast class, so
   * deriving this from `routingReason !== null` reported a fabricated AC#5 violation for a
   * correctly-routed call. Computed inside {@link evaluateReservation}, where the policy is in
   * scope, so no caller has to re-derive a policy fact it cannot see.
   */
  onFastModel: boolean;
  /** Set only when `outcome` is `over_budget`. */
  strategy: OverBudgetStrategy | null;
  strategyFallbackReason: StrategyFallbackReason | null;
  /** The first breached limit in {@link BUDGET_LIMITS} order, or `null`. */
  boundLimit: BudgetLimit | null;
  /** EVERY breached limit, never truncated. */
  breachedLimits: readonly BudgetLimit[];
  countedAsRetry: boolean;
  estimatedTokens: number;
  /** The counter snapshot the decision was taken against, for the audit record. */
  observed: {
    totalTokens: number;
    retryTokens: number;
    moduleTokens: number;
    modelTokens: number;
    inFlight: number;
  };
};

/**
 * AC#5's routing rule, as a total function.
 *
 * Low-importance work RUNS ON the configured fast class; everything else keeps the model it asked
 * for. With a fast class configured, every low-importance call ends up on it — so §16.3's ">80%"
 * is an enforceable property here rather than a hope about traffic mix. Without a fast class
 * configured there is nothing to route TO, and the request keeps its model: silently pretending
 * otherwise would report a fast-model share for a model class that does not exist.
 *
 * ## `routingReason` is about the SWITCH, not about the destination
 *
 * There are three branches, not two, and the third is the one that used to be described away.
 * A low-importance request that ALREADY names the fast class is returned unchanged with
 * `routingReason: null` — nothing was re-routed, because nothing needed to be. It is still
 * running on the fast class.
 *
 * Reading "did this call run on the fast model?" off `routingReason` therefore gets that third
 * branch backwards, which is why {@link BudgetDecision.onFastModel} answers it separately and is
 * computed HERE, where the policy is in scope. The two questions look interchangeable and are
 * not: one is "was the model changed", the other is "which model is it". Conflating them made
 * `summarizeResourceUsage` report a fabricated AC#5 violation for a correctly-routed call.
 */
export function routeModelForWork(
  policy: Pick<TokenBudgetPolicy, 'fastModelClass'>,
  requestedModel: string,
  importance: WorkImportance,
): { model: string; routingReason: BudgetDecision['routingReason']; onFastModel: boolean } {
  const model = importance === 'low' && policy.fastModelClass !== null
    ? policy.fastModelClass
    : requestedModel;
  return {
    model,
    // Only a real switch is a routing reason: `model !== requestedModel`, never `importance`.
    routingReason: model === requestedModel ? null : 'low_importance_fast_model',
    onFastModel: policy.fastModelClass !== null && model === policy.fastModelClass,
  };
}

/**
 * Pick the over-budget strategy (AC#2). Pure, total, and independent of everything except the
 * configuration and the breach — no clock, no randomness, no ordering by arrival.
 *
 * A configured strategy that cannot be carried out becomes `refuse` WITH a recorded reason,
 * rather than being attempted and failing: a downgrade needs somewhere to downgrade to, and a
 * concurrency breach is not relieved by a cheaper model — the call still occupies a slot. That
 * last case is the one worth spelling out, because "downgrade" reads like it always helps.
 */
export function selectOverBudgetStrategy(
  policy: Pick<TokenBudgetPolicy, 'overBudgetStrategy' | 'fastModelClass'>,
  requestedModel: string,
  breachedLimits: readonly BudgetLimit[],
): { strategy: OverBudgetStrategy; fallbackReason: StrategyFallbackReason | null } {
  if (policy.overBudgetStrategy === 'downgrade_to_fast_model') {
    if (policy.fastModelClass === null) {
      return { strategy: 'refuse', fallbackReason: 'no_fast_model_configured' };
    }
    if (policy.fastModelClass === requestedModel) {
      return { strategy: 'refuse', fallbackReason: 'already_on_fast_model' };
    }
    if (breachedLimits.includes('concurrency')) {
      return { strategy: 'refuse', fallbackReason: 'concurrency_is_not_relieved_by_a_cheaper_model' };
    }
    return { strategy: 'downgrade_to_fast_model', fallbackReason: null };
  }
  return { strategy: policy.overBudgetStrategy, fallbackReason: null };
}

/**
 * Decide whether one call may proceed (AC#1), and if not, what happens instead (AC#2).
 *
 * `moduleDailyTokenBudget` is ART-52's `dailyTokenBudget` for the requesting module, passed in
 * rather than re-read here so the per-module cap keeps exactly one owner.
 *
 * Every limit is checked — not just up to the first breach — so `breachedLimits` is the whole
 * truth about why the call was refused. `boundLimit` is the first of them in {@link BUDGET_LIMITS}
 * order, which makes the audit record's headline reason a deterministic function of the inputs.
 *
 * A limit is breached when the request would take the counter PAST it: `used + estimated > limit`.
 * A request that exactly fills the budget is allowed, because a budget of N means N tokens may be
 * spent.
 */
export function evaluateReservation(input: {
  policy: TokenBudgetPolicy;
  moduleDailyTokenBudget: number | null;
  counters: BudgetCounters;
  request: BudgetReservationRequest;
}): BudgetDecision {
  const { policy, counters, request } = input;
  if (!Number.isSafeInteger(request.estimatedTokens) || request.estimatedTokens < 0) {
    throw invalid('estimatedTokens must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(request.attempt) || request.attempt < 1) {
    throw invalid('attempt must be a positive integer');
  }
  if (counters.worldId !== request.worldId || counters.worldDay !== request.worldDay) {
    // The counters ARE the day. Evaluating a request against another day's counters would silently
    // charge the wrong budget, so it is refused as a programming error rather than absorbed.
    throw invalid('counters must belong to the requested world and world day');
  }

  const routed = routeModelForWork(policy, request.requestedModel, request.importance);
  const countedAsRetry = request.attempt > 1;
  const spend = request.estimatedTokens;
  const moduleTokens = tokensForModule(counters, request.module);
  const modelTokens = tokensForModel(counters, routed.model);

  const breached: BudgetLimit[] = [];
  const over = (used: number, limit: number | null): boolean => limit !== null && used + spend > limit;

  if (policy.maxConcurrentCalls !== null && counters.inFlight + 1 > policy.maxConcurrentCalls) {
    breached.push('concurrency');
  }
  if (over(counters.totalTokens, policy.worldDailyTokenBudget)) breached.push('world_daily_tokens');
  if (over(moduleTokens, input.moduleDailyTokenBudget)) breached.push('module_daily_tokens');
  if (over(modelTokens, modelBudgetFor(policy, routed.model))) breached.push('model_daily_tokens');
  if (countedAsRetry) {
    if (over(counters.retryTokens, policy.retryTokenBudget)) breached.push('retry_tokens');
    // The share is evaluated INCLUDING this call on both sides:
    // `(retry + reserved) / (total + reserved) <= ceiling`.
    //
    // HONEST SCOPE: this bounds the share computed over the RESERVED amount, not over what the
    // call turns out to cost. Reservations are upper bounds on the completion only and exclude
    // prompt tokens (no tokenizer in this runtime), so a call can settle for more than it
    // reserved and the SETTLED share can end a day above the ceiling even though every individual
    // reservation was inside it. Worked example: ceiling 0.5, total 100 / retry 40, a retry
    // reserving 10 is allowed at 0.4545 — and if the provider then reports 200, the settled share
    // is 0.8. The ceiling is therefore a real admission control, not a guarantee about the final
    // measured ratio, and `summarizeResourceUsage` measures that ratio separately for exactly
    // this reason.
    //
    // It also has the bootstrap consequence documented in the module header — with a 10% ceiling a
    // retry needs at least 9x its own reservation already spent today before it can be granted —
    // and that is a property of share ceilings, not a defect in this expression.
    if (policy.maxRetryTokenShare !== null) {
      const projectedTotal = counters.totalTokens + spend;
      const projectedRetry = counters.retryTokens + spend;
      if (projectedTotal === 0 ? spend > 0 : projectedRetry / projectedTotal > policy.maxRetryTokenShare) {
        breached.push('retry_token_share');
      }
    }
  }
  // Sorted into the declared decision order rather than into the order the checks happen to run,
  // so the order is the CONTRACT and reordering the checks above cannot change an audit record.
  breached.sort((left, right) => BUDGET_LIMITS.indexOf(left) - BUDGET_LIMITS.indexOf(right));

  const observed = {
    totalTokens: counters.totalTokens,
    retryTokens: counters.retryTokens,
    moduleTokens,
    modelTokens,
    inFlight: counters.inFlight,
  };

  if (breached.length === 0) {
    return {
      schemaVersion: TOKEN_BUDGET_SCHEMA_VERSION,
      outcome: 'allowed',
      model: routed.model,
      routingReason: routed.routingReason,
      onFastModel: routed.onFastModel,
      strategy: null,
      strategyFallbackReason: null,
      boundLimit: null,
      breachedLimits: [],
      countedAsRetry,
      estimatedTokens: spend,
      observed,
    };
  }

  const selected = selectOverBudgetStrategy(policy, routed.model, breached);
  return {
    schemaVersion: TOKEN_BUDGET_SCHEMA_VERSION,
    outcome: 'over_budget',
    // An over-budget decision does not grant the call, so the model it names is the model the
    // request WOULD have used. When the strategy is a downgrade, that is the fast class — which is
    // what a caller re-requesting under the strategy has to know.
    model: selected.strategy === 'downgrade_to_fast_model' && policy.fastModelClass !== null
      ? policy.fastModelClass
      : routed.model,
    routingReason: selected.strategy === 'downgrade_to_fast_model'
      ? 'over_budget_downgrade'
      : routed.routingReason,
    // A refused call runs nothing, so it is never ON any model. The downgrade case still reports
    // false: the caller has not made that call yet, and `runBudgetedAttempt` re-reserves against
    // the fast class, which is the decision that will carry `onFastModel: true`.
    onFastModel: false,
    strategy: selected.strategy,
    strategyFallbackReason: selected.fallbackReason,
    boundLimit: breached[0],
    breachedLimits: breached,
    countedAsRetry,
    estimatedTokens: spend,
    observed,
  };
}

function modelBudgetFor(policy: TokenBudgetPolicy, model: string): number | null {
  return policy.modelDailyTokenBudgets.find((entry) => entry.model === model)?.dailyTokenBudget ?? null;
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/** What a granted call actually consumed, as the provider reported it. */
export type BudgetSettlement = {
  module: ConfigurableModule;
  /** The key the reservation was METERED under — the model the decision named. */
  model: string;
  /**
   * The model the provider itself REPORTED running, from `ProviderTraceMetadata.model`.
   *
   * The two are the same number in a healthy deployment and are kept as separate fields because
   * the case where they diverge is the one failure in this whole subsystem whose symptom is
   * SILENCE: the per-model cap would meter one bucket while a different model spent, so budgets
   * would appear to work while the real model ran unbounded. Nothing infers this — it is
   * compared at the moment the tokens are booked, which is the only moment both ids exist.
   *
   * The known way to reach it is the ART-72 provider adapter landing without re-pointing
   * `deploymentModelId` (see `worldDayLiveFunctions.ts`), which `sceneBudgetProviderPin.test.ts`
   * additionally catches at BUILD time. This field catches the cases a source pin cannot see —
   * chiefly a gateway that answers with a different model id from the one it was asked for.
   */
  reportedModel: string;
  importance: WorkImportance;
  /** `inputTokens + outputTokens` from the provider trace. */
  tokens: number;
  countedAsRetry: boolean;
  /** True when the granted call ran on the configured fast model class. */
  onFastModel: boolean;
};

/** True when the tokens were booked against a different model from the one that ran them. */
export function isModelMeteringMismatch(settlement: BudgetSettlement): boolean {
  return settlement.model !== settlement.reportedModel;
}

/**
 * Apply a granted reservation to the counters.
 *
 * `grantReservation` and `settleReservation` are separate because they happen at different times:
 * the grant takes the concurrency slot BEFORE the call, the settlement books the real tokens
 * AFTER it. Booking at grant time would charge the reservation's upper bound rather than the
 * spend, and releasing at grant time would make `maxConcurrentCalls` unenforceable.
 */
export function grantReservation(counters: BudgetCounters, decision: BudgetDecision): BudgetCounters {
  if (decision.outcome !== 'allowed') throw invalid('only an allowed decision may be granted');
  return {
    ...counters,
    tokensByModule: counters.tokensByModule.map((entry) => ({ ...entry })),
    tokensByModel: counters.tokensByModel.map((entry) => ({ ...entry })),
    inFlight: counters.inFlight + 1,
    grantedCalls: counters.grantedCalls + 1,
  };
}

/**
 * Move the counters when a PREVIOUSLY REFUSED decision is re-evaluated (M2).
 *
 * A budget refusal has to be re-evaluable, or an operator has no remedy: `decisionId` is derived
 * from the scene, so it is identical across the original run and any later FR-K001 `run.retry`,
 * and replaying the stored refusal verbatim made the refusal PERMANENT — raising the cap changed
 * nothing, because the re-run never reached an evaluation. Re-evaluating is safe precisely
 * because a refusal booked no spend and holds no concurrency slot; only a GRANT must be replayed
 * verbatim, and {@link grantReservation} is what must not run twice.
 *
 * The existing ledger row is REPLACED rather than appended to, so the counters stay reconcilable
 * with the ledger: `refusedCalls` must equal the number of `over_budget` rows. Hence
 *
 * - still refused → no counter movement; the refusal was already counted once, and re-counting it
 *   would inflate `refusedCalls` by one per operator retry, making the §16.3 availability metric
 *   a measure of how often someone pressed retry.
 * - now allowed → grant it, AND drop the earlier refusal from the tally, because the row that
 *   recorded that refusal no longer says `over_budget`.
 */
export function reevaluateRefusal(counters: BudgetCounters, decision: BudgetDecision): BudgetCounters {
  if (decision.outcome !== 'allowed') return counters;
  const granted = grantReservation(counters, decision);
  return { ...granted, refusedCalls: Math.max(0, granted.refusedCalls - 1) };
}

/** Record a refused reservation. Refusals are counted so the report can measure availability. */
export function refuseReservation(counters: BudgetCounters): BudgetCounters {
  return {
    ...counters,
    tokensByModule: counters.tokensByModule.map((entry) => ({ ...entry })),
    tokensByModel: counters.tokensByModel.map((entry) => ({ ...entry })),
    refusedCalls: counters.refusedCalls + 1,
  };
}

/**
 * Book the real spend of a granted call and free its concurrency slot.
 *
 * `inFlight` is floored at 0 rather than allowed to go negative: a double settle is a bug, but a
 * negative in-flight count would DISABLE the concurrency limit for the rest of the day, which is
 * a much worse failure than over-counting one slot. The floor is visible in the counters, not
 * silent — `settledCalls` would exceed `grantedCalls`, which `tokenBudget.test.ts` checks.
 */
export function settleReservation(counters: BudgetCounters, settlement: BudgetSettlement): BudgetCounters {
  if (!Number.isSafeInteger(settlement.tokens) || settlement.tokens < 0) {
    throw invalid('settled tokens must be a non-negative safe integer');
  }
  return {
    ...counters,
    totalTokens: counters.totalTokens + settlement.tokens,
    retryTokens: counters.retryTokens + (settlement.countedAsRetry ? settlement.tokens : 0),
    tokensByModule: addModuleTokens(counters.tokensByModule, settlement.module, settlement.tokens),
    tokensByModel: addModelTokens(counters.tokensByModel, settlement.model, settlement.tokens),
    inFlight: Math.max(0, counters.inFlight - 1),
    settledCalls: counters.settledCalls + 1,
    // Counted, not thrown. A throw would take the world down on a gateway that merely answers
    // with a pinned revision of the model it was asked for (`gpt-4o` -> `gpt-4o-2024-08-06`),
    // which is legitimate; and the tokens are still booked under the METERED key so the cap
    // stays internally coherent. What must not happen is that the divergence goes unrecorded.
    modelMeteringMismatches: counters.modelMeteringMismatches + (isModelMeteringMismatch(settlement) ? 1 : 0),
    lowImportanceCalls: counters.lowImportanceCalls + (settlement.importance === 'low' ? 1 : 0),
    lowImportanceCallsOnFastModel: counters.lowImportanceCallsOnFastModel
      + (settlement.importance === 'low' && settlement.onFastModel ? 1 : 0),
  };
}

/**
 * Free a granted call's slot when it produced no usage at all (the provider threw before
 * reporting). Separated from {@link settleReservation} so "spent nothing" is not written as
 * "settled 0 tokens", which would inflate the low-importance call count with calls that never ran.
 */
export function releaseReservation(counters: BudgetCounters): BudgetCounters {
  return {
    ...counters,
    tokensByModule: counters.tokensByModule.map((entry) => ({ ...entry })),
    tokensByModel: counters.tokensByModel.map((entry) => ({ ...entry })),
    inFlight: Math.max(0, counters.inFlight - 1),
  };
}

// ---------------------------------------------------------------------------
// The audit record (AC#2 "audited")
// ---------------------------------------------------------------------------

/**
 * One durable, inspectable row per reservation decision.
 *
 * Append-only and never edited, matching `safetyStatusOverrides` and the publication lifecycle:
 * the question asked afterwards is never only "are we over budget now" but "what was refused,
 * under which limit, against which counters, and what did the configured strategy do about it".
 * The counter snapshot is stored WITH the decision because the counters themselves move — a
 * refusal explained by "the world was at 990k of 1M" cannot be reconstructed a day later from
 * live counters.
 *
 * Secret-safe by construction: there is no free text on this record at all. Every field is a
 * number, a boolean, or a member of a closed enumeration, except `model` and `module`, which are
 * swept for credential material on the configuration write that named them.
 */
export type BudgetLedgerEntry = {
  schemaVersion: typeof TOKEN_BUDGET_SCHEMA_VERSION;
  worldId: string;
  worldDay: number;
  /** Stable per decision, so a retried mutation cannot double-count one call. */
  decisionId: string;
  module: string;
  requestedModel: string;
  model: string;
  importance: WorkImportance;
  origin: BudgetOrigin;
  attempt: number;
  countedAsRetry: boolean;
  estimatedTokens: number;
  /** Whether {@link model} is the configured fast class — the §16.3 AC#5 numerator, per decision. */
  onFastModel: boolean;
  outcome: BudgetDecision['outcome'];
  strategy: OverBudgetStrategy | null;
  strategyFallbackReason: StrategyFallbackReason | null;
  routingReason: BudgetDecision['routingReason'];
  boundLimit: BudgetLimit | null;
  breachedLimits: readonly BudgetLimit[];
  observedTotalTokens: number;
  observedRetryTokens: number;
  observedModuleTokens: number;
  observedModelTokens: number;
  observedInFlight: number;
  /** The policy version the decision was taken under; `null` when running on defaults. */
  policyVersion: number | null;
  recordedAt: number;
};

/**
 * How a granted reservation ended, and what it actually cost.
 *
 * Kept OFF {@link BudgetLedgerEntry} because that type is the record of a DECISION and a decision
 * does not know its own outcome yet; these three are written later, by settlement or release. They
 * are part of the stored row all the same, so they are declared here rather than living only in
 * the Convex schema — a field that exists on the row but in no TypeScript type is a field the
 * ledger's own structural guard cannot see, which is how `settledModel` slipped past it once.
 */
export type BudgetLedgerResolution = {
  resolution: 'pending' | 'settled' | 'released';
  /** Tokens actually booked. `null` until resolved, and for a released reservation. */
  settledTokens: number | null;
  /** The model the provider REPORTED running. `null` until resolved, and for a release. */
  settledModel: string | null;
};

/** A ledger row as an operator reads it: the decision, plus how it ended. */
export type StoredBudgetLedgerEntry = BudgetLedgerEntry & BudgetLedgerResolution;

/** Build the audit row for one decision. `recordedAt` is a parameter; nothing reads a clock. */
export function buildBudgetLedgerEntry(input: {
  request: BudgetReservationRequest;
  decision: BudgetDecision;
  decisionId: string;
  policyVersion: number | null;
  recordedAt: number;
}): BudgetLedgerEntry {
  const { request, decision } = input;
  if (input.decisionId.trim().length === 0) throw invalid('decisionId must be non-empty');
  return {
    schemaVersion: TOKEN_BUDGET_SCHEMA_VERSION,
    worldId: request.worldId,
    worldDay: request.worldDay,
    decisionId: input.decisionId,
    module: request.module,
    requestedModel: request.requestedModel,
    model: decision.model,
    importance: request.importance,
    origin: request.origin,
    attempt: request.attempt,
    countedAsRetry: decision.countedAsRetry,
    estimatedTokens: decision.estimatedTokens,
    onFastModel: decision.onFastModel,
    outcome: decision.outcome,
    strategy: decision.strategy,
    strategyFallbackReason: decision.strategyFallbackReason,
    routingReason: decision.routingReason,
    boundLimit: decision.boundLimit,
    breachedLimits: [...decision.breachedLimits],
    observedTotalTokens: decision.observed.totalTokens,
    observedRetryTokens: decision.observed.retryTokens,
    observedModuleTokens: decision.observed.moduleTokens,
    observedModelTokens: decision.observed.modelTokens,
    observedInFlight: decision.observed.inFlight,
    policyVersion: input.policyVersion,
    recordedAt: input.recordedAt,
  };
}

// ---------------------------------------------------------------------------
// Resource reporting (AC#3, AC#4, AC#5)
// ---------------------------------------------------------------------------

/**
 * The reason strings are part of the contract: an unmeasured metric must say why.
 *
 * Copied in spirit from `dynamicViewMetricsFunctions.ts`, which established that a `null` with a
 * reason and a `0` are different answers and that returning the second for the first is the
 * failure mode worth designing against.
 */
export const EMPTY_SAMPLE_REASONS = {
  retryTokenShare:
    'No tokens were settled in this window, so the retry share has no denominator. 0 would be '
    + 'indistinguishable from a measured zero over real traffic.',
  fastModelRoutingShare:
    'No low-importance LLM work exists in this deployment, so the ratio has no denominator. The '
    + 'only LLM call path is whole-scene simulation, and parseAndValidateDirectorPlan admits at '
    + 'most MAX_MAJOR_SCENES_PER_SLOT MAJOR scenes per slot — every call is standard importance '
    + 'by construction. routeModelForWork enforces the routing whenever low-importance work does '
    + 'appear; until then the share is unmeasurable, not 0 and not 1.',
  fastModelClassUnconfigured:
    'Low-importance work was observed but no fastModelClass is configured, so there is no fast '
    + 'class for the share to be measured against.',
  dailyCap:
    'No worldDailyTokenBudget is configured, so there is no cap for the day\'s usage to comply '
    + 'with. Compliance with an absent limit is not the same statement as compliance with one.',
} as const;

/**
 * What a non-zero {@link ResourceUsageReport.modelMeteringMismatches} means, and what to do.
 *
 * Written out rather than left to a field name, because the number is only actionable if the
 * reader knows the known cause. The failure is silent by nature — every other signal keeps
 * looking healthy — so the report has to explain itself the first time anyone sees it.
 */
export const MODEL_METERING_MISMATCH_REASON =
  'Tokens were booked against a different model id from the one the provider reported running. '
  + 'The METERED bucket is still charged and its cap still binds — but a per-model cap an operator '
  + 'configured against the model that ACTUALLY ran will never bind, because nothing is ever booked '
  + 'under that id. The known cause is a provider adapter (ART-72) being injected into '
  + 'createWorldDayStageHandlers without repointing deploymentModelId in '
  + 'convex/simulation/worldDayLiveFunctions.ts; that specific case also fails '
  + 'sceneBudgetProviderPin.test.ts at build time. The other cause is a gateway that answers with a '
  + 'different model id from the one requested (for example a pinned revision), which is legitimate '
  + 'and needs the configured model id updated to match. See docs/token-budget-controls.md §8.';

/** §16.3's "公開訪客流量不增加 LLM 呼叫", proven rather than assumed. */
export const PUBLIC_READ_LLM_CALL_REASON =
  'Structurally zero, not counted to zero. BUDGET_ORIGINS declares no public-read origin, and a '
  + 'reservation is a WRITE: every anonymous-gated function in the public surface policy is a '
  + 'Convex query, which can neither write nor schedule. Proven by '
  + 'convex/publicRead/publicReadOnlyGuarantee.test.ts and pinned by tokenBudget.test.ts.';

export type ResourceUsageReport = {
  schemaVersion: typeof TOKEN_BUDGET_SCHEMA_VERSION;
  worldId: string;
  /** The world days the sample covers, ascending. Empty means nothing was measured. */
  worldDays: readonly number[];

  // --- §16.3 #1: retry token share (AC#4) ---
  totalTokens: number;
  retryTokens: number;
  /** `null` when `totalTokens` is 0. Never 0/0. */
  retryTokenShare: number | null;
  retryTokenShareThreshold: number;
  /** `null` when unmeasurable; otherwise `retryTokenShare <= threshold`. */
  retryTokenShareCompliant: boolean | null;
  retryTokenShareReason: string | null;
  /** True when the policy makes the threshold hold by construction rather than by observation. */
  retryTokenShareEnforced: boolean;

  // --- §16.3 #2: fast-model routing share (AC#5) ---
  lowImportanceCalls: number;
  lowImportanceCallsOnFastModel: number;
  /** `null` when `lowImportanceCalls` is 0, or when no fast class is configured. */
  fastModelRoutingShare: number | null;
  fastModelRoutingShareThreshold: number;
  fastModelRoutingShareCompliant: boolean | null;
  fastModelRoutingShareReason: string | null;

  // --- §16.3 #3: public-read LLM calls (AC#3) ---
  publicReadLlmCalls: number;
  publicReadLlmCallsReason: string;

  // --- §16.3 #4: availability under refusal (AC#3) ---
  grantedCalls: number;
  refusedCalls: number;
  /** Refusals per limit, every limit present, so a zero is a measured zero. */
  refusedByLimit: Readonly<Record<BudgetLimit, number>>;
  refusalsByStrategy: Readonly<Record<OverBudgetStrategy, number>>;

  // --- metering integrity: the one silent failure this subsystem can have ---
  /**
   * Settled calls booked against a different model from the one the provider reported running.
   *
   * Surfaced on the REPORT, not merely on a row, because a per-model cap metering the wrong
   * bucket does not look broken from anywhere else: the ledger fills, the limits appear to hold,
   * and the real model spends unbounded. A non-zero value here means the meter and the provider
   * have come apart, and {@link modelMeteringMismatchReason} names the way that happens.
   */
  modelMeteringMismatches: number;
  modelMeteringMismatchReason: string | null;

  // --- §16.3 #5: daily cap compliance (AC#3) ---
  worldDailyTokenBudget: number | null;
  maxObservedDailyTokens: number;
  tokensByWorldDay: ReadonlyArray<{ worldDay: number; tokens: number }>;
  worldDaysOverCap: readonly number[];
  dailyCapCompliant: boolean | null;
  dailyCapReason: string | null;
};

/**
 * Summarise a window of ledger entries and settled counters into the five §16.3 measurements.
 *
 * The two inputs answer different questions and neither can replace the other. The LEDGER records
 * decisions — what was refused, under which limit, with which strategy — and the COUNTERS record
 * settled spend, which is the only place the real token totals exist (a reservation carries an
 * upper bound, not the spend). A report built from the ledger alone would report reserved tokens
 * as if they were spent.
 *
 * Pure, and it never reads its own output: the counters come from settlement, the ledger from the
 * decision path, and neither is derived from this function.
 */
export function summarizeResourceUsage(input: {
  worldId: string;
  policy: Pick<TokenBudgetPolicy, 'worldDailyTokenBudget' | 'maxRetryTokenShare' | 'fastModelClass'>;
  counters: readonly BudgetCounters[];
  ledger: readonly BudgetLedgerEntry[];
}): ResourceUsageReport {
  const counters = [...input.counters].sort((left, right) => left.worldDay - right.worldDay);
  const worldDays = counters.map(({ worldDay }) => worldDay);
  const sum = (pick: (row: BudgetCounters) => number): number =>
    counters.reduce((total, row) => total + pick(row), 0);

  const totalTokens = sum((row) => row.totalTokens);
  const retryTokens = sum((row) => row.retryTokens);
  const lowImportanceCalls = sum((row) => row.lowImportanceCalls);
  const lowImportanceCallsOnFastModel = sum((row) => row.lowImportanceCallsOnFastModel);

  const retryTokenShare = totalTokens === 0 ? null : retryTokens / totalTokens;
  const fastModelUnconfigured = input.policy.fastModelClass === null;
  const fastModelRoutingShare = lowImportanceCalls === 0 || fastModelUnconfigured
    ? null
    : lowImportanceCallsOnFastModel / lowImportanceCalls;

  const refusedByLimit = Object.fromEntries(BUDGET_LIMITS.map((limit) => [limit, 0])) as
    Record<BudgetLimit, number>;
  const refusalsByStrategy = Object.fromEntries(OVER_BUDGET_STRATEGIES.map((s) => [s, 0])) as
    Record<OverBudgetStrategy, number>;
  let publicReadLlmCalls = 0;
  for (const entry of input.ledger) {
    if (entry.outcome !== 'over_budget') continue;
    if (entry.boundLimit !== null) refusedByLimit[entry.boundLimit] += 1;
    if (entry.strategy !== null) refusalsByStrategy[entry.strategy] += 1;
  }
  for (const entry of input.ledger) {
    // A closed enum with no public-read member means this loop can only ever count 0 today. It is
    // written as a COUNT rather than as a hardcoded 0 so that adding such an origin would make the
    // number move instead of leaving a stale literal claiming zero.
    if (!(BUDGET_ORIGINS as readonly string[]).includes(entry.origin)) publicReadLlmCalls += 1;
  }

  const cap = input.policy.worldDailyTokenBudget;
  const tokensByWorldDay = counters.map(({ worldDay, totalTokens: tokens }) => ({ worldDay, tokens }));
  const worldDaysOverCap = cap === null
    ? []
    : tokensByWorldDay.filter(({ tokens }) => tokens > cap).map(({ worldDay }) => worldDay);

  return {
    schemaVersion: TOKEN_BUDGET_SCHEMA_VERSION,
    worldId: input.worldId,
    worldDays,

    totalTokens,
    retryTokens,
    retryTokenShare,
    retryTokenShareThreshold: SECTION_16_3_MAX_RETRY_TOKEN_SHARE,
    retryTokenShareCompliant: retryTokenShare === null
      ? null
      : retryTokenShare <= SECTION_16_3_MAX_RETRY_TOKEN_SHARE,
    retryTokenShareReason: retryTokenShare === null ? EMPTY_SAMPLE_REASONS.retryTokenShare : null,
    retryTokenShareEnforced: input.policy.maxRetryTokenShare !== null
      && input.policy.maxRetryTokenShare <= SECTION_16_3_MAX_RETRY_TOKEN_SHARE,

    lowImportanceCalls,
    lowImportanceCallsOnFastModel,
    fastModelRoutingShare,
    fastModelRoutingShareThreshold: SECTION_16_3_MIN_FAST_MODEL_SHARE,
    fastModelRoutingShareCompliant: fastModelRoutingShare === null
      ? null
      : fastModelRoutingShare > SECTION_16_3_MIN_FAST_MODEL_SHARE,
    fastModelRoutingShareReason: fastModelRoutingShare !== null
      ? null
      : lowImportanceCalls === 0
        ? EMPTY_SAMPLE_REASONS.fastModelRoutingShare
        : EMPTY_SAMPLE_REASONS.fastModelClassUnconfigured,

    publicReadLlmCalls,
    publicReadLlmCallsReason: PUBLIC_READ_LLM_CALL_REASON,

    grantedCalls: sum((row) => row.grantedCalls),
    refusedCalls: sum((row) => row.refusedCalls),
    refusedByLimit,
    refusalsByStrategy,

    modelMeteringMismatches: sum((row) => row.modelMeteringMismatches),
    modelMeteringMismatchReason: sum((row) => row.modelMeteringMismatches) === 0
      ? null
      : MODEL_METERING_MISMATCH_REASON,

    worldDailyTokenBudget: cap,
    maxObservedDailyTokens: tokensByWorldDay.reduce((max, { tokens }) => Math.max(max, tokens), 0),
    tokensByWorldDay,
    worldDaysOverCap,
    dailyCapCompliant: cap === null ? null : worldDaysOverCap.length === 0,
    dailyCapReason: cap === null ? EMPTY_SAMPLE_REASONS.dailyCap : null,
  };
}
