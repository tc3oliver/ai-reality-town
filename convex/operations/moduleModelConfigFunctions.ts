/**
 * Convex wiring for FR-K005 per-module model configuration (ART-52).
 *
 * ## One gate, not a second one
 *
 * `requireOperator` and `recordAudit` come from `opsConsoleFunctions` rather than being
 * reimplemented, so these commands inherit the WHOLE gate: fail-closed on an unset registry, the
 * identity-over-token precedence, the `CLERK_JWT_ISSUER_DOMAIN` cutover, the uniform
 * `OPS_UNAUTHORIZED` denial raised before any row is read, and an audit row written inside the
 * command's own transaction. `pauseWorld` set the ordering — authorize FIRST, act, then audit —
 * and this follows it exactly.
 *
 * `operatorAuditLog` needs no schema change: `capability` is `v.string()`, so the two new
 * capabilities record themselves.
 *
 * ## Secret and prompt safety (AC#3)
 *
 * The read projection is an ALLOWLIST built by `describeModuleModelConfig`, modelled on
 * `describeOpenAICompatibleConfig`. There is no `apiKey` field to return and no prompt body to
 * return — `promptVersion` is an ID whose body lives in repository source. `commitModuleModelConfig`
 * additionally refuses any submitted value carrying credential-shaped material before it is
 * stored.
 *
 * None of this is on the public read path. It is not merely undeclared there: `sanitizeForPublic`
 * strips every key matching `/prompt/i` AND `/token/i`, so `promptVersion`, `maxTokens` and
 * `dailyTokenBudget` would be silently deleted from any public payload that tried to carry them.
 * Configuration is an operator concern and stays one.
 *
 * ## What these endpoints do NOT do
 *
 * They do not spend, meter, or enforce a budget, and they do not switch to the fallback model.
 * ART-59 (FR-M003) owns enforcement and ART-91 owns the degradation ordering; both depend on
 * this task. See `docs/model-configuration.md` §7.
 */

import { v } from 'convex/values';

import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import {
  CONFIGURABLE_MODULES,
  commitModuleModelConfig,
  describeModuleModelConfig,
  isConfigurableModule,
  resolveEffectiveModuleConfig,
  MODULE_MODEL_DEFAULTS,
  ModuleModelConfigError,
  type ConfigurableModule,
  type ModuleModelConfigRecord,
  type ModuleModelConfigStore,
  type ModuleModelConfigView,
  type ModuleModelSettings,
  type PromptVersionId,
  type StoredModuleModelConfig,
} from '../shared/moduleModelConfig';
import {
  commandArgs,
  credentialArgs,
  operatorNow,
  recordAudit,
  requireOperator,
} from './opsConsoleFunctions';

/**
 * Widen a stored row into the pure model's shape.
 *
 * `module` and `promptVersion` are `v.string()` in the schema and narrowed here, deliberately in
 * that direction: the enumerations are owned by the pure model, which validates on write, so a
 * row written under a module or prompt id that has since been retired can still be READ (the
 * version history has to stay readable) while `resolveEffectiveModuleConfig` decides whether it
 * is still safe to ACT on.
 */
function toStored(row: Doc<'moduleModelConfigs'>): StoredModuleModelConfig {
  return {
    id: row._id,
    schemaVersion: 1,
    worldId: row.worldId,
    module: row.module as ConfigurableModule,
    version: row.version,
    model: row.model,
    promptVersion: row.promptVersion as PromptVersionId | null,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    timeoutMs: row.timeoutMs,
    transportMaxAttempts: row.transportMaxAttempts,
    semanticMaxAttempts: row.semanticMaxAttempts,
    fallbackModel: row.fallbackModel,
    dailyTokenBudget: row.dailyTokenBudget,
    contentHash: row.contentHash,
    actor: row.actor,
    reason: row.reason,
    createdAt: row.createdAt,
    isCurrent: row.isCurrent,
  };
}

async function readCurrent(
  ctx: QueryCtx | MutationCtx,
  worldId: string,
  module: ConfigurableModule,
): Promise<StoredModuleModelConfig | null> {
  const row = await ctx.db
    .query('moduleModelConfigs')
    .withIndex('by_world_module_current', (q) =>
      q.eq('worldId', worldId).eq('module', module).eq('isCurrent', true))
    .unique();
  return row === null ? null : toStored(row);
}

/**
 * Adapt `ctx.db` to the pure model's store.
 *
 * `demote` is the ONLY patch this surface performs, and it touches exactly one boolean. The
 * settings on a stored row are never edited: a change appends a version, which is what makes the
 * table an account of decisions rather than a snapshot of the latest one.
 */
function createModuleModelConfigStore(ctx: MutationCtx): ModuleModelConfigStore {
  return {
    findCurrent: (worldId, module) => readCurrent(ctx, worldId, module),
    insertVersion: (row: ModuleModelConfigRecord) => ctx.db.insert('moduleModelConfigs', row),
    demote: (rowId: string) => ctx.db.patch(rowId as Id<'moduleModelConfigs'>, { isCurrent: false }),
  };
}

/** Refuse an unknown module with the uniform console error shape. */
function assertModule(value: string): ConfigurableModule {
  if (!isConfigurableModule(value)) {
    throw new ModuleModelConfigError('MODULE_CONFIG_INVALID', `unknown module: ${value}`);
  }
  return value;
}

/**
 * The eight FR-K005 settings as mutation arguments (nine fields — Retry is two layers).
 *
 * Every field is REQUIRED. A partial update would mean the stored version does not describe a
 * complete configuration, and the content hash that makes a resubmission deduplicate would be
 * computed over a merge of the request and whatever happened to be current — so "the same
 * configuration" would stop being a property of the request. Callers send the whole object; the
 * read query returns exactly that shape so a console can round-trip it.
 */
const settingsArgs = {
  model: v.union(v.string(), v.null()),
  promptVersion: v.union(v.string(), v.null()),
  temperature: v.number(),
  maxTokens: v.number(),
  timeoutMs: v.union(v.number(), v.null()),
  transportMaxAttempts: v.union(v.number(), v.null()),
  semanticMaxAttempts: v.number(),
  fallbackModel: v.union(v.string(), v.null()),
  dailyTokenBudget: v.union(v.number(), v.null()),
} as const;

/**
 * FR-K005 AC#1 + AC#2 — configure one module, versioned, authorized and audited.
 *
 * Idempotent by content hash: resubmitting a byte-identical configuration returns
 * `deduplicated: true`, appends no row, and records a `no_op` in the audit trail. The audit row
 * is still written — an operator pressing save on an unchanged form is part of the account of
 * what happened, and a silent drop would leave a gap in it.
 */
export const setModuleModelConfig = mutation({
  args: { ...commandArgs, module: v.string(), ...settingsArgs, now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireOperator(ctx, 'model_config.write', args);
    const at = operatorNow(args.now);
    const module = assertModule(args.module);
    const settings: ModuleModelSettings = {
      model: args.model,
      promptVersion: args.promptVersion as PromptVersionId | null,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      timeoutMs: args.timeoutMs,
      transportMaxAttempts: args.transportMaxAttempts,
      semanticMaxAttempts: args.semanticMaxAttempts,
      fallbackModel: args.fallbackModel,
      dailyTokenBudget: args.dailyTokenBudget,
    };
    const result = await commitModuleModelConfig(createModuleModelConfigStore(ctx), {
      worldId: args.worldId,
      module,
      settings,
      actor: principal.operatorId,
      reason: args.reason,
      now: at,
    });
    await recordAudit(ctx, {
      principal,
      worldId: args.worldId,
      capability: 'model_config.write',
      target: `${module}:v${result.version}`,
      reason: args.reason,
      outcome: result.deduplicated ? 'no_op' : 'applied',
      resultCode: result.deduplicated ? 'OPS_NO_OP' : 'OPS_OK',
      at,
    });
    return { module, version: result.version, contentHash: result.contentHash, deduplicated: result.deduplicated };
  },
});

/**
 * FR-K005 AC#1/AC#3 — what every module is currently configured to do.
 *
 * Returns one entry per {@link CONFIGURABLE_MODULES} key, including modules with no stored row,
 * which report `source: 'default'` and the pre-ART-52 values. Reporting only configured modules
 * would let an operator read the console as "scene simulation is the only module", which is a
 * different (and false) statement from "the others run the documented defaults".
 *
 * `model_config.inspect` is a `viewer` capability, so reading the configuration does not require
 * the authority to change it.
 */
export const inspectModuleModelConfig = query({
  args: { ...credentialArgs, worldId: v.string() },
  handler: async (ctx, args): Promise<{ modules: ModuleModelConfigView[] }> => {
    await requireOperator(ctx, 'model_config.inspect', args);
    const modules: ModuleModelConfigView[] = [];
    for (const module of CONFIGURABLE_MODULES) {
      const current = await readCurrent(ctx, args.worldId, module);
      modules.push(describeModuleModelConfig(
        resolveEffectiveModuleConfig(module, current),
        current === null
          ? null
          : {
            contentHash: current.contentHash,
            actor: current.actor,
            reason: current.reason,
            createdAt: current.createdAt,
          },
      ));
    }
    return { modules };
  },
});

/**
 * The version history for one module, newest first.
 *
 * AC#2 asks for changes to be versioned AND auditable, and the two answer different questions.
 * `listOperatorAudit` records that someone changed the configuration and why; this records what
 * the configuration WAS. Reconstructing the second from the first is impossible — the audit row
 * carries a reason, not nine numbers.
 */
export const listModuleModelConfigVersions = query({
  args: { ...credentialArgs, worldId: v.string(), module: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ module: ConfigurableModule; versions: ModuleModelConfigView[] }> => {
    await requireOperator(ctx, 'model_config.inspect', args);
    const module = assertModule(args.module);
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 100);
    const rows = await ctx.db
      .query('moduleModelConfigs')
      .withIndex('by_world_module_version', (q) => q.eq('worldId', args.worldId).eq('module', module))
      .order('desc')
      .take(limit);
    return {
      module,
      // Built from the stored row DIRECTLY, not through `resolveEffectiveModuleConfig`. The
      // resolver's job is to answer "what will actually run", so it falls back to the defaults
      // for a row that no longer validates — correct there, and wrong here: a history entry must
      // report what the configuration WAS, including a version whose prompt id has since been
      // retired. Routing history through the resolver would silently rewrite the record.
      versions: rows.map(toStored).map((row) => describeModuleModelConfig(
        { ...row, module, source: 'configured' },
        { contentHash: row.contentHash, actor: row.actor, reason: row.reason, createdAt: row.createdAt },
      )),
    };
  },
});

/**
 * The documented defaults, so a console can show what "unconfigured" means without a world.
 *
 * Behind the same gate as everything else — these are not secret, but the console must not be
 * enumerable anonymously, which is the rule `describeOperatorSession` already established.
 */
export const describeModuleModelDefaults = query({
  args: { ...credentialArgs, worldId: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx, 'model_config.inspect', args);
    return {
      modules: CONFIGURABLE_MODULES.map((module) => ({ module, defaults: MODULE_MODEL_DEFAULTS[module] })),
    };
  },
});
