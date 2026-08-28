import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Tables owned by `shared` (FR-K005 / ART-52, FR-M003 / ART-59).
 *
 * `shared` normally holds pure modules, and these are the tables that have to live here: each is
 * WRITTEN or READ by `operations` (the authorized console) AND by `simulation` (the live scene
 * call path), and `architecture/module-boundaries.json` forbids `simulation → operations`. A
 * table definition carries no logic, so nothing about the module's purity discipline is lost —
 * the pure models beside them in `./moduleModelConfig.ts` and `./tokenBudget.ts` are where the
 * rules live.
 */
export const sharedTables = {
  /**
   * Versioned per-module model / prompt / retry / budget configuration (FR-K005).
   *
   * APPEND-ONLY. A change writes a NEW row and demotes the prior one's `isCurrent`; a row's
   * settings are never edited in place. That is the same shape the read-model store and the
   * operator control ledgers use, for the same reason: the question asked afterwards is never
   * only "what is the temperature now" but "who changed it, when, why, and from what".
   *
   * SECRET-SAFE by construction. There is no credential field, and `promptVersion` stores an ID
   * whose body lives in repository source (`convex/simulation/promptVersions.ts`). Storing
   * prompt bodies would breach FR-K005 AC#3; `assertNoCredentialMaterial` additionally refuses
   * any submitted key or string value that looks like credential material.
   *
   * `module` is `v.string()` rather than a literal union for the same reason
   * `operatorAuditLog.capability` is: the enumeration is owned by
   * `CONFIGURABLE_MODULES` in the pure model, which validates on write, and duplicating it in
   * the schema would mean adding a module required a migration to read old rows.
   */
  moduleModelConfigs: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    module: v.string(),
    /** Monotonic per (worldId, module); version 1 is the first configuration ever written. */
    version: v.number(),

    // --- the eight FR-K005 settings (Retry is two layers, so nine fields) ---
    /** `null` inherits the deployment's `LLM_MODEL`. */
    model: v.union(v.string(), v.null()),
    /** A registered prompt version ID. Never a prompt body. */
    promptVersion: v.union(v.string(), v.null()),
    temperature: v.number(),
    maxTokens: v.number(),
    /** `null` inherits the deployment's `LLM_TIMEOUT_MS`. */
    timeoutMs: v.union(v.number(), v.null()),
    /** Retry layer 1: HTTP attempts inside the adapter. `null` inherits `LLM_MAX_ATTEMPTS`. */
    transportMaxAttempts: v.union(v.number(), v.null()),
    /** Retry layer 2: whole-scene re-simulations (was `simulateWholeScene`'s `maxAttempts`). */
    semanticMaxAttempts: v.number(),
    /** Stored configuration only. ART-91 owns the degradation ordering that would use it. */
    fallbackModel: v.union(v.string(), v.null()),
    /** Stored configuration only. ART-59 (FR-M003) owns the enforcement that would meter it. */
    dailyTokenBudget: v.union(v.number(), v.null()),

    /** Digest of `(module, settings)`; a byte-identical resubmission dedups against it. */
    contentHash: v.string(),
    /** The operator identity, as `operatorAuditLog.operatorId` records it. */
    actor: v.string(),
    reason: v.string(),
    createdAt: v.number(),
    /** True for the live version. At most one per (worldId, module). */
    isCurrent: v.boolean(),
  })
    // The read seam resolves one row per (world, module) on the live path, so the current
    // version is an indexed point lookup rather than a scan-and-filter over the history.
    .index('by_world_module_current', ['worldId', 'module', 'isCurrent'])
    .index('by_world_module_version', ['worldId', 'module', 'version']),

  /**
   * Versioned world-level token budget, concurrency and degradation policy (FR-M003 / ART-59).
   *
   * APPEND-ONLY under the same protocol as `moduleModelConfigs`, and DELIBERATELY NOT a widening
   * of that table. The per-MODULE daily budget stays where ART-52 put it and is read from there;
   * the five dimensions here have no per-module home — `maxConcurrentCalls` is world-wide, and a
   * per-MODEL cap is keyed on a model id rather than on a module, so a row per module would have
   * to store the same model map four times and let the copies disagree.
   */
  tokenBudgetPolicies: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    /** Monotonic per world; version 1 is the first policy ever written. */
    version: v.number(),

    /** FR-M003 每日 Token 上限. `null` = unlimited. */
    worldDailyTokenBudget: v.union(v.number(), v.null()),
    /** FR-M003 每模型上限. Sorted by model and duplicate-free, so the content hash is stable. */
    modelDailyTokenBudgets: v.array(v.object({ model: v.string(), dailyTokenBudget: v.number() })),
    /** FR-M003 最大並行數. `null` = unlimited. */
    maxConcurrentCalls: v.union(v.number(), v.null()),
    /** FR-M003 Retry 預算, absolute tokens per world day. `null` = unlimited. */
    retryTokenBudget: v.union(v.number(), v.null()),
    /** §16.3 retry share ceiling. `null` = measured but not enforced (the default). */
    maxRetryTokenShare: v.union(v.number(), v.null()),
    /** §16.3 fast model class for low-importance work. `null` = none configured. */
    fastModelClass: v.union(v.string(), v.null()),
    /**
     * FR-M003 超額降級策略. `v.string()` rather than a literal union for the reason
     * `moduleModelConfigs.module` is one: the enumeration is owned by the pure model, which
     * validates on write, and duplicating it here would make adding a strategy a migration.
     */
    overBudgetStrategy: v.string(),

    contentHash: v.string(),
    actor: v.string(),
    reason: v.string(),
    createdAt: v.number(),
    isCurrent: v.boolean(),
  })
    .index('by_world_current', ['worldId', 'isCurrent'])
    .index('by_world_version', ['worldId', 'version']),

  /**
   * Settled spend and in-flight state for one (world, world day) — the counters every limit is
   * measured against (FR-M003 / ART-59).
   *
   * MUTABLE BY DESIGN, and the only mutable row ART-59 owns. A counter is a running total, and
   * appending a row per token would make the per-slot read that enforces the limit an unbounded
   * scan — house rule: no unbounded whole-world scan on a per-event path. The AUDIT of how the
   * total moved is `tokenBudgetLedger`, which is append-only; this row is the aggregate, and the
   * two are reconcilable because every ledger entry names the counter snapshot it saw.
   *
   * DAY ROLLOVER IS STRUCTURAL: the row is keyed on `worldDay`, so a new day starts from a row
   * that does not exist yet and therefore from zero. Nothing runs at midnight and nothing reads a
   * clock to decide which budget applies.
   */
  tokenBudgetCounters: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    worldDay: v.number(),
    totalTokens: v.number(),
    retryTokens: v.number(),
    tokensByModule: v.array(v.object({ module: v.string(), tokens: v.number() })),
    tokensByModel: v.array(v.object({ model: v.string(), tokens: v.number() })),
    inFlight: v.number(),
    grantedCalls: v.number(),
    settledCalls: v.number(),
    refusedCalls: v.number(),
    lowImportanceCalls: v.number(),
    lowImportanceCallsOnFastModel: v.number(),
    /**
     * Settled calls booked against a different model from the one the provider reported.
     *
     * Expected to be 0 forever. It is a stored TALLY rather than a derived number because the
     * failure it detects is silent: a per-model cap metering the wrong bucket looks healthy from
     * every other angle, so the count has to survive independently of anyone thinking to ask.
     */
    modelMeteringMismatches: v.number(),
  })
    .index('by_world_and_day', ['worldId', 'worldDay']),

  /**
   * One append-only audit row per budget decision (FR-M003 AC#2 "audited").
   *
   * The idiom is `safetyStatusOverrides` and the publication lifecycle, not a new one: a durable,
   * inspectable record of a decision, never edited, carrying the state the decision was taken
   * against. A refusal explained by "the world was at 990k of 1M" cannot be reconstructed a day
   * later from live counters, so the snapshot travels with the decision.
   *
   * SECRET-SAFE BY CONSTRUCTION: there is no free text on this row. Every field is a number, a
   * boolean, or a member of a closed enumeration owned by the pure model, except `module` and
   * `model`, which are swept for credential material on the configuration write that named them.
   * That also keeps it clear of the `/token/i` and `/prompt/i` scrub in `sanitizeForPublic` — this
   * is an operator record and never reaches a public payload.
   */
  tokenBudgetLedger: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    worldDay: v.number(),
    /** Stable per decision, so a retried mutation cannot double-count one call. */
    decisionId: v.string(),
    module: v.string(),
    requestedModel: v.string(),
    model: v.string(),
    importance: v.string(),
    origin: v.string(),
    attempt: v.number(),
    countedAsRetry: v.boolean(),
    estimatedTokens: v.number(),
    /** Whether `model` is the configured fast class — §16.3 AC#5's numerator, per decision. */
    onFastModel: v.boolean(),
    outcome: v.string(),
    strategy: v.union(v.string(), v.null()),
    strategyFallbackReason: v.union(v.string(), v.null()),
    routingReason: v.union(v.string(), v.null()),
    boundLimit: v.union(v.string(), v.null()),
    /** EVERY breached limit, never truncated to the binding one. */
    breachedLimits: v.array(v.string()),
    observedTotalTokens: v.number(),
    observedRetryTokens: v.number(),
    observedModuleTokens: v.number(),
    observedModelTokens: v.number(),
    observedInFlight: v.number(),
    /** The policy version the decision was taken under; `null` when running on defaults. */
    policyVersion: v.union(v.number(), v.null()),
    recordedAt: v.number(),

    /**
     * How a GRANTED reservation ended, and the one field on this row that is ever written twice.
     *
     * A refusal is born `settled` with zero tokens: nothing was granted, so there is nothing left
     * to resolve. A grant is born `pending` and moves to `settled` (the provider reported usage)
     * or `released` (it threw before reporting any). Those are the only transitions, and the
     * enforcement path refuses to make one twice — which is what makes settlement idempotent
     * under a retried Convex mutation and is why the DECISION half of the row can stay
     * append-only while the day's totals are still exact.
     */
    resolution: v.union(v.literal('pending'), v.literal('settled'), v.literal('released')),
    /** Tokens actually booked. `null` until resolved, and for a released reservation. */
    settledTokens: v.union(v.number(), v.null()),
    /**
     * The model the provider REPORTED running, recorded next to the `model` it was metered under.
     *
     * Two fields rather than one, so a mismatch is inspectable per decision rather than only as a
     * tally: an operator seeing a non-zero `modelMeteringMismatches` needs to know WHICH model the
     * meter and the provider disagreed about. `null` until resolved, and for a released
     * reservation, which ran nothing to report.
     */
    settledModel: v.union(v.string(), v.null()),
  })
    // The enforcement path checks this decision's own id before writing (idempotency), and the
    // operator read is always scoped to one world day. Neither is a whole-table scan.
    .index('by_decision_id', ['decisionId'])
    .index('by_world_and_day', ['worldId', 'worldDay']),
};
