/**
 * The live scene author: deployment environment → gated adapter → route chain (ART-159).
 *
 * ## Why this file exists at all
 *
 * ART-72 built the OpenAI-compatible adapter, ART-156 put the pre-generation safety gate at the
 * port, and ART-158 built the free-route fallback chain. None of the three was reachable from the
 * world: `createWorldDayStageHandlers` defaulted to `FakeWholeSceneProvider`, and
 * `parseFreeRouteChain` had no caller anywhere in the codebase. Three tested components and no
 * assembly — so every scene the live world authored was deterministic fake text, and the fallback
 * chain's behaviour was a property of its unit test rather than of the system.
 *
 * This module is the assembly, and it is deliberately the ONLY one. Everything above it takes a
 * vendor-neutral {@link LanguageModelProvider}; everything below it is adapter detail that
 * `architecture/module-boundaries.json` confines to this directory.
 *
 * ## The order of the two wrappers is load-bearing
 *
 *   FreeRouteChainProvider( createLanguageModelProvider( config ) )
 *
 * The safety gate is INSIDE the chain, not outside it. A prompt that the pre-generation policy
 * refuses must be refused once, for the request, on every route — putting the chain inside the
 * gate would screen the first hop and let the retries through unscreened, which is precisely the
 * hole `safeProvider.ts` was written to close. It also means a policy refusal is a request-level
 * failure that {@link isRouteLevelFailure} does not retry, so a prohibited prompt costs one
 * refusal rather than the whole chain's allowance.
 *
 * ## What is NOT decided here
 *
 * There is no paid/free filtering and no route metadata. FREE_ONLY is a fact about the configured
 * ENDPOINT — every route it exposes reports `owned_by: freellmapi` and none carries a price — so
 * "never escalate to paid" is enforced by there being one configured endpoint and no code path
 * that substitutes another, not by a flag on a route that could be set wrong. See
 * `freeRouteChain.ts` for the measurements behind that.
 */

import type { LanguageModelProvider } from '../provider';
import { loadOpenAICompatibleConfig, type ProviderEnvironment } from './config';
import { createLanguageModelProvider } from './safeProvider';
import { FreeRouteChainProvider, parseFreeRouteChain } from './freeRouteChain';

/**
 * The ordered free routes a scene may be authored on.
 *
 * Absent or empty yields `[LLM_MODEL]` — one route, no hops, exactly today's behaviour. An
 * unconfigured deployment must not silently gain retries it never asked for, because ART-158
 * measured that every hop spends key allowance whether or not it serves.
 */
export const LIVE_ROUTE_CHAIN_ENV = 'LLM_FREE_ROUTE_CHAIN';

/**
 * The model id the FR-M003 reservation is keyed on, before any call is made.
 *
 * This is the first route, which is `LLM_MODEL` unless a chain overrides it — and it may perfectly
 * well be an alias such as `auto` that names no model at all. That is expected rather than a
 * defect to correct here: ART-148 settles usage against what the gateway said actually served the
 * call, so the alias is only ever the key a reservation is TAKEN under, never the model usage is
 * booked against.
 */
export function resolveLiveSceneAuthoringModel(env: ProviderEnvironment): string {
  const config = loadOpenAICompatibleConfig(env);
  return parseFreeRouteChain(env[LIVE_ROUTE_CHAIN_ENV], config.chatModel)[0];
}

/**
 * THE live scene author.
 *
 * Returns the vendor-neutral port rather than either wrapper's concrete class, so a caller cannot
 * reach past the safety gate by touching a method the port does not declare — the same narrowing
 * `createLanguageModelProvider` does, preserved through the second wrapper.
 */
export function createLiveSceneAuthor(env: ProviderEnvironment): LanguageModelProvider {
  const config = loadOpenAICompatibleConfig(env);
  const chain = parseFreeRouteChain(env[LIVE_ROUTE_CHAIN_ENV], config.chatModel);
  return new FreeRouteChainProvider(createLanguageModelProvider(config), chain);
}
