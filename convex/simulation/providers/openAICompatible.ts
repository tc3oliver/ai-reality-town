import type { SimulationInput } from '../model';
import { SimulationProviderError, type EmbeddingResult, type LanguageModelProvider, type ProviderRateLimit, type ProviderTraceMetadata, type SimulationProvider, type StructuredChatRequest, type StructuredChatResult } from '../provider';
import { PRE_GENERATION_PROVIDER_CONSTRAINT, assertPreGenerationSafe, chatMessagesToSafetyInput } from '../../safety/preGeneration';
import type { OpenAICompatibleConfig } from './config';

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type AdapterDependencies = { fetch: Fetch; now: () => number; delay: (milliseconds: number) => Promise<void> };
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

/**
 * Every string anywhere in a request body, so the safety gate screens what is actually sent
 * rather than what the caller thought it was sending (ART-156).
 *
 * Walks the whole structure instead of naming fields. The audit's egress inventory listed three
 * that were reaching the provider unscreened — `json_schema.schema`'s embedded `description`s,
 * `tools[].function.description`, and `user` — and a fixed list of field names would have closed
 * exactly those three and nothing added afterwards. Keys are collected as well as values: a JSON
 * Schema carries meaning in its property names.
 */
function freeTextOf(value: unknown, depth = 0, out: string[] = []): string[] {
  // A request body is configuration-shaped, not user-shaped; this bound exists so a cyclic or
  // pathological structure cannot make the gate itself the failure.
  if (depth > 12) return out;
  if (typeof value === 'string') {
    // The one carve-out, and it is not a loophole: {@link PRE_GENERATION_PROVIDER_CONSTRAINT} is
    // the policy TEXT this module prepends to every request, and it necessarily NAMES the things
    // it prohibits ("Do not generate ... explicit sexual content"). Screening it would make the
    // gate reject every request the moment it started screening the assembled body — the gate
    // refusing its own instruction. Matched by exact identity against the frozen constant, so no
    // caller-supplied string can wear this exemption.
    if (value !== PRE_GENERATION_PROVIDER_CONSTRAINT) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) freeTextOf(entry, depth + 1, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      out.push(key);
      freeTextOf(entry, depth + 1, out);
    }
  }
  return out;
}

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
  ): Promise<{ body: unknown; rateLimit: ProviderRateLimit | null; retryCount: number; latencyMs: number }> {
    // ART-156 / audit H-4: the LAST gate, on the only line in this class that reaches the
    // network. The per-method calls above screen the caller's own input with the right
    // `inputKind`; this screens the request body as ACTUALLY ASSEMBLED, which is a different
    // question and catches the fields nobody was looking at — `json_schema.schema`'s
    // descriptions, tool descriptions, `user`, and anything a future method adds. A new method
    // on this adapter cannot ship unscreened text without deleting this line.
    //
    // NOT a substitute for a port-level gate: a second adapter class would have its own
    // transport and inherit nothing from here. See this task's notes.
    assertPreGenerationSafe({ worldText: '', promptText: '', contextText: freeTextOf(body) });
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
          // `retryable` and `rateLimited` are deliberately different questions. 408, 429 and every
          // 5xx are all worth retrying, so they share a code — but only 429 says the ALLOWANCE ran
          // out. Reporting a 500 as rate-limited sent an operator hunting for a quota problem
          // while the gateway was down.
          throw new SimulationProviderError('transient', 'LLM_HTTP_RETRYABLE',
            `provider temporarily failed with HTTP ${response.status}`,
            { rateLimited: response.status === 429 });
        }
        let parsed: unknown;
        try { parsed = await response.json() as unknown; } catch { throw new SimulationProviderError('permanent', 'LLM_RESPONSE_INVALID', 'provider response was not JSON'); }
        return { body: parsed, rateLimit: OpenAICompatibleProvider.rateLimitOf(response.headers),
          retryCount: attempt - 1, latencyMs: Math.max(0, this.dependencies.now() - started) };
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

  /**
   * The free-tier allowance the gateway reported, or null when it reported none (ART-158).
   *
   * All three headers are required together: a `remaining` with no `limit` cannot say how close to
   * exhaustion a route is, and reporting a partial reading as a complete one would understate the
   * risk. Non-numeric or negative values are treated as absent rather than coerced — a `remaining`
   * that silently became 0 would look exactly like genuine exhaustion.
   */
  private static rateLimitOf(headers: Headers): ProviderRateLimit | null {
    const value = (name: string): number | null => {
      const raw = headers.get(name);
      if (raw === null) return null;
      const parsed = Number(raw.trim());
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    };
    const limit = value('x-ratelimit-limit');
    const remaining = value('x-ratelimit-remaining');
    const resetAtEpochSeconds = value('x-ratelimit-reset');
    if (limit === null || remaining === null || resetAtEpochSeconds === null) return null;
    return { limit, remaining, resetAtEpochSeconds };
  }

  /**
   * Read the route the gateway actually used out of its own response.
   *
   * The OpenAI response schema carries `model`, and a routing gateway populates it with the model
   * it selected — that is the ONLY place the resolution of an alias like `auto` is observable.
   * This adapter previously echoed the requested id into the trace and dropped `root.model`
   * entirely, which made the whole downstream chain a tautology: the "provider-reported" model was
   * the request, so the metering-mismatch check compared a value with itself and could never fire.
   *
   * Absent or non-string fields yield `null` rather than a guess: "the gateway did not say" is a
   * real state, and echoing the request back in its place is the defect this replaced.
   *
   * `_routed_via` is the FreeLLMAPI extension naming the route. BOTH shapes below were observed on
   * the live deployment in the same response, and both are handled because each is the only one
   * available at its own site:
   *
   *  - body: `{ platform: 'xkiro', model: 'deepseek/deepseek-v4-pro' }` — an OBJECT. This is the
   *    authoritative form: the two halves are already separated, so nothing has to be parsed out.
   *  - header `x-routed-via`: `xkiro/deepseek/deepseek-v4-pro` — a string whose model half itself
   *    contains slashes, so it splits on the FIRST separator only. Splitting on the last would
   *    report the provider as `xkiro/deepseek` and the model as a bare `deepseek-v4-pro`: two
   *    wrong attributions from one off-by-one.
   *
   * `model` is the standard OpenAI field and remains the fallback for the model half, so a plain
   * OpenAI-compatible endpoint that does no routing still reports what served the call.
   */
  private static route(root: Record<string, unknown>): { resolvedModel: string | null; upstreamProvider: string | null } {
    const text = (value: unknown): string | null =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
    const routed = root._routed_via;
    if (routed && typeof routed === 'object' && !Array.isArray(routed)) {
      const entry = routed as Record<string, unknown>;
      return { resolvedModel: text(entry.model) ?? text(root.model), upstreamProvider: text(entry.platform) };
    }
    const flat = text(routed);
    const separator = flat === null ? -1 : flat.indexOf('/');
    return separator > 0 && flat !== null
      ? { resolvedModel: flat.slice(separator + 1), upstreamProvider: flat.slice(0, separator) }
      : { resolvedModel: text(root.model), upstreamProvider: null };
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
    return { output, trace: { provider: 'openai-compatible', requestedModel: chatModel,
      ...OpenAICompatibleProvider.route(root), ...tokens, rateLimit: response.rateLimit,
      latencyMs: response.latencyMs, retryCount: response.retryCount } };
  }

  /**
   * ART-156 / audit H-4: embeddings are screened too.
   *
   * This path was ungated. It is not a lesser exposure than chat — it is the one that ships
   * character memories and private knowledge verbatim to the provider, whereas `structuredChat`
   * at least sends an assembled prompt. The text is screened as `context` rather than `prompt`
   * because it is not an instruction: labelling it correctly is what makes a rejection's
   * `inputKind` mean something to whoever reads it.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    assertPreGenerationSafe({ worldText: '', promptText: '', contextText: [text] });
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
    return { embedding, trace: { provider: 'openai-compatible', requestedModel: this.config.embeddingModel,
      ...OpenAICompatibleProvider.route(root),
      ...tokens, rateLimit: response.rateLimit,
      latencyMs: response.latencyMs, retryCount: response.retryCount } };
  }

  async proposeEvent(input: SimulationInput): Promise<unknown> {
    const result = await this.structuredChat({ messages: [{ role: 'system', content: 'Return only a ProposedEvent JSON object. You may propose but never commit Canon changes. Write every narrative text field in Traditional Chinese (zh-TW). Field names and JSON structure stay in English.' },
      { role: 'user', content: JSON.stringify(input) }], schemaName: 'proposed_event', jsonSchema: { type: 'object' }, temperature: 0.2, maxTokens: 2_000 });
    return result.output;
  }
}

export function traceWithoutSecrets(trace: ProviderTraceMetadata): ProviderTraceMetadata { return { ...trace }; }
