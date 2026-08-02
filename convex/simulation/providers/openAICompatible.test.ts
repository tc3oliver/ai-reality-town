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
const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
    expect(result).toEqual({ output: { ok: true }, trace: { provider: 'openai-compatible', model: 'chat-model', inputTokens: 4, outputTokens: 2, latencyMs: 0, retryCount: 0 } });
    expect(authorization).toBe('Bearer test-secret-never-log');
    expect(JSON.stringify(result)).not.toContain('test-secret-never-log');
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
    await expect(probeProviderCapabilities(provider, config())).resolves.toEqual({ chat: { compatible: true, model: 'chat-model' }, embedding: { compatible: true, model: 'embed-model', dimension: 3 } });
    const incompatible = { structuredChat: (_request: StructuredChatRequest) => Promise.resolve({ output: { probe: 'wrong' }, trace: { provider: 'openai-compatible' as const, model: 'x', inputTokens: 0, outputTokens: 0, latencyMs: 0, retryCount: 0 } }),
      embed: () => Promise.resolve({ embedding: [0, 0, 0], trace: { provider: 'openai-compatible' as const, model: 'x', inputTokens: 0, outputTokens: 0, latencyMs: 0, retryCount: 0 } }) };
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
});
