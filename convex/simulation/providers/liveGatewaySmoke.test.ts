/**
 * The LIVE gateway smoke test (ART-159) — the only test here that touches the network.
 *
 * ## Why it is gated, and what that costs
 *
 * Every other test in this repository runs offline against a stubbed `fetch`, which is what makes
 * the offline gate meaningful. This one calls the real gateway with the real credential, so it is
 * gated behind `ART159_LIVE_SMOKE=1` and never runs in `npm run check`. Each run spends real
 * per-key allowance — ART-158 measured the pool at 120 and found that even a REFUSED call costs
 * one — so it makes the smallest useful number of calls and says so.
 *
 *   ART159_LIVE_SMOKE=1 npm run test:live-gateway
 *
 * The credential comes from the environment, which is where the deployment keeps it
 * (`npx convex env list`). It is never read from a repository file and never printed: the
 * assertions below check that no trace, error or result contains it, which is a property worth
 * testing rather than assuming, because a gateway that echoes its `Authorization` header back in
 * an error body would put it into `sceneSimulationRuns` where operators can read it.
 *
 * ## What live evidence is FOR, and what it cannot be
 *
 * The fixture suite proves the wiring: that a 429 reaches the next route, that a 400 does not,
 * that the budget is reserved and settled. It cannot prove that this gateway's actual responses
 * fit the shapes those fixtures assert. That is the gap this closes, and only that — a green run
 * here says the contract holds against the deployment as configured today, not that the fallback
 * logic is correct.
 *
 * A skipped run is NOT evidence. `describeLive` is `describe.skip` without the flag, so an
 * un-gated invocation reports zero live tests rather than a pass.
 */

import { loadOpenAICompatibleConfig } from './config';
import { createLiveSceneAuthor, resolveLiveSceneAuthoringModel, LIVE_ROUTE_CHAIN_ENV } from './liveSceneAuthor';

const describeLive = process.env.ART159_LIVE_SMOKE === '1' ? describe : describe.skip;

/** A trivial structured request. Small on purpose: this spends a real allowance unit. */
const probeRequest = {
  messages: [
    { role: 'system' as const, content: 'Answer with JSON only.' },
    { role: 'user' as const, content: 'Return {"ok":true}.' },
  ],
  schemaName: 'art159_smoke',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  },
  temperature: 0,
  maxTokens: 64,
};

describeLive('ART-159 live gateway smoke', () => {
  it('the deployment is configured well enough to author a scene', () => {
    const config = loadOpenAICompatibleConfig(process.env);
    expect(config.chatUrl).toMatch(/^https?:\/\//u);
    expect(config.chatModel.trim().length).toBeGreaterThan(0);
    // The route the FR-M003 reservation will key on, resolved the same way the live action
    // resolves it.
    expect(resolveLiveSceneAuthoringModel(process.env).trim().length).toBeGreaterThan(0);
  });

  it('serves a structured call through the real chain, and reports what actually ran', async () => {
    const provider = createLiveSceneAuthor(process.env);
    const result = await provider.structuredChat(probeRequest);
    const { trace } = result;

    expect(result.output).toBeTruthy();
    expect(trace.provider).toBe('openai-compatible');
    expect(trace.requestedModel.trim().length).toBeGreaterThan(0);
    // Tokens must be real: a gateway that reports zero usage would make every budget number in
    // this system a fiction, and it would do so silently.
    expect(trace.inputTokens + trace.outputTokens).toBeGreaterThan(0);

    // Printed so a run leaves readable evidence of WHAT served the call. Deliberately field by
    // field rather than dumping the trace, so a future field cannot be logged without a decision.
    // eslint-disable-next-line no-console
    console.log('[ART-159 live] requested=%s resolved=%s upstream=%s allowance=%s tokens=%d',
      trace.requestedModel, trace.resolvedModel, trace.upstreamProvider,
      trace.rateLimit === null ? 'none' : `${trace.rateLimit.remaining}/${trace.rateLimit.limit}`,
      trace.inputTokens + trace.outputTokens);
  }, 60_000);

  it('never puts the credential into anything that gets stored or shown', async () => {
    const apiKey = process.env.LLM_API_KEY?.trim();
    const provider = createLiveSceneAuthor(process.env);
    const result = await provider.structuredChat(probeRequest);

    // Only meaningful when a credential is actually configured; an unauthenticated endpoint has
    // nothing to leak, and asserting against an empty string would match everything.
    if (apiKey) {
      expect(JSON.stringify(result)).not.toContain(apiKey);
      expect(JSON.stringify(result.trace)).not.toContain(apiKey);
    } else {
      expect(process.env.LLM_ALLOW_UNAUTHENTICATED).toBe('true');
    }
  }, 60_000);

  /**
   * A misconfigured route is LOUD, and does not quietly cost the whole chain.
   *
   * This test was originally written to exercise the fallback live, using a nonexistent route id
   * as a stand-in for a 429. It failed, and the code was right rather than the test: this gateway
   * answers an unknown model with
   *
   *     HTTP 404  {"error":{"code":"model_not_found","type":"invalid_request_error", ...}}
   *
   * — it classifies the condition as a REQUEST error itself. `isRouteLevelFailure` agrees, so the
   * chain does not hop, and that is the correct behaviour twice over: a route that is not in the
   * catalog will never work, so walking the chain around it would spend a second allowance unit on
   * every call forever while hiding an operator's typo behind a working world.
   *
   * So this asserts the honest property instead: exactly ONE call is made, and it fails with a
   * stable code. **The 429 fallback itself is not exercised here** — a smoke test cannot summon a
   * real rate limit — it is proven in `liveWorldDayWiring.test.ts`, which drives a real 429 status
   * through the same adapter and chain against a stubbed transport.
   */
  it('refuses a route that is not in the catalog, without walking the chain', async () => {
    const configured = resolveLiveSceneAuthoringModel(process.env);
    const provider = createLiveSceneAuthor({
      ...process.env,
      [LIVE_ROUTE_CHAIN_ENV]: `art159-no-such-route,${configured}`,
    });

    await expect(provider.structuredChat(probeRequest)).rejects.toMatchObject({
      code: 'LLM_HTTP_REJECTED',
      kind: 'permanent',
      // NOT rate limiting, and the distinction is the point: an operator seeing this must go and
      // fix their configuration, not wait for an allowance to refill.
      rateLimited: false,
    });
  }, 90_000);
});
