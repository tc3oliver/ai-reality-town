/**
 * The FR-K005 read seam (ART-52): how a configured value actually reaches a provider call.
 *
 * This is the part that makes AC#1 ("operators can configure … per module") a behaviour rather
 * than a form. Without it the console would store nine numbers nobody reads, and the simulation
 * would go on using the literals it always used.
 *
 * The chain is: `moduleModelConfigs` row → {@link resolveModuleConfig} →
 * {@link wholeSceneOptionsFor} → `simulateWholeScene`'s `options` → the `StructuredChatRequest`
 * the provider receives. `moduleConfigSelection.test.ts` asserts on the last link — what
 * `structuredChat` was actually called with — because every weaker assertion (a row exists, a
 * resolver returns it) is satisfied by a configuration the call path ignores.
 *
 * An unconfigured world resolves to `MODULE_MODEL_DEFAULTS`, which ARE the pre-ART-52 hardcoded
 * values, so nothing changes for a world nobody has configured.
 */

import type { GenericDatabaseReader } from 'convex/server';
import type { DataModel } from '../_generated/dataModel';
import {
  resolveEffectiveModuleConfig,
  type ConfigurableModule,
  type EffectiveModuleConfig,
} from '../shared/moduleModelConfig';
import { selectWholeScenePrompt } from './promptVersions';
import type { WholeSceneSimulationOptions } from './sceneSimulation';

type ReadDb = GenericDatabaseReader<DataModel>;

/**
 * The current configuration for one world+module, or the documented defaults.
 *
 * An indexed point lookup on `(worldId, module, isCurrent)`, not a history scan: this runs once
 * per world-day slot on the live path, and the version history can only grow.
 */
export async function resolveModuleConfig(
  db: ReadDb,
  worldId: string,
  module: ConfigurableModule,
): Promise<EffectiveModuleConfig> {
  const row = await db
    .query('moduleModelConfigs')
    .withIndex('by_world_module_current', (q) =>
      q.eq('worldId', worldId).eq('module', module).eq('isCurrent', true))
    .unique();
  if (!row) return resolveEffectiveModuleConfig(module, null);
  return resolveEffectiveModuleConfig(module, {
    version: row.version,
    model: row.model,
    // Narrowed by `resolveEffectiveModuleConfig`, which re-validates the row and returns the
    // defaults if it no longer passes — a stored id retired since it was written must not be
    // able to stop a world simulating.
    promptVersion: row.promptVersion as EffectiveModuleConfig['promptVersion'],
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    timeoutMs: row.timeoutMs,
    transportMaxAttempts: row.transportMaxAttempts,
    semanticMaxAttempts: row.semanticMaxAttempts,
    fallbackModel: row.fallbackModel,
    dailyTokenBudget: row.dailyTokenBudget,
  });
}

/**
 * Project a resolved configuration onto the whole-scene call options.
 *
 * ## A `null` setting must produce NO key, not a key holding a default
 *
 * `model`, `timeoutMs` and `transportMaxAttempts` are the three settings backed by a deployment
 * environment variable (`LLM_MODEL`, `LLM_TIMEOUT_MS`, `LLM_MAX_ATTEMPTS`), and each is omitted
 * entirely when the module configured `null`. That is load-bearing, not tidiness: every one of
 * these becomes a per-REQUEST override, and `OpenAICompatibleProvider` resolves an override with
 * `overrides.x ?? this.config.x` — so a present key always beats the provider instance, which is
 * precisely where the environment variable lives. Emitting a default here would therefore make
 * `LLM_TIMEOUT_MS` and `LLM_MAX_ATTEMPTS` dead for every world, including worlds nobody had
 * configured, and a deployment running a 90s timeout would silently start aborting at 30s.
 *
 * `temperature`, `maxTokens` and the semantic retry budget are always sent, because they are not
 * env-backed: their pre-ART-52 values were code literals, and the defaults reproduce them.
 *
 * ## What is NOT here
 *
 * `fallbackModel` and `dailyTokenBudget`. They are configured, versioned, audited and readable,
 * and no code acts on them — ART-59 (FR-M003) owns budget enforcement and ART-91 owns the
 * degradation ordering. Passing them into a call that cannot honour them would be worse than
 * omitting them, because it would look like they were being applied.
 */
export function wholeSceneOptionsFor(config: EffectiveModuleConfig): WholeSceneSimulationOptions {
  return {
    maxAttempts: config.semanticMaxAttempts,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    buildSystemPrompt: selectWholeScenePrompt(config.promptVersion),
    ...(config.model === null ? {} : { model: config.model }),
    ...(config.timeoutMs === null ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.transportMaxAttempts === null
      ? {}
      : { transportMaxAttempts: config.transportMaxAttempts }),
  };
}
