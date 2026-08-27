/**
 * Audited per-module model / prompt / retry / budget configuration (FR-K005, ART-52).
 *
 * ## What this replaces
 *
 * Before this module every one of the eight FR-K005 settings was a hardcoded constant or a
 * deployment environment variable, global to the whole deployment:
 *
 * | Setting        | Where it lived before                                                      |
 * | -------------- | -------------------------------------------------------------------------- |
 * | Model          | `LLM_MODEL` env → `simulation/providers/config.ts` (one model, all modules) |
 * | Prompt Version | did not exist; the prompt is a code literal in `sceneSimulation.ts`         |
 * | Temperature    | `0.4` / `0.2` / `0` literals at three call sites                           |
 * | Token Limit    | `4_000` / `2_000` / `32` literals at the same three sites                  |
 * | Timeout        | `LLM_TIMEOUT_MS` env, default `30_000`                                     |
 * | Retry          | `LLM_MAX_ATTEMPTS` env (transport) + a `maxAttempts = 2` default (semantic) |
 * | Fallback       | did not exist                                                              |
 * | Daily Budget   | did not exist                                                              |
 *
 * ## Scope: this module CONFIGURES; it does not ENFORCE
 *
 * `fallbackModel` and `dailyTokenBudget` are stored, versioned, authorized, audited and
 * readable — and nothing here spends, meters, or switches on them. That boundary is taken
 * from the task graph rather than invented:
 *
 * - **ART-59 (FR-M003)** owns enforcement. Its AC#1 is literally "Enforce daily token,
 *   per-module, per-model, concurrency, and retry-budget limits", and it depends on this task.
 * - **ART-91** owns the ordered degradation path (same-model retry → compatible model → fewer
 *   scenes → …), and depends on both.
 *
 * Building budget accounting or fallback switching here would duplicate work those tasks own,
 * and would do it without the spend ledger and the concurrency model they define. See
 * `docs/model-configuration.md` §7.
 *
 * ## Purity
 *
 * No Convex import, no clock, no randomness, no I/O. `now` is always a parameter and every
 * store interaction goes through {@link ModuleModelConfigStore}, so the whole versioning
 * protocol is unit testable without a deployment. The Convex wiring lives in
 * `convex/operations/moduleModelConfigFunctions.ts` (write + operator read) and
 * `convex/simulation/moduleConfig.ts` (the simulation read seam).
 *
 * ## Why `shared`
 *
 * `simulation` must read this on the live call path and `operations` must write it, but
 * `architecture/module-boundaries.json` forbids `simulation → operations` (the edge runs the
 * other way). `shared` depends on nothing, so both sides import the SAME defaults, the same
 * validator and the same resolver — a second copy of "what temperature is configured" is
 * exactly the divergence that ends with the console reporting a value the simulation never used.
 */

export const MODULE_MODEL_CONFIG_SCHEMA_VERSION = 1 as const;

/**
 * The per-module configuration keys.
 *
 * Named in the style of the `postCommitStage` enumeration in `convex/operations/schema.ts`
 * (snake_case, one key per pipeline concern) so the two read as one vocabulary rather than two.
 *
 * HONESTY NOTE — only `scene_simulation` has a real consumer today. It is the single module in
 * the repository that calls a language model. `director_plan`, `character_intent` and
 * `editorial` are deterministic algorithms with no provider dependency at all: they are
 * declared here so a config written for them is stored, versioned and audited the same way,
 * and so the console does not have to grow a new key the day one of them acquires a provider.
 * Nothing reads their rows. They are placeholders and are documented as placeholders; see
 * {@link MODULES_WITH_PROVIDER_CONSUMERS} and `docs/model-configuration.md` §2.
 *
 * `editorial` names the module that owns the `episode` and `recap` post-commit stages; it is
 * one key rather than two because a single editorial provider would author both.
 */
export const CONFIGURABLE_MODULES = [
  'scene_simulation',
  'director_plan',
  'character_intent',
  'editorial',
] as const;

export type ConfigurableModule = (typeof CONFIGURABLE_MODULES)[number];

/**
 * Modules whose configuration is actually read by a provider call path today.
 *
 * Exported and asserted on rather than described in prose, so the claim above cannot quietly
 * become false: adding a real consumer means adding the key here and the test that pins the
 * placeholder set fails until the docs are updated with it.
 */
export const MODULES_WITH_PROVIDER_CONSUMERS: readonly ConfigurableModule[] = ['scene_simulation'];

export function isConfigurableModule(value: unknown): value is ConfigurableModule {
  return typeof value === 'string' && (CONFIGURABLE_MODULES as readonly string[]).includes(value);
}

/**
 * Prompt version ids for the whole-scene simulation module.
 *
 * Kept as its OWN list rather than as a slice of {@link PROMPT_VERSION_IDS}, because
 * `convex/simulation/promptVersions.ts` pins its registry to it with
 * `satisfies Record<SceneSimulationPromptVersionId, …>` — an EXHAUSTIVE mapping, so an id added
 * here without a builder is a compile error.
 *
 * That is the whole point of the split. A single flat list could only be checked with
 * `Partial<Record<…>>`, which makes every key optional and therefore checks nothing: an id
 * registered with no builder would type-check, the operator write naming it would be accepted,
 * and every world-day slot for that world would then fail at runtime with a permanent
 * `PROMPT_VERSION_UNKNOWN` and no earlier signal. Per-module lists keep exhaustiveness real
 * while still letting a future `director_plan.v1` exist without a whole-scene builder.
 */
export const SCENE_SIMULATION_PROMPT_VERSION_IDS = ['scene_simulation.v1'] as const;
export type SceneSimulationPromptVersionId = (typeof SCENE_SIMULATION_PROMPT_VERSION_IDS)[number];

/**
 * Every registered prompt version id, across all modules.
 *
 * Only the ID is ever stored (AC#3). Prompt BODIES stay in reviewed repository source.
 *
 * Storing bodies would break AC#3 outright, and would also be silently self-defeating:
 * `sanitizeForPublic` (`convex/publicRead/readModel.ts`) drops any key matching `/prompt/i`, so
 * a stored body would vanish from anything that ever passed through the public allowlist rather
 * than being caught. The same rule matches `/token/i`, which is the second reason this
 * configuration is kept off the public read path entirely: `maxTokens` and `dailyTokenBudget`
 * would be silently deleted from a payload that tried to carry them.
 */
export const PROMPT_VERSION_IDS = [...SCENE_SIMULATION_PROMPT_VERSION_IDS] as const;
export type PromptVersionId = (typeof PROMPT_VERSION_IDS)[number];

export function isPromptVersionId(value: unknown): value is PromptVersionId {
  return typeof value === 'string' && (PROMPT_VERSION_IDS as readonly string[]).includes(value);
}

/**
 * The eight FR-K005 settings, with Retry split into the two layers that actually exist.
 *
 * `null` consistently means "not configured — inherit the deployment-level value". That is a
 * different statement from a number, and collapsing the two would make an operator unable to
 * express "use whatever `LLM_MODEL` is" once they had ever set a model.
 *
 * EXACTLY the three settings that have a deployment environment variable behind them are
 * nullable for that reason — `model` (`LLM_MODEL`), `timeoutMs` (`LLM_TIMEOUT_MS`) and
 * `transportMaxAttempts` (`LLM_MAX_ATTEMPTS`) — and all three default to `null`. This is not
 * cosmetic symmetry. If they carried concrete defaults instead, an UNCONFIGURED world would
 * send those numbers as per-request overrides, and a per-request override always beats the
 * provider instance's value — so a deployment running `LLM_TIMEOUT_MS=90000` would silently
 * drop to 30s the moment this table existed, on a world nobody had configured. That is the
 * regression this nullability exists to prevent, and `moduleConfigSelection.test.ts` asserts
 * the resulting request carries no override at all.
 *
 * `temperature`, `maxTokens` and `semanticMaxAttempts` are NOT nullable, because they never had
 * an environment variable: their pre-ART-52 values were code literals, so a concrete default
 * here reproduces the old behaviour exactly rather than overriding something.
 */
export type ModuleModelSettings = {
  /** FR-K005 "Model". `null` inherits the deployment's `LLM_MODEL`. */
  model: string | null;
  /** FR-K005 "Prompt Version". An id from {@link PROMPT_VERSION_IDS}; `null` for a module with no registered prompt. */
  promptVersion: PromptVersionId | null;
  /** FR-K005 "Temperature". 0…2, matching the OpenAI-compatible wire contract. */
  temperature: number;
  /** FR-K005 "Token Limit" — the per-request completion cap (`max_tokens`). */
  maxTokens: number;
  /**
   * FR-K005 "Timeout" — per-HTTP-attempt, applied through the adapter's `AbortController`.
   * `null` inherits the deployment's `LLM_TIMEOUT_MS` (whose own default is 30_000).
   */
  timeoutMs: number | null;
  /**
   * FR-K005 "Retry", layer 1: HTTP attempts inside the provider adapter. Retries a
   * 429/5xx/timeout against the SAME request. `null` inherits the deployment's
   * `LLM_MAX_ATTEMPTS` (whose own default is 3).
   */
  transportMaxAttempts: number | null;
  /**
   * FR-K005 "Retry", layer 2: whole-scene re-simulations, previously the `maxAttempts = 2`
   * default parameter of `simulateWholeScene`. Retries when the model returned a well-formed
   * HTTP response whose CONTENT did not parse as a scene.
   *
   * Kept distinguishable from layer 1 deliberately: they fail for different reasons, cost
   * different amounts, and one of them re-runs the prompt while the other does not. Folding
   * them into a single number would make "3 retries" mean up to nine provider calls without
   * saying so.
   */
  semanticMaxAttempts: number;
  /**
   * FR-K005 "Fallback" — the model id to degrade to. STORED ONLY; no code switches to it.
   * ART-91 owns the degradation ordering.
   */
  fallbackModel: string | null;
  /**
   * FR-K005 "Daily Budget" — tokens per world-day for this module. STORED ONLY; nothing meters
   * spend against it. ART-59 owns enforcement.
   */
  dailyTokenBudget: number | null;
};

/** Upper bounds. Deliberately generous — these refuse absurdity, they are not a policy. */
export const MAX_MODEL_ID_LENGTH = 200;
export const MAX_REASON_LENGTH = 500;
export const MAX_ACTOR_LENGTH = 200;
export const MAX_TEMPERATURE = 2;
export const MAX_TOKEN_LIMIT = 1_000_000;
export const MAX_TIMEOUT_MS = 600_000;
export const MAX_TRANSPORT_ATTEMPTS = 10;
/**
 * The semantic ceiling stays 3, the bound `simulateWholeScene` has always enforced. A whole-scene
 * retry re-runs the entire prompt, so a higher cap multiplies cost against a model that has
 * already failed to produce parseable content twice.
 */
export const MAX_SEMANTIC_ATTEMPTS = 3;
export const MAX_DAILY_TOKEN_BUDGET = 1_000_000_000;

/**
 * Behaviour-preserving defaults: the values the code used BEFORE this table existed.
 *
 * A world with no config row therefore behaves exactly as it did, and
 * `moduleConfigSelection.test.ts` pins that rather than trusting this comment.
 *
 * The concrete numbers are the code literals from `sceneSimulation.ts`: 0.4 temperature, 4_000
 * tokens, 2 semantic attempts. The three settings with a deployment environment variable behind
 * them — `model`, `timeoutMs`, `transportMaxAttempts` — default to `null` INSTEAD of to
 * `LLM_TIMEOUT_MS`/`LLM_MAX_ATTEMPTS`'s own fallbacks of 30_000 and 3. Restating those two
 * numbers here would fork the default: a deployment that had set either variable would find an
 * unconfigured world quietly ignoring it, because a per-request override always beats the
 * provider instance value. `null` keeps the deployment as the single source of that answer.
 *
 * The three placeholder modules carry the same numbers. That is not a claim that 0.4 is right
 * for a Director prompt — nothing reads them — it is the least surprising thing to show an
 * operator who opens the console before a consumer exists.
 */
export const MODULE_MODEL_DEFAULTS: Readonly<Record<ConfigurableModule, ModuleModelSettings>> = {
  scene_simulation: {
    model: null,
    promptVersion: 'scene_simulation.v1',
    temperature: 0.4,
    maxTokens: 4_000,
    timeoutMs: null,
    transportMaxAttempts: null,
    semanticMaxAttempts: 2,
    fallbackModel: null,
    dailyTokenBudget: null,
  },
  director_plan: {
    model: null, promptVersion: null, temperature: 0.4, maxTokens: 4_000, timeoutMs: null,
    transportMaxAttempts: null, semanticMaxAttempts: 2, fallbackModel: null, dailyTokenBudget: null,
  },
  character_intent: {
    model: null, promptVersion: null, temperature: 0.4, maxTokens: 4_000, timeoutMs: null,
    transportMaxAttempts: null, semanticMaxAttempts: 2, fallbackModel: null, dailyTokenBudget: null,
  },
  editorial: {
    model: null, promptVersion: null, temperature: 0.4, maxTokens: 4_000, timeoutMs: null,
    transportMaxAttempts: null, semanticMaxAttempts: 2, fallbackModel: null, dailyTokenBudget: null,
  },
};

export class ModuleModelConfigError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ModuleModelConfigError';
  }
}

const invalid = (message: string): ModuleModelConfigError =>
  new ModuleModelConfigError('MODULE_CONFIG_INVALID', message);

/**
 * Field names that may never appear on a submitted configuration, and substrings that may never
 * appear inside one of its string VALUES.
 *
 * Deliberately the same list as `FORBIDDEN_AUDIT_FIELDS` in
 * `convex/operations/operatorAuthorization.ts`, and deliberately a copy rather than an import:
 * `shared` may not depend on `operations`. `moduleModelConfig.test.ts` asserts the two lists are
 * equal, so the copy cannot drift silently.
 */
export const FORBIDDEN_CONFIG_FIELDS = [
  'token', 'operatortoken', 'apikey', 'authorization', 'password', 'secret',
] as const;

/**
 * Refuse anything credential-shaped before it can be stored (AC#3).
 *
 * Two sweeps, because a secret can arrive two ways. An extra KEY (`apiKey: 'sk-…'`) is the
 * obvious one — Convex's argument validator would already reject it at the mutation boundary,
 * but this runs anyway so the rule holds for every caller of the pure model, not only the one
 * that happens to go through a validator. A credential smuggled inside a legitimate string
 * VALUE (`model: 'gpt-4 apikey=sk-…'`) is the one a validator cannot see, and it is checked
 * with the same `field=` / `field:` shape `buildOperatorAuditEntry` uses.
 *
 * Note `token` is on the list while `maxTokens` is a legal field name: the key check is exact
 * (case-insensitive), not a substring match, precisely so the setting named after tokens is not
 * mistaken for a credential.
 */
export function assertNoCredentialMaterial(raw: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(raw)) {
    if ((FORBIDDEN_CONFIG_FIELDS as readonly string[]).includes(key.toLowerCase())) {
      throw new ModuleModelConfigError(
        'MODULE_CONFIG_SECRET_LEAK',
        'model configuration must not carry credential material',
      );
    }
  }
  for (const value of Object.values(raw)) {
    if (typeof value !== 'string') continue;
    const lowered = value.toLowerCase();
    if (FORBIDDEN_CONFIG_FIELDS.some((field) => lowered.includes(`${field}=`) || lowered.includes(`${field}:`))) {
      throw new ModuleModelConfigError(
        'MODULE_CONFIG_SECRET_LEAK',
        'model configuration must not carry credential material',
      );
    }
  }
}

function assertBoundedModelId(value: string | null, label: string): void {
  if (value === null) return;
  if (value.trim().length === 0) throw invalid(`${label} must be a non-empty string or null`);
  if (value.length > MAX_MODEL_ID_LENGTH) throw invalid(`${label} must be at most ${MAX_MODEL_ID_LENGTH} characters`);
}

function assertPositiveInteger(value: number, label: string, max: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid(`${label} must be a positive integer`);
  if (value > max) throw invalid(`${label} must be at most ${max}`);
}

/** Validate one settings object. Throws on the first problem; never normalises silently. */
export function assertModuleModelSettings(
  module: ConfigurableModule,
  settings: ModuleModelSettings,
): void {
  if (!isConfigurableModule(module)) throw invalid(`unknown module: ${String(module)}`);
  assertBoundedModelId(settings.model, 'model');
  assertBoundedModelId(settings.fallbackModel, 'fallbackModel');
  if (settings.promptVersion !== null && !isPromptVersionId(settings.promptVersion)) {
    // Refused at WRITE time, so an operator cannot store a version that does not exist. (A
    // version RETIRED after a configuration referenced it is a different case, handled by
    // `resolveEffectiveModuleConfig` falling back to the defaults rather than by a throw.)
    throw invalid(`unknown promptVersion: ${String(settings.promptVersion)}`);
  }
  if (settings.promptVersion === null && MODULES_WITH_PROVIDER_CONSUMERS.includes(module)) {
    // A module that actually calls a model must name the prompt it calls it with. `null` is
    // reserved for the placeholder modules, where it honestly means "no prompt exists yet".
    throw invalid(`${module} requires a promptVersion`);
  }
  if (typeof settings.temperature !== 'number' || !Number.isFinite(settings.temperature)
    || settings.temperature < 0 || settings.temperature > MAX_TEMPERATURE) {
    throw invalid(`temperature must be a finite number between 0 and ${MAX_TEMPERATURE}`);
  }
  assertPositiveInteger(settings.maxTokens, 'maxTokens', MAX_TOKEN_LIMIT);
  // `null` is legal for the two env-backed settings and means "inherit the deployment value";
  // a NUMBER is validated exactly as before.
  if (settings.timeoutMs !== null) {
    assertPositiveInteger(settings.timeoutMs, 'timeoutMs', MAX_TIMEOUT_MS);
  }
  if (settings.transportMaxAttempts !== null) {
    assertPositiveInteger(settings.transportMaxAttempts, 'transportMaxAttempts', MAX_TRANSPORT_ATTEMPTS);
  }
  assertPositiveInteger(settings.semanticMaxAttempts, 'semanticMaxAttempts', MAX_SEMANTIC_ATTEMPTS);
  if (settings.dailyTokenBudget !== null) {
    assertPositiveInteger(settings.dailyTokenBudget, 'dailyTokenBudget', MAX_DAILY_TOKEN_BUDGET);
  }
}

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/**
 * Deterministic stable serialisation, then a djb2 digest.
 *
 * The same protocol `hashPayload` uses in `convex/publicRead/readModel.ts`, reimplemented here
 * only because `shared` may not depend on `publicRead`. Not cryptographic — uniqueness is for
 * dedup, not for tamper evidence. The `mmc:` prefix keeps the two hash spaces distinguishable in
 * a log.
 */
export function hashModuleModelSettings(module: ConfigurableModule, settings: ModuleModelSettings): string {
  const payload: Record<string, unknown> = { module, ...settings };
  const text = `{${Object.keys(payload).sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(payload[key] ?? null)}`)
    .join(',')}}`;
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return `mmc:${hash.toString(16)}`;
}

/** A persisted configuration version. Append-only: a change writes a new row (AC#2). */
export type ModuleModelConfigRecord = ModuleModelSettings & {
  schemaVersion: typeof MODULE_MODEL_CONFIG_SCHEMA_VERSION;
  worldId: string;
  module: ConfigurableModule;
  /** Monotonic per (worldId, module). Version 1 is the first configuration ever written. */
  version: number;
  contentHash: string;
  /** The operator identity, as `operatorAuditLog.operatorId` records it. */
  actor: string;
  reason: string;
  createdAt: number;
  /** True for the live version. At most one per (worldId, module). */
  isCurrent: boolean;
};

export type StoredModuleModelConfig = ModuleModelConfigRecord & { id: string };

/**
 * Repository surface for the versioned write. The Convex mutation adapts `ctx.db` to this;
 * tests supply an in-memory implementation.
 */
export interface ModuleModelConfigStore {
  findCurrent(worldId: string, module: ConfigurableModule): Promise<StoredModuleModelConfig | null>;
  insertVersion(row: ModuleModelConfigRecord): Promise<string>;
  /** Demote a previously-current row. The row itself is never edited otherwise. */
  demote(rowId: string): Promise<void>;
}

export type CommitModuleModelConfigResult = {
  version: number;
  contentHash: string;
  deduplicated: boolean;
};

/**
 * Commit a new configuration version.
 *
 * The protocol is transplanted from `commitReadModelVersion`
 * (`convex/publicRead/readModel.ts`), because the two problems are the same problem:
 *
 * - **Monotonic per target.** `version` counts per `(worldId, module)`, so a world's scene
 *   configuration is at v4 while its editorial configuration is still at v1.
 * - **Content-hash dedup.** Resubmitting a configuration byte-identical to the current one
 *   returns `{ deduplicated: true }` and appends nothing. Without this an ops console that
 *   re-saves an unchanged form, or a retried mutation, would inflate the version history with
 *   rows that record no decision — and the audit trail would stop meaning "someone changed
 *   something". The `reason` and `actor` are deliberately NOT part of the hash: a new reason for
 *   the same numbers is not a configuration change.
 * - **Insert new, THEN demote prior.** If the insert fails, the previously-current row is
 *   untouched and keeps being served. The reverse order would leave a window with no current
 *   configuration at all, during which every reader would silently fall back to defaults.
 * - **At most one `isCurrent`.** Guaranteed by demoting exactly the row that was current — and,
 *   underneath that, by the atomicity of the surrounding Convex mutation, which serialises two
 *   concurrent writes for the same target rather than letting both read the same `findCurrent`
 *   and both insert. The invariant is worth stating as a dependency because the live simulation
 *   path reads it with `.unique()`: two current rows would not merely confuse the console, they
 *   would make `resolveModuleConfig` throw and take that world's slots down with it.
 */
export async function commitModuleModelConfig(
  store: ModuleModelConfigStore,
  input: {
    worldId: string;
    module: ConfigurableModule;
    settings: ModuleModelSettings;
    actor: string;
    reason: string;
    now: number;
  },
): Promise<CommitModuleModelConfigResult> {
  if (input.worldId.trim().length === 0) throw invalid('worldId must be non-empty');
  if (!isConfigurableModule(input.module)) throw invalid(`unknown module: ${String(input.module)}`);
  if (input.actor.trim().length === 0 || input.actor.length > MAX_ACTOR_LENGTH) {
    throw invalid(`actor must be a non-empty string of at most ${MAX_ACTOR_LENGTH} characters`);
  }
  // NFR-005: a privileged change states why. Enforced here as well as at the console gate, so a
  // second caller cannot append an unreasoned version.
  if (input.reason.trim().length === 0 || input.reason.length > MAX_REASON_LENGTH) {
    throw invalid(`reason must be a non-empty string of at most ${MAX_REASON_LENGTH} characters`);
  }
  if (!Number.isFinite(input.now)) throw invalid('now must be finite');
  // `worldId` is swept too: with `actor` supplied by the gate and `reason` free text, it is the
  // remaining caller-controlled string on this path, and a stored row is a durable record.
  assertNoCredentialMaterial({
    ...input.settings, worldId: input.worldId, actor: input.actor, reason: input.reason,
  });
  assertModuleModelSettings(input.module, input.settings);

  const contentHash = hashModuleModelSettings(input.module, input.settings);
  const current = await store.findCurrent(input.worldId, input.module);
  if (current && current.contentHash === contentHash) {
    return { version: current.version, contentHash, deduplicated: true };
  }

  const version = current ? current.version + 1 : 1;
  const row: ModuleModelConfigRecord = {
    schemaVersion: MODULE_MODEL_CONFIG_SCHEMA_VERSION,
    worldId: input.worldId,
    module: input.module,
    version,
    ...input.settings,
    contentHash,
    actor: input.actor,
    reason: input.reason,
    createdAt: input.now,
    isCurrent: true,
  };
  await store.insertVersion(row);
  if (current) await store.demote(current.id);
  return { version, contentHash, deduplicated: false };
}

// ---------------------------------------------------------------------------
// Resolution (the read seam)
// ---------------------------------------------------------------------------

/** What a caller on the simulation path actually acts on. */
export type EffectiveModuleConfig = ModuleModelSettings & {
  module: ConfigurableModule;
  /** `'default'` when no configuration row exists for this world+module. */
  source: 'default' | 'configured';
  /** The configured version, or `null` when running on defaults. */
  version: number | null;
};

/**
 * Turn "the current row, if any" into the settings a caller uses.
 *
 * A world with no row resolves to {@link MODULE_MODEL_DEFAULTS}, which are the pre-ART-52
 * hardcoded values — so this whole change is behaviour-preserving on an unconfigured world.
 *
 * A stored row that no longer validates (a schema change, a hand-edited row) resolves to the
 * defaults too, rather than throwing. A malformed configuration must not be able to stop a world
 * simulating; it should make the world run the documented defaults and be visible as such,
 * which `source` and `version` report.
 */
export function resolveEffectiveModuleConfig(
  module: ConfigurableModule,
  row: ModuleModelSettings & { version: number } | null,
): EffectiveModuleConfig {
  const defaults = MODULE_MODEL_DEFAULTS[module];
  if (!row) return { module, source: 'default', version: null, ...defaults };
  const settings: ModuleModelSettings = {
    model: row.model,
    promptVersion: row.promptVersion,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    timeoutMs: row.timeoutMs,
    transportMaxAttempts: row.transportMaxAttempts,
    semanticMaxAttempts: row.semanticMaxAttempts,
    fallbackModel: row.fallbackModel,
    dailyTokenBudget: row.dailyTokenBudget,
  };
  try {
    assertModuleModelSettings(module, settings);
  } catch {
    return { module, source: 'default', version: null, ...defaults };
  }
  return { module, source: 'configured', version: row.version, ...settings };
}

// ---------------------------------------------------------------------------
// Operator projection
// ---------------------------------------------------------------------------

/**
 * The secret-safe projection an operator read returns.
 *
 * Modelled on `describeOpenAICompatibleConfig` (`simulation/providers/config.ts`): an allowlist
 * of named safe fields, never a spread of whatever the row happens to hold. The difference
 * matters when a field is added — a spread would publish it by default, an allowlist would not.
 *
 * There is no `apiKey` here and there is no prompt body: the only prompt-shaped thing that
 * exists in this system is an ID, and the bodies live in repository source.
 */
export type ModuleModelConfigView = ModuleModelSettings & {
  module: ConfigurableModule;
  source: 'default' | 'configured';
  version: number | null;
  contentHash: string | null;
  actor: string | null;
  reason: string | null;
  createdAt: number | null;
};

export function describeModuleModelConfig(
  effective: EffectiveModuleConfig,
  provenance: { contentHash: string; actor: string; reason: string; createdAt: number } | null,
): ModuleModelConfigView {
  return {
    module: effective.module,
    source: effective.source,
    version: effective.version,
    model: effective.model,
    promptVersion: effective.promptVersion,
    temperature: effective.temperature,
    maxTokens: effective.maxTokens,
    timeoutMs: effective.timeoutMs,
    transportMaxAttempts: effective.transportMaxAttempts,
    semanticMaxAttempts: effective.semanticMaxAttempts,
    fallbackModel: effective.fallbackModel,
    dailyTokenBudget: effective.dailyTokenBudget,
    contentHash: provenance?.contentHash ?? null,
    actor: provenance?.actor ?? null,
    reason: provenance?.reason ?? null,
    createdAt: provenance?.createdAt ?? null,
  };
}
