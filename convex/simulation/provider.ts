/**
 * Simulation provider interface and shared error type.
 *
 * A provider's ONLY job is to turn a {@link SimulationInput} into a {@link ProposedEvent}.
 * Providers must never write to canon tables directly — every accepted change goes
 * through the commit pipeline.
 */

import type { SimulationInput, SimulationProviderName } from './model';

/** A provider error, tagged transient vs permanent so callers can decide to retry. */
export class SimulationProviderError extends Error {
  readonly kind: 'transient' | 'permanent';
  readonly code: string;

  constructor(kind: 'transient' | 'permanent', code: string, message: string) {
    super(message);
    this.name = 'SimulationProviderError';
    this.kind = kind;
    this.code = code;
  }
}

export const isTransientProviderError = (e: unknown): boolean =>
  e instanceof SimulationProviderError && e.kind === 'transient';

/** Anything that can propose events. The fake provider (Phase 0) and future LLM provider
 *  both implement this. */
export interface SimulationProvider {
  readonly name: SimulationProviderName;
  /** Provider wire output is untrusted until the shared proposal normalizer accepts it. */
  proposeEvent(input: SimulationInput): Promise<unknown>;
}

/**
 * One structured-output request.
 *
 * `temperature` and `maxTokens` have always been per-request. FR-K005 / ART-52 added the three
 * OPTIONAL overrides below, because the settings they name were previously fixed on the provider
 * INSTANCE (`OpenAICompatibleConfig`, built once from the deployment environment) while FR-K005
 * requires them per module.
 *
 * Overriding per request rather than constructing one provider per module is deliberate: a
 * provider instance also owns the credential, the endpoints and the embedding contract, none of
 * which are per-module, and four instances would mean four places for those to diverge. An
 * absent override means "use the instance's configured value", so an adapter that ignores them
 * behaves exactly as it did.
 */
export type StructuredChatRequest = {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  temperature: number;
  maxTokens: number;
  /** FR-K005 "Model". Absent inherits the provider instance's configured chat model. */
  model?: string;
  /** FR-K005 "Timeout", per HTTP attempt. Absent inherits the instance's `timeoutMs`. */
  timeoutMs?: number;
  /** FR-K005 "Retry" layer 1 — HTTP attempts. Absent inherits the instance's `maxAttempts`. */
  maxAttempts?: number;
};

export type ProviderTraceMetadata = {
  provider: 'fake' | 'openai-compatible';
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retryCount: number;
};

export type StructuredChatResult = { output: unknown; trace: ProviderTraceMetadata };
export type EmbeddingResult = { embedding: number[]; trace: ProviderTraceMetadata };

/** Vendor-neutral capability port used outside adapter roots. */
export interface LanguageModelProvider {
  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult>;
  embed(text: string): Promise<EmbeddingResult>;
}
