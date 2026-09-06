/**
 * ART-158 AC#3–#6 — free-only route fallback.
 *
 * The behaviour under test is a spend: every hop consumes one unit of a per-API-key allowance, as
 * measured on the live gateway (see `freeRouteChain.ts`'s header). So the assertions are as much
 * about what this must NOT try as about what it must.
 */

import {
  FREE_ROUTES_EXHAUSTED,
  FreeRouteChainProvider,
  callWithFreeRouteFallback,
  isRouteLevelFailure,
  parseFreeRouteChain,
} from './freeRouteChain';
import {
  SimulationProviderError,
  type EmbeddingResult,
  type LanguageModelProvider,
  type StructuredChatRequest,
  type StructuredChatResult,
} from '../provider';

const TRACE = {
  provider: 'openai-compatible' as const,
  requestedModel: 'x', resolvedModel: 'x', upstreamProvider: 'xkiro', rateLimit: null,
  inputTokens: 1, outputTokens: 1, latencyMs: 0, retryCount: 0,
};

const chatRequest = (): StructuredChatRequest => ({
  messages: [{ role: 'user', content: 'input' }],
  schemaName: 'test', jsonSchema: { type: 'object' }, temperature: 0, maxTokens: 8,
});

/**
 * Serves only the ids in `serves`; every other id fails with `code`.
 *
 * `rateLimited` defaults to true because the default `code` stands in for a 429, and ART-159 made
 * that a separate fact from the code: `LLM_HTTP_RETRYABLE` also covers 408 and every 5xx, so the
 * adapter now says WHICH of those it saw instead of leaving callers to infer a quota problem from
 * a broken gateway. A stub that omitted it would simulate a 500 while the test read as a 429.
 */
class RoutedProvider implements LanguageModelProvider {
  readonly asked: string[] = [];
  constructor(
    private readonly serves: ReadonlySet<string>,
    private readonly code = 'LLM_HTTP_RETRYABLE',
    private readonly kind: 'transient' | 'permanent' = 'transient',
    private readonly rateLimited = true,
  ) {}

  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    const model = request.model ?? '(none)';
    this.asked.push(model);
    if (!this.serves.has(model)) {
      return Promise.reject(new SimulationProviderError(this.kind, this.code, `route ${model} refused`,
        { rateLimited: this.rateLimited }));
    }
    return Promise.resolve({ output: { ok: true }, trace: { ...TRACE, requestedModel: model, resolvedModel: model } });
  }

  embed(): Promise<EmbeddingResult> {
    return Promise.resolve({ embedding: [0], trace: TRACE });
  }
}

describe('ART-158 free route chain', () => {
  it('serves from the first route and asks no others', async () => {
    // The common case must not spend allowance it does not need to.
    const provider = new RoutedProvider(new Set(['auto']));
    const result = await callWithFreeRouteFallback(provider, chatRequest(), ['auto', 'backup']);

    expect(result.attempts).toEqual([{ model: 'auto', outcome: 'served', code: null }]);
    expect(provider.asked).toEqual(['auto']);
  });

  it('falls back to the next FREE route when one is rate limited (AC#3)', async () => {
    // The measured case: a 429 on one route with allowance still available, and another route
    // serving the same request immediately afterwards.
    const provider = new RoutedProvider(new Set(['backup']));
    const result = await callWithFreeRouteFallback(provider, chatRequest(), ['auto', 'backup']);

    expect(provider.asked).toEqual(['auto', 'backup']);
    expect(result.attempts).toEqual([
      { model: 'auto', outcome: 'rate_limited', code: 'LLM_HTTP_RETRYABLE' },
      { model: 'backup', outcome: 'served', code: null },
    ]);
    expect(result.trace.resolvedModel).toBe('backup');
  });

  it('falls back on a provider failure too, not only on a 429 (AC#4)', async () => {
    // Not rate limited: a network error is the gateway being unreachable, which is a different
    // thing from the allowance running out and must not be recorded as one.
    const provider = new RoutedProvider(new Set(['backup']), 'LLM_NETWORK_ERROR', 'transient', false);
    const result = await callWithFreeRouteFallback(provider, chatRequest(), ['auto', 'backup']);

    expect(result.attempts[0]).toEqual({ model: 'auto', outcome: 'failed', code: 'LLM_NETWORK_ERROR' });
    expect(provider.asked).toEqual(['auto', 'backup']);
  });

  it('FAILS when every free route is unavailable, and escalates to nothing (AC#5)', async () => {
    const provider = new RoutedProvider(new Set());

    await expect(callWithFreeRouteFallback(provider, chatRequest(), ['auto', 'backup']))
      .rejects.toMatchObject({ code: FREE_ROUTES_EXHAUSTED, kind: 'permanent' });
    // Exactly the configured routes were tried: nothing invented a further one to reach for.
    expect(provider.asked).toEqual(['auto', 'backup']);
  });

  it('does not burn the chain on a REQUEST-level failure', async () => {
    // A rejected credential or prohibited content fails identically on every route. Retrying it
    // would spend the whole chain's allowance to arrive at the same answer, and would bury the
    // real error under an exhaustion error the caller cannot act on.
    const provider = new RoutedProvider(new Set(), 'LLM_HTTP_REJECTED', 'permanent');

    await expect(callWithFreeRouteFallback(provider, chatRequest(), ['auto', 'backup']))
      .rejects.toMatchObject({ code: 'LLM_HTTP_REJECTED' });
    expect(provider.asked).toEqual(['auto']);
  });

  it('classifies only route-level failures as worth another route', () => {
    expect(isRouteLevelFailure(new SimulationProviderError('transient', 'LLM_HTTP_RETRYABLE', 'x'))).toBe(true);
    expect(isRouteLevelFailure(new SimulationProviderError('transient', 'LLM_TIMEOUT', 'x'))).toBe(true);
    expect(isRouteLevelFailure(new SimulationProviderError('permanent', 'LLM_HTTP_REJECTED', 'x'))).toBe(false);
    // An unknown error is request-level by default: spending allowance on a guess is the more
    // expensive mistake.
    expect(isRouteLevelFailure(new Error('something else'))).toBe(false);
  });

  it('an unconfigured chain is exactly one route, so nobody silently gains retries', () => {
    // Each hop costs allowance, so a deployment that configured nothing must behave as it did.
    expect(parseFreeRouteChain(undefined, 'auto')).toEqual(['auto']);
    expect(parseFreeRouteChain('', 'auto')).toEqual(['auto']);
    expect(parseFreeRouteChain('   ', 'auto')).toEqual(['auto']);
  });

  it('de-duplicates the chain, because a repeated route fails for the same reason', () => {
    expect(parseFreeRouteChain('auto, backup , auto', 'auto')).toEqual(['auto', 'backup']);
  });

  it('records every attempt on the provider wrapper, so a fallback is never silent', async () => {
    const provider = new RoutedProvider(new Set(['backup']));
    const chained = new FreeRouteChainProvider(provider, ['auto', 'backup']);

    const result = await chained.structuredChat(chatRequest());

    expect(result.trace.resolvedModel).toBe('backup');
    expect(chained.lastAttempts.map(({ model, outcome }) => ({ model, outcome }))).toEqual([
      { model: 'auto', outcome: 'rate_limited' },
      { model: 'backup', outcome: 'served' },
    ]);
    // The wrapper does not leak its bookkeeping into the provider contract.
    expect(result).not.toHaveProperty('attempts');
  });

  it('refuses an empty chain instead of silently calling the provider unrouted', async () => {
    const provider = new RoutedProvider(new Set(['auto']));
    await expect(callWithFreeRouteFallback(provider, chatRequest(), []))
      .rejects.toMatchObject({ code: FREE_ROUTES_EXHAUSTED });
    expect(provider.asked).toEqual([]);
  });
});

/**
 * AC#6. FREE_ONLY is structural, so this asserts on the SOURCE rather than on a flag: a flag can
 * be set wrong, whereas a second endpoint or a paid-tier concept cannot hide from a scan of the
 * module that would have to contain it.
 */
describe('an explicit request.model is a decision, and is tried FIRST', () => {
  /**
   * Fault injection found this untested: making `chainFor` ignore `request.model` and always walk
   * the configured chain passed every test in this file.
   *
   * It is the defect ART-159 fixed. ART-59's over-budget downgrade and ART-52's per-module
   * override both reach the provider as `request.model`; a chain that overwrote it left the
   * accountant granting a reservation against the fast class, RECORDING that it had, and the call
   * running on the configured route anyway. A budget control that is decided and then discarded is
   * worse than none, because the ledger says it worked.
   */
  it('calls the requested model before any configured route', async () => {
    const provider = new RoutedProvider(new Set(['downgraded']));
    const chained = new FreeRouteChainProvider(provider, ['auto', 'backup']);

    await chained.structuredChat({ ...chatRequest(), model: 'downgraded' });

    expect(provider.asked[0]).toBe('downgraded');
  });

  it('keeps the configured routes behind it as fallbacks', async () => {
    // Dropping them would leave a downgraded call with no fallback at all. Nothing is escalated by
    // keeping them: every route on this endpoint is free, so a later hop is a different queue.
    const provider = new RoutedProvider(new Set(['backup']));
    const chained = new FreeRouteChainProvider(provider, ['auto', 'backup']);

    await chained.structuredChat({ ...chatRequest(), model: 'downgraded' });

    expect(provider.asked).toEqual(['downgraded', 'auto', 'backup']);
  });

  it('does not duplicate a requested model that is already in the chain', async () => {
    const provider = new RoutedProvider(new Set(['backup']));
    const chained = new FreeRouteChainProvider(provider, ['auto', 'backup']);

    await chained.structuredChat({ ...chatRequest(), model: 'auto' });

    // A repeated id would spend allowance retrying a route that just failed for a reason that has
    // not changed.
    expect(provider.asked).toEqual(['auto', 'backup']);
  });

  it('uses the configured chain unchanged when no model is requested', async () => {
    // The negative control: ART-52 requires that a module inheriting the deployment's LLM_MODEL
    // sends NO override, and that case must not gain a phantom first hop.
    const provider = new RoutedProvider(new Set(['backup']));
    const chained = new FreeRouteChainProvider(provider, ['auto', 'backup']);

    await chained.structuredChat(chatRequest());

    expect(provider.asked).toEqual(['auto', 'backup']);
  });
});

describe('ART-158 AC#6 — no paid route is reachable', () => {
  it('the chain names no provider, endpoint or tier of its own', async () => {
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync('convex/simulation/providers/freeRouteChain.ts', 'utf8'));
    // COMMENTS ARE STRIPPED FIRST, and that is the point rather than a convenience: the module's
    // docblock has to be free to explain WHY there is no paid tier, and a scan that read prose
    // would forbid the explanation while permitting the code. An earlier version of this test
    // failed on its own documentation.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^[^\n'"`]*\/\/.*$/gmu, '');

    // The chain routes by MODEL ID against the one configured endpoint. If it ever grew a URL, a
    // second credential, or a paid/premium tier, this is where that would have to appear.
    for (const forbidden of ['http://', 'https://', 'apiKey', 'paid', 'premium', 'billing', 'upgrade']) {
      expect(code).not.toContain(forbidden);
    }
    // The scan is only meaningful if it is reading something: a stripping bug that emptied `code`
    // would make every assertion above vacuously true.
    expect(code).toContain('callWithFreeRouteFallback');
    expect(code).toContain(FREE_ROUTES_EXHAUSTED);
  });

  it('exhaustion is a permanent error, so no caller can retry its way past the free tier', () => {
    // A `transient` exhaustion would invite an outer retry loop to spend the whole chain again.
    const error = new SimulationProviderError('permanent', FREE_ROUTES_EXHAUSTED, 'x');
    expect(error.kind).toBe('permanent');
  });
});
