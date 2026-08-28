import type { SimulationInput } from '../model';
import { SimulationProviderError, type EmbeddingResult, type LanguageModelProvider, type ProviderTraceMetadata, type SimulationProvider, type StructuredChatRequest, type StructuredChatResult } from '../provider';
import { PRE_GENERATION_PROVIDER_CONSTRAINT, assertPreGenerationSafe, chatMessagesToSafetyInput } from '../../safety/preGeneration';
import type { OpenAICompatibleConfig } from './config';

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type AdapterDependencies = { fetch: Fetch; now: () => number; delay: (milliseconds: number) => Promise<void> };
const defaults: AdapterDependencies = { fetch: globalThis.fetch.bind(globalThis), now: Date.now,
  delay: (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); }) };

const record = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SimulationProviderError('permanent', code, 'provider returned an incompatible object');
  return value as Record<string, unknown>;
};
const usage = (value: unknown): { inputTokens: number; outputTokens: number } => {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { inputTokens: typeof data.prompt_tokens === 'number' ? data.prompt_tokens : 0,
    outputTokens: typeof data.completion_tokens === 'number' ? data.completion_tokens : 0 };
};

export class OpenAICompatibleProvider implements LanguageModelProvider, SimulationProvider {
  readonly name = 'llm' as const;
  private readonly dependencies: AdapterDependencies;
  constructor(private readonly config: OpenAICompatibleConfig, dependencies: Partial<AdapterDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  /**
   * `overrides` carries the per-request FR-K005 settings (ART-52). Absent values fall back to
   * the instance configuration, which is what every pre-ART-52 caller supplies, so the transport
   * behaves exactly as it did unless a module configuration says otherwise.
   */
  private async request(
    url: string,
    body: Record<string, unknown>,
    overrides: { timeoutMs?: number; maxAttempts?: number } = {},
  ): Promise<{ body: unknown; retryCount: number; latencyMs: number }> {
    const started = this.dependencies.now();
    const maxAttempts = overrides.maxAttempts ?? this.config.maxAttempts;
    const timeoutMs = overrides.timeoutMs ?? this.config.timeoutMs;
    let last: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
        const response = await this.dependencies.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
        if (!response.ok) {
          const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          if (!retryable) throw new SimulationProviderError('permanent', 'LLM_HTTP_REJECTED', `provider rejected the request with HTTP ${response.status}`);
          throw new SimulationProviderError('transient', 'LLM_HTTP_RETRYABLE', `provider temporarily failed with HTTP ${response.status}`);
        }
        let parsed: unknown;
        try { parsed = await response.json() as unknown; } catch { throw new SimulationProviderError('permanent', 'LLM_RESPONSE_INVALID', 'provider response was not JSON'); }
        return { body: parsed, retryCount: attempt - 1, latencyMs: Math.max(0, this.dependencies.now() - started) };
      } catch (error) {
        last = error;
        const transient = error instanceof SimulationProviderError ? error.kind === 'transient' : true;
        if (!transient || attempt === maxAttempts) break;
        await this.dependencies.delay(Math.min(100 * (2 ** (attempt - 1)), 1_000));
      } finally { clearTimeout(timeout); }
    }
    if (last instanceof SimulationProviderError) throw last;
    if (last instanceof DOMException && last.name === 'AbortError') throw new SimulationProviderError('transient', 'LLM_TIMEOUT', `provider exceeded ${timeoutMs}ms timeout`);
    throw new SimulationProviderError('transient', 'LLM_NETWORK_ERROR', 'provider network request failed');
  }

  async structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    // ART-62 / H-4: screen every provider-bound message against the pre-generation policy
    // and prepend the non-user-editable constraint. Blocked input throws before any network
    // request, so the provider is provably never invoked for prohibited content.
    assertPreGenerationSafe(chatMessagesToSafetyInput(request.messages));
    // FR-K005: the module's configured model, or the instance's when it configured none.
    const chatModel = request.model ?? this.config.chatModel;
    const response = await this.request(this.config.chatUrl, { model: chatModel,
      messages: [{ role: 'system', content: PRE_GENERATION_PROVIDER_CONSTRAINT }, ...request.messages],
      temperature: request.temperature, max_tokens: request.maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema } } },
      { timeoutMs: request.timeoutMs, maxAttempts: request.maxAttempts });
    const root = record(response.body, 'LLM_CHAT_INCOMPATIBLE');
    if (!Array.isArray(root.choices) || root.choices.length === 0) throw new SimulationProviderError('permanent', 'LLM_CHAT_INCOMPATIBLE', 'chat response has no choices');
    const choice = record(root.choices[0], 'LLM_CHAT_INCOMPATIBLE');
    const message = record(choice.message, 'LLM_CHAT_INCOMPATIBLE');
    if (typeof message.content !== 'string') throw new SimulationProviderError('permanent', 'LLM_STRUCTURED_OUTPUT_INVALID', 'chat response content is not structured JSON text');
    let output: unknown;
    try { output = JSON.parse(message.content) as unknown; } catch { throw new SimulationProviderError('permanent', 'LLM_STRUCTURED_OUTPUT_INVALID', 'chat response content is not valid JSON'); }
    const tokens = usage(root.usage);
    return { output, trace: { provider: 'openai-compatible', model: chatModel, ...tokens,
      latencyMs: response.latencyMs, retryCount: response.retryCount } };
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const response = await this.request(this.config.embeddingUrl, { model: this.config.embeddingModel, input: text });
    const root = record(response.body, 'LLM_EMBEDDING_INCOMPATIBLE');
    if (!Array.isArray(root.data) || root.data.length === 0) throw new SimulationProviderError('permanent', 'LLM_EMBEDDING_INCOMPATIBLE', 'embedding response has no data');
    const first = record(root.data[0], 'LLM_EMBEDDING_INCOMPATIBLE');
    if (!Array.isArray(first.embedding)) throw new SimulationProviderError('permanent', 'LLM_EMBEDDING_INCOMPATIBLE', 'embedding is not a finite numeric vector');
    const embedding = first.embedding.map((value): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new SimulationProviderError('permanent', 'LLM_EMBEDDING_INCOMPATIBLE', 'embedding is not a finite numeric vector');
      return value;
    });
    if (embedding.length !== this.config.embeddingDimension) throw new SimulationProviderError('permanent', 'LLM_EMBEDDING_DIMENSION_MISMATCH', `expected ${this.config.embeddingDimension} dimensions, received ${embedding.length}`);
    const tokens = usage(root.usage);
    return { embedding, trace: { provider: 'openai-compatible', model: this.config.embeddingModel,
      ...tokens, latencyMs: response.latencyMs, retryCount: response.retryCount } };
  }

  async proposeEvent(input: SimulationInput): Promise<unknown> {
    const result = await this.structuredChat({ messages: [{ role: 'system', content: 'Return only a ProposedEvent JSON object. You may propose but never commit Canon changes. Write every narrative text field in Traditional Chinese (zh-TW). Field names and JSON structure stay in English.' },
      { role: 'user', content: JSON.stringify(input) }], schemaName: 'proposed_event', jsonSchema: { type: 'object' }, temperature: 0.2, maxTokens: 2_000 });
    return result.output;
  }
}

export function traceWithoutSecrets(trace: ProviderTraceMetadata): ProviderTraceMetadata { return { ...trace }; }
