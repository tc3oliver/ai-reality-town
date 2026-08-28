/**
 * The prompt version registry (FR-K005 "Prompt Version", ART-52).
 *
 * ## Version IDs are configuration; prompt BODIES are source
 *
 * `moduleModelConfigs.promptVersion` stores an ID from `PROMPT_VERSION_IDS`. This file maps each
 * of those ids to the function that BUILDS the prompt, and the bodies stay where they already
 * are — in reviewed, diffed, code-reviewed repository source.
 *
 * That split is FR-K005 AC#3 ("complete prompts never enter public APIs or unsafe logs") taken
 * seriously rather than promised. A prompt body in a database row is a body that can be read by
 * anything holding a database handle, copied into an operator response, and — because
 * `sanitizeForPublic` drops every key matching `/prompt/i` — silently deleted from any payload
 * that tried to carry it, so the leak would be invisible until it was not. Keeping bodies in
 * source means the only prompt-shaped value the configuration surface can return is a name.
 *
 * It also makes the operator control meaningful. Configuring a prompt version selects between
 * prompts a human reviewed; a free-text prompt field would let the console rewrite what the
 * model is told, which is a content-authoring power the operations console deliberately does not
 * have (the same reason `convex/viewer` may only propose from a fixed catalog).
 *
 * ## Adding a version
 *
 * 1. Add the id to `SCENE_SIMULATION_PROMPT_VERSION_IDS` in `convex/shared/moduleModelConfig.ts`.
 * 2. Add its builder here. The `satisfies Record<SceneSimulationPromptVersionId, …>` clause below
 *    makes step 2 mandatory: it is EXHAUSTIVE over that id list, so an id with no builder is a
 *    compile error and the two cannot drift. (A `Partial<Record<…>>` would not do this — it makes
 *    every key optional and would accept the drift silently, which is why the id list is
 *    per-module rather than one flat list covering every module's prompts.)
 * 3. Never edit an existing version's body in place — a stored `promptVersion: 'x.v1'` is a
 *    claim about which text ran, and rewriting v1 makes every historical trace a lie.
 *
 * ## Why resolution happens HERE and not inside `simulateWholeScene`
 *
 * The registry has to name the builders, and the builders live in `sceneSimulation.ts`, so this
 * module imports that one. `sceneSimulation.ts` therefore may not import this one back — a
 * module cycle between the prompt bodies and the prompt index would be a genuine load-order
 * hazard, not a style objection. So `simulateWholeScene` takes a resolved BUILDER and the
 * version ID is resolved one layer out, at the `worldDayLive` seam that already reads the
 * configuration.
 */

import { SimulationProviderError } from './provider';
import { wholeSceneSystemPrompt } from './sceneSimulation';
import type { SceneSimulationPromptVersionId } from '../shared/moduleModelConfig';
import type { GroupedScene } from './sceneGrouping';

/** A prompt builder for the whole-scene simulation module. */
export type WholeScenePromptBuilder = (scene: GroupedScene) => string;

/**
 * Registered whole-scene prompts, by version id.
 *
 * `scene_simulation.v1` is the prompt that has been running since ART-141 — registering the
 * status quo as v1 rather than authoring a new one is what makes this change behaviour-preserving
 * on an unconfigured world.
 */
export const PROMPT_VERSIONS = {
  'scene_simulation.v1': wholeSceneSystemPrompt,
  // EXHAUSTIVE over the whole-scene id list, not `Partial`: an id declared in
  // `SCENE_SIMULATION_PROMPT_VERSION_IDS` with no builder here fails to compile.
} as const satisfies Record<SceneSimulationPromptVersionId, WholeScenePromptBuilder>;

export type RegisteredPromptVersionId = keyof typeof PROMPT_VERSIONS;

export function isRegisteredPromptVersion(value: unknown): value is RegisteredPromptVersionId {
  return typeof value === 'string' && Object.hasOwn(PROMPT_VERSIONS, value);
}

/**
 * Resolve a version id to its builder, or throw.
 *
 * ## This throw is a guard, NOT the retired-prompt policy
 *
 * Two things already stand in front of it, and between them they mean a configured world does
 * not reach it:
 *
 * 1. `assertModuleModelSettings` refuses an unknown id at WRITE time.
 * 2. `resolveEffectiveModuleConfig` re-validates the stored row at READ time and returns
 *    `MODULE_MODEL_DEFAULTS` when it no longer passes — so a version RETIRED after a
 *    configuration referenced it resolves to the default prompt, and the operator console
 *    reports `source: 'default'` for that world. Runtime and console agree, and a retired
 *    prompt cannot halt a world's slots.
 *
 * That resolve-to-defaults behaviour is deliberate and is documented in
 * `docs/model-configuration.md` §3. What remains for this function is the case those two do not
 * cover: a caller that bypasses the resolver and passes an id or a `null` directly. Throwing
 * beats returning some arbitrary builder there, because such a caller has no configuration
 * record for a substitution to stay consistent with.
 *
 * Permanent rather than transient: retrying cannot register a prompt.
 */
export function selectWholeScenePrompt(versionId: string | null): WholeScenePromptBuilder {
  if (versionId !== null && isRegisteredPromptVersion(versionId)) return PROMPT_VERSIONS[versionId];
  throw new SimulationProviderError(
    'permanent',
    'PROMPT_VERSION_UNKNOWN',
    `no prompt is registered under version ${String(versionId)}`,
  );
}
