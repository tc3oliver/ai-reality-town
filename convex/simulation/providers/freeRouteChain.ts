/**
 * Free-only route fallback (ART-158, AC#3–#6).
 *
 * ## What this is for, and what it deliberately is NOT for
 *
 * Measured against the live gateway with three consecutive calls, deliberately varying the model
 * id:
 *
 * | # | asked                | status | routed                    | x-ratelimit-remaining |
 * |---|----------------------|--------|---------------------------|-----------------------|
 * | 1 | `auto`               | 200    | xkiro / deepseek-v4-pro   | 119                   |
 * | 2 | `gemini-2.5-flash`   | 429    | null                      | 118                   |
 * | 3 | `auto`               | 200    | xkiro / deepseek-v4-pro   | 117                   |
 *
 * Two conclusions point in opposite directions and both shape this file:
 *
 *  - The allowance is per API KEY, not per route: `remaining` drains from one pool of 120 no
 *    matter which id is asked for, and the REFUSED call at #2 still cost one. So this chain can
 *    never be a way around an exhausted account, and every extra hop spends real allowance. That
 *    is why it is bounded and why exhausting it fails rather than looping.
 *  - A 429 is nevertheless per ROUTE: #2 was refused with 118 still available, and #3 succeeded
 *    immediately afterwards. So retrying a DIFFERENT route genuinely recovers a call that a single
 *    route would have lost, which is the entire justification for this existing.
 *
 * Writing it as "fall back to get around the quota" would have been a feature that cannot work.
 *
 * ## Why there is no paid tier here, and nothing to guard against one
 *
 * FREE_ONLY is structural rather than a filter. Every one of the gateway's 254 routes reports
 * `owned_by: freellmapi`, and the union of every field across every route carries no price, cost
 * or tier at all. There is no paid route reachable through this endpoint, so "never escalate to
 * paid" is enforced by there being exactly one configured endpoint and no code path that
 * substitutes another — which `freeRouteChain.test.ts` asserts by construction rather than by
 * checking a flag that could be set wrong.
 */

import {
  SimulationProviderError,
  type EmbeddingResult,
  type LanguageModelProvider,
  type StructuredChatRequest,
  type StructuredChatResult,
} from '../provider';

/** One attempt this chain made, in order, whether it succeeded or not. */
export type RouteAttempt = {
  model: string;
  outcome: 'served' | 'rate_limited' | 'failed';
  /** The stable provider error code, for an attempt that did not serve. */
  code: string | null;
};

export type FreeRouteChainResult = StructuredChatResult & {
  /** Every route tried, in order. Length > 1 means a fallback happened. */
  attempts: readonly RouteAttempt[];
};

/**
 * The error raised when every free route has been tried and none served the call.
 *
 * `permanent`, not `transient`: the caller has already spent one key allowance unit per hop, and
 * an outer retry would spend the whole chain again for the same reason. This is the honest end of
 * the road — AC#5's "when every free route is unavailable the call FAILS".
 */
export const FREE_ROUTES_EXHAUSTED = 'LLM_FREE_ROUTES_EXHAUSTED';

/** Provider error codes that mean "this route, right now" rather than "this request". */
const ROUTE_LEVEL_CODES = new Set(['LLM_HTTP_RETRYABLE', 'LLM_TIMEOUT', 'LLM_NETWORK_ERROR']);

/**
 * Whether a failure is worth trying another route for.
 *
 * A route-level failure says nothing about the request, so another route may well serve it. A
 * request-level failure — malformed schema, prohibited content, a rejected credential — will fail
 * identically everywhere, and retrying it would burn the whole chain's allowance to arrive at the
 * same answer. Unknown errors are treated as request-level: spending allowance on a guess is the
 * more expensive mistake, and the error still reaches the caller unchanged.
 */
export function isRouteLevelFailure(error: unknown): boolean {
  return error instanceof SimulationProviderError && ROUTE_LEVEL_CODES.has(error.code);
}

/**
 * Parse the configured chain. Absent or empty yields `[fallback]`, which is exactly today's
 * behaviour: one route, no hops. An unconfigured deployment must not silently gain retries it
 * never asked for, because each one costs allowance.
 */
export function parseFreeRouteChain(raw: string | undefined, fallback: string): string[] {
  const entries = (raw ?? '').split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (entries.length === 0) return [fallback];
  // De-duplicated in order: a repeated id would spend allowance to retry a route that just failed
  // for a reason that has not changed.
  return [...new Set(entries)];
}

/**
 * Try each free route in turn until one serves the call.
 *
 * Returns the winning result together with EVERY attempt, so the caller can record what the
 * fallback cost. A silent fallback would hide the fact that a hop consumed key allowance, which is
 * the number that actually runs out.
 */
export async function callWithFreeRouteFallback(
  provider: LanguageModelProvider,
  request: StructuredChatRequest,
  chain: readonly string[],
): Promise<FreeRouteChainResult> {
  if (chain.length === 0) {
    throw new SimulationProviderError('permanent', FREE_ROUTES_EXHAUSTED, 'no free route is configured');
  }
  const attempts: RouteAttempt[] = [];
  for (const model of chain) {
    try {
      const result = await provider.structuredChat({ ...request, model });
      attempts.push({ model, outcome: 'served', code: null });
      return { ...result, attempts };
    } catch (error) {
      const code = error instanceof SimulationProviderError ? error.code : null;
      const routeLevel = isRouteLevelFailure(error);
      attempts.push({
        model,
        // Read off the error's own `rateLimited`, not off its CODE. `LLM_HTTP_RETRYABLE` covers
        // 408, 429 and every 5xx, so keying on it reported a broken gateway as an exhausted
        // allowance — the two need different operator responses.
        outcome: error instanceof SimulationProviderError && error.rateLimited ? 'rate_limited' : 'failed',
        code,
      });
      // A request-level failure is rethrown as itself rather than buried under an exhaustion
      // error: the caller needs to see that the request was rejected, not that routes ran out.
      if (!routeLevel) throw error;
    }
  }
  throw new SimulationProviderError('permanent', FREE_ROUTES_EXHAUSTED,
    `every free route was unavailable after ${attempts.length} attempt(s)`,
    // PERMANENT, because retrying would spend the whole chain again for the same reason — and
    // still rate-limited when a rate limit is what stopped it. Those are separate facts, and the
    // second is the one an operator needs: it says the KEY ran out rather than the gateway broke.
    { rateLimited: attempts.some((attempt) => attempt.outcome === 'rate_limited') },
    );
}

/**
 * A {@link LanguageModelProvider} that fails over across free routes.
 *
 * Wraps rather than replaces the adapter, so the safety gate, the transport and the trace parsing
 * are the SAME code on every hop. A second adapter class would inherit none of it — which is the
 * mistake `openAICompatible.ts`'s own header warns about.
 */
export class FreeRouteChainProvider implements LanguageModelProvider {
  /** The attempts made by the most recent call, for the caller to record. */
  lastAttempts: readonly RouteAttempt[] = [];

  constructor(
    private readonly inner: LanguageModelProvider,
    private readonly chain: readonly string[],
  ) {}

  /**
   * The routes to try for ONE request, first to last.
   *
   * An explicit `request.model` is a decision somebody already made — ART-59's over-budget
   * downgrade to the fast class, or ART-52's per-module override — so it is tried FIRST. Without
   * this the chain overwrote `model` on every hop and the downgrade never reached the gateway:
   * the accountant would have granted a reservation against the fast model, recorded that it did,
   * and the call would have run on the configured route anyway. A budget control that is decided
   * and then discarded is worse than one that does not exist, because the ledger says it worked.
   *
   * The configured routes remain behind it as fallbacks rather than being replaced: a route being
   * rate-limited says nothing about the decision that chose it, and dropping them would leave a
   * downgraded call with no fallback at all. Nothing is escalated by doing so — every route on
   * this endpoint is free, so a later hop is a different queue, not a more expensive one.
   */
  private chainFor(request: StructuredChatRequest): string[] {
    return request.model === undefined
      ? [...this.chain]
      : [...new Set([request.model, ...this.chain])];
  }

  async structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    const { attempts, ...result } = await callWithFreeRouteFallback(
      this.inner, request, this.chainFor(request));
    this.lastAttempts = attempts;
    return result;
  }

  /** Embeddings are not routed: there is one embedding model and no alias for it to resolve. */
  embed(text: string): Promise<EmbeddingResult> {
    return this.inner.embed(text);
  }
}
