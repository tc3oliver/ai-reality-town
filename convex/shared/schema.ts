import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Tables owned by `shared` (FR-K005 / ART-52).
 *
 * `shared` normally holds pure modules, and this is the one table that has to live here: the
 * per-module model configuration is WRITTEN by `operations` (the authorized console) and READ by
 * `simulation` (the live scene call path), and `architecture/module-boundaries.json` forbids
 * `simulation → operations`. A table definition carries no logic, so nothing about the module's
 * purity discipline is lost — the pure model beside it in `./moduleModelConfig.ts` is where the
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
};
