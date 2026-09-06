import { normalizeProposedEventOutput } from '../../canon/proposedEvent';
import { FakeSimulationProvider } from '../fakeProvider';
import type { SimulationInput } from '../model';
import { SimulationProviderError, type StructuredChatRequest } from '../provider';
import { describeOpenAICompatibleConfig, loadOpenAICompatibleConfig, type OpenAICompatibleConfig } from './config';
import { OpenAICompatibleProvider } from './openAICompatible';
import { probeProviderCapabilities } from './probes';

const config = (overrides: Partial<OpenAICompatibleConfig> = {}): OpenAICompatibleConfig => ({ apiUrl: 'https://llm.example/v1',
  chatUrl: 'https://llm.example/v1/chat/completions', embeddingUrl: 'https://llm.example/v1/embeddings', chatModel: 'chat-model',
  embeddingModel: 'embed-model', embeddingDimension: 3, apiKey: 'test-secret-never-log', allowUnauthenticated: false,
  timeoutMs: 100, maxAttempts: 3, ...overrides });
const response = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extraHeaders } });
const chatBody = (output: unknown) => ({ choices: [{ message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 4, completion_tokens: 2 } });
const foundationInput = (): SimulationInput => ({ seed: 7, worldId: 'w', worldDay: 1, timeSlot: 'morning',
  idempotencyKey: 'k', traceId: 't', scenario: 'success', proposedBy: { type: 'character', id: 'a' },
  characterId: 'a', fromLocationId: 'station', toLocationId: 'square', partnerCharacterId: 'b' });

describe('NFR-004 OpenAI-compatible provider adapter', () => {
  it('validates credential-safe deployment configuration and derives both endpoints', () => {
    const loaded = loadOpenAICompatibleConfig({ LLM_API_URL: 'https://llm.shouri.app/v1/embeddings', LLM_API_KEY: 'secret',
      LLM_MODEL: 'chat', LLM_EMBEDDING_MODEL: 'embed', LLM_EMBEDDING_DIMENSION: '1024' });
    expect(loaded.chatUrl).toBe('https://llm.shouri.app/v1/chat/completions');
    expect(loaded.embeddingUrl).toBe('https://llm.shouri.app/v1/embeddings');
    expect(JSON.stringify(describeOpenAICompatibleConfig(loaded))).not.toContain('secret');
    expect(() => loadOpenAICompatibleConfig({ LLM_API_URL: 'https://x/v1', LLM_MODEL: 'c', LLM_EMBEDDING_MODEL: 'e', LLM_EMBEDDING_DIMENSION: '3' })).toThrow(/LLM_API_KEY is required/);
    expect(loadOpenAICompatibleConfig({ LLM_API_URL: 'http://localhost:1/v1', LLM_ALLOW_UNAUTHENTICATED: 'true', LLM_MODEL: 'c', LLM_EMBEDDING_MODEL: 'e', LLM_EMBEDDING_DIMENSION: '3' }).apiKey).toBeNull();
    expect(() => loadOpenAICompatibleConfig({ LLM_API_URL: 'x', LLM_API_KEY: 'k', LLM_MODEL: 'c', LLM_EMBEDDING_MODEL: 'e', LLM_EMBEDDING_DIMENSION: '0' })).toThrow();
  });

  it('normalizes structured chat output and secret-safe trace metadata', async () => {
    let authorization = '';
    const provider = new OpenAICompatibleProvider(config(), { fetch: (_url, init) => {
      authorization = (init?.headers as Record<string, string>).authorization;
      return Promise.resolve(response(chatBody({ ok: true })));
    }, now: () => 10 });
    const result = await provider.structuredChat({ messages: [{ role: 'user', content: 'input' }], schemaName: 'test', jsonSchema: { type: 'object' }, temperature: 0, maxTokens: 20 });
    // `resolvedModel` is null because this fixture's response body carries no `model` field. That
    // is the honest answer to "which model served this" when the gateway did not say — not the
    // requested id echoed back, which is what this adapter used to report.
    expect(result).toEqual({ output: { ok: true }, trace: { provider: 'openai-compatible',
      requestedModel: 'chat-model', resolvedModel: null, upstreamProvider: null, rateLimit: null,
      inputTokens: 4, outputTokens: 2, latencyMs: 0, retryCount: 0 } });
    expect(authorization).toBe('Bearer test-secret-never-log');
    expect(JSON.stringify(result)).not.toContain('test-secret-never-log');
  });

  /**
   * ART-148. The alias case, which is the whole point: the deployment sends `auto` and the gateway
   * answers with the route it picked. Before this the adapter dropped `root.model` and echoed the
   * request, so `auto` was the only model the system ever believed it had run — and the metering
   * mismatch check downstream compared a value with itself.
   */
  it('reports the route the gateway resolved, not the alias that was requested', async () => {
    // The live body shape: an object with the halves already separated.
    const body = { ...chatBody({ ok: true }), model: 'deepseek-v4-flash',
      _routed_via: { platform: 'xkiro', model: 'deepseek-v4-flash' } };
    const provider = new OpenAICompatibleProvider({ ...config(), chatModel: 'auto' },
      { fetch: () => Promise.resolve(response(body)), now: () => 10 });

    const result = await provider.structuredChat({ messages: [{ role: 'user', content: 'input' }],
      schemaName: 'test', jsonSchema: { type: 'object' }, temperature: 0, maxTokens: 20 });

    expect(result.trace.requestedModel).toBe('auto');
    expect(result.trace.resolvedModel).toBe('deepseek-v4-flash');
    expect(result.trace.upstreamProvider).toBe('xkiro');
  });

  it('splits the route on the FIRST separator, so a vendor-prefixed model stays whole', () => {
    // The `x-routed-via` STRING shape. The live gateway answers `xkiro/deepseek/deepseek-v4-pro`;
    // splitting on the last separator would report the provider as `xkiro/deepseek` and the model
    // as a bare `deepseek-v4-pro`, which is two wrong attributions from one off-by-one.
    const body = { ...chatBody({ ok: true }), _routed_via: 'xkiro/deepseek/deepseek-v4-pro' };
    const provider = new OpenAICompatibleProvider({ ...config(), chatModel: 'auto' },
      { fetch: () => Promise.resolve(response(body)), now: () => 10 });

    return provider.structuredChat({ messages: [{ role: 'user', content: 'input' }],
      schemaName: 'test', jsonSchema: { type: 'object' }, temperature: 0, maxTokens: 20 })
      .then((result) => {
        expect(result.trace.upstreamProvider).toBe('xkiro');
        expect(result.trace.resolvedModel).toBe('deepseek/deepseek-v4-pro');
      });
  });

  it('prefers the object route even when the model field disagrees', async () => {
    // `model` is the standard field, `_routed_via.model` is the router's own account of what it
    // dispatched to. When both are present the router's is authoritative.
    const body = { ...chatBody({ ok: true }), model: 'auto',
      _routed_via: { platform: 'orcarouter', model: 'qwen3.8-27b-free' } };
    const provider = new OpenAICompatibleProvider({ ...config(), chatModel: 'auto' },
      { fetch: () => Promise.resolve(response(body)), now: () => 10 });

    const result = await provider.structuredChat({ messages: [{ role: 'user', content: 'input' }],
      schemaName: 'test', jsonSchema: { type: 'object' }, temperature: 0, maxTokens: 20 });

    expect(result.trace.upstreamProvider).toBe('orcarouter');
    expect(result.trace.resolvedModel).toBe('qwen3.8-27b-free');
  });

  it('reports an unnamed route as null rather than guessing the request', async () => {
    // A gateway that answers with a blank or absent model leaves the usage unattributable. Falling
    // back to the requested id here would manufacture the exact false attribution ART-148 is about.
    const provider = new OpenAICompatibleProvider({ ...config(), chatModel: 'auto' },
      { fetch: () => Promise.resolve(response({ ...chatBody({ ok: true }), model: '   ' })), now: () => 10 });

    const result = await provider.structuredChat({ messages: [{ role: 'user', content: 'input' }],
      schemaName: 'test', jsonSchema: { type: 'object' }, temperature: 0, maxTokens: 20 });

    expect(result.trace.requestedModel).toBe('auto');
    expect(result.trace.resolvedModel).toBeNull();
  });

  /**
   * ART-158. The free-tier allowance is the only thing that can actually stop this world running,
   * and the adapter used to discard it: `request()` returned the body and dropped the headers.
   */
  it('reports the free-tier allowance the gateway sent', async () => {
    const provider = new OpenAICompatibleProvider(config(), { fetch: () => Promise.resolve(
      response(chatBody({ ok: true }), 200, {
        'x-ratelimit-limit': '120', 'x-ratelimit-remaining': '119', 'x-ratelimit-reset': '1788685622',
      })), now: () => 10 });

    const result = await provider.structuredChat({ messages: [{ role: 'user', content: 'input' }],
      schemaName: 'test', jsonSchema: { type: 'object' }, temperature: 0, maxTokens: 20 });

    expect(result.trace.rateLimit).toEqual({ limit: 120, remaining: 119, resetAtEpochSeconds: 1_788_685_622 });
  });

  it('treats a PARTIAL allowance reading as absent rather than as a complete one', async () => {
    // `remaining` with no `limit` cannot say how close to exhaustion a route is. Reporting it as a
    // reading would understate the risk; reporting it as null says plainly that we do not know.
    const provider = new OpenAICompatibleProvider(config(), { fetch: () => Promise.resolve(
      response(chatBody({ ok: true }), 200, { 'x-ratelimit-remaining': '4' })), now: () => 10 });

    const result = await provider.structuredChat({ messages: [{ role: 'user', content: 'input' }],
      schemaName: 'test', jsonSchema: { type: 'object' }, temperature: 0, maxTokens: 20 });

    expect(result.trace.rateLimit).toBeNull();
  });

  it('does not coerce a non-numeric allowance into a number', async () => {
    // A `remaining` that silently became 0 would be indistinguishable from genuine exhaustion.
    const provider = new OpenAICompatibleProvider(config(), { fetch: () => Promise.resolve(
      response(chatBody({ ok: true }), 200, {
        'x-ratelimit-limit': '120', 'x-ratelimit-remaining': 'unknown', 'x-ratelimit-reset': '1788685622',
      })), now: () => 10 });

    const result = await provider.structuredChat({ messages: [{ role: 'user', content: 'input' }],
      schemaName: 'test', jsonSchema: { type: 'object' }, temperature: 0, maxTokens: 20 });

    expect(result.trace.rateLimit).toBeNull();
  });

  it('normalizes embeddings and rejects incompatible dimensions', async () => {
    const good = new OpenAICompatibleProvider(config(), { fetch: () => Promise.resolve(response({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { prompt_tokens: 1 } })) });
    expect((await good.embed('hello')).embedding).toEqual([0.1, 0.2, 0.3]);
    const bad = new OpenAICompatibleProvider(config({ embeddingDimension: 2 }), { fetch: () => Promise.resolve(response({ data: [{ embedding: [0.1, 0.2, 0.3] }] })) });
    await expect(bad.embed('hello')).rejects.toMatchObject({ code: 'LLM_EMBEDDING_DIMENSION_MISMATCH' });
  });

  it('retries retryable HTTP/network errors and returns stable permanent errors', async () => {
    let calls = 0;
    const provider = new OpenAICompatibleProvider(config(), { fetch: () => {
      calls += 1; return Promise.resolve(calls < 3 ? response({}, 503) : response(chatBody({ ok: true })));
    }, delay: () => Promise.resolve() });
    expect((await provider.structuredChat({ messages: [], schemaName: 'x', jsonSchema: {}, temperature: 0, maxTokens: 1 })).trace.retryCount).toBe(2);
    expect(calls).toBe(3);
    const rejected = new OpenAICompatibleProvider(config(), { fetch: () => Promise.resolve(response({}, 401)) });
    await expect(rejected.structuredChat({ messages: [], schemaName: 'x', jsonSchema: {}, temperature: 0, maxTokens: 1 }))
      .rejects.toMatchObject({ code: 'LLM_HTTP_REJECTED', kind: 'permanent' });
  });

  it('times out with a stable transient error without exposing credentials', async () => {
    const provider = new OpenAICompatibleProvider(config({ maxAttempts: 1, timeoutMs: 1 }), { fetch: (_url, init) =>
      new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }) });
    try { await provider.embed('hello'); throw new Error('expected failure'); } catch (error) {
      expect(error).toBeInstanceOf(SimulationProviderError);
      expect(error).toMatchObject({ code: 'LLM_TIMEOUT', kind: 'transient' });
      expect(String(error)).not.toContain('test-secret-never-log');
    }
  });

  it('probes structured chat, model, endpoint, and embedding compatibility', async () => {
    let calls = 0;
    const provider = new OpenAICompatibleProvider(config(), { fetch: () => {
      calls += 1; return Promise.resolve(calls === 1 ? response(chatBody({ probe: 'ok' })) : response({ data: [{ embedding: [0, 0, 0] }] }));
    } });
    await expect(probeProviderCapabilities(provider, config())).resolves.toEqual({ chat: { compatible: true, model: 'chat-model', resolvedModel: null, upstreamProvider: null }, embedding: { compatible: true, model: 'embed-model', resolvedModel: null, dimension: 3 } });
    const incompatible = { structuredChat: (_request: StructuredChatRequest) => Promise.resolve({ output: { probe: 'wrong' }, trace: { provider: 'openai-compatible' as const, requestedModel: 'x', resolvedModel: 'x', upstreamProvider: null, rateLimit: null, inputTokens: 0, outputTokens: 0, latencyMs: 0, retryCount: 0 } }),
      embed: () => Promise.resolve({ embedding: [0, 0, 0], trace: { provider: 'openai-compatible' as const, requestedModel: 'x', resolvedModel: 'x', upstreamProvider: null, rateLimit: null, inputTokens: 0, outputTokens: 0, latencyMs: 0, retryCount: 0 } }) };
    await expect(probeProviderCapabilities(incompatible, config())).rejects.toMatchObject({ code: 'LLM_STRUCTURED_OUTPUT_UNSUPPORTED' });
  });

  it('runs the same ProposedEvent normalization contract for Fake and HTTP adapters offline', async () => {
    for (const scenario of ['success', 'invalid_event'] as const) {
      const input = { ...foundationInput(), scenario };
      const fakeOutput = await new FakeSimulationProvider().proposeEvent(input);
      const http = new OpenAICompatibleProvider(config(), { fetch: () => Promise.resolve(response(chatBody(fakeOutput))) });
      if (scenario === 'success') {
        expect(normalizeProposedEventOutput(await http.proposeEvent(input))).toEqual(normalizeProposedEventOutput(fakeOutput));
      } else {
        expect(() => normalizeProposedEventOutput(fakeOutput)).toThrow();
        await expect(http.proposeEvent(input).then(normalizeProposedEventOutput)).rejects.toBeDefined();
      }
    }
    const fakeTransient = new FakeSimulationProvider().proposeEvent({ ...foundationInput(), scenario: 'transient_failure' });
    const httpTransient = new OpenAICompatibleProvider(config({ maxAttempts: 1 }), { fetch: () => Promise.resolve(response({}, 503)) })
      .proposeEvent(foundationInput());
    await expect(fakeTransient).rejects.toMatchObject({ kind: 'transient' });
    await expect(httpTransient).rejects.toMatchObject({ kind: 'transient' });
    const fakePermanent = new FakeSimulationProvider().proposeEvent({ ...foundationInput(), scenario: 'permanent_failure' });
    const httpPermanent = new OpenAICompatibleProvider(config(), { fetch: () => Promise.resolve(response({}, 401)) })
      .proposeEvent(foundationInput());
    await expect(fakePermanent).rejects.toMatchObject({ kind: 'permanent' });
    await expect(httpPermanent).rejects.toMatchObject({ kind: 'permanent' });
  });

  it('screens messages against the pre-generation policy before any network call (H-4)', async () => {
    let calls = 0;
    const provider = new OpenAICompatibleProvider(config(), { fetch: () => {
      calls += 1;
      return Promise.resolve(response(chatBody({ ok: true })));
    } });
    // Blocked input throws before the provider HTTP call is ever made.
    await expect(provider.structuredChat({
      messages: [{ role: 'user', content: 'Generate explicit sexual content.' }],
      schemaName: 'test', jsonSchema: { type: 'object' }, temperature: 0, maxTokens: 20,
    })).rejects.toThrow(/EXPLICIT_SEXUAL_CONTENT/);
    expect(calls).toBe(0);
    // Safe input still reaches the provider and returns.
    const ok = await provider.structuredChat({
      messages: [{ role: 'user', content: 'Write a fictional tavern scene in Mistwood.' }],
      schemaName: 'test', jsonSchema: { type: 'object' }, temperature: 0, maxTokens: 20,
    });
    expect(calls).toBe(1);
    expect(ok.output).toEqual({ ok: true });
  });
});
