import { SimulationProviderError } from '../provider';

export type OpenAICompatibleConfig = {
  apiUrl: string;
  chatUrl: string;
  embeddingUrl: string;
  chatModel: string;
  embeddingModel: string;
  embeddingDimension: number;
  apiKey: string | null;
  allowUnauthenticated: boolean;
  timeoutMs: number;
  maxAttempts: number;
};

export type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

const required = (env: ProviderEnvironment, key: string): string => {
  const value = env[key]?.trim();
  if (!value) throw new SimulationProviderError('permanent', 'LLM_CONFIG_MISSING', `${key} is required in the Convex deployment environment`);
  return value;
};
const positiveInteger = (raw: string | undefined, key: string, fallback?: number): number => {
  if (raw === undefined && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new SimulationProviderError('permanent', 'LLM_CONFIG_INVALID', `${key} must be a positive integer`);
  return value;
};
const endpoint = (base: URL, override: string | undefined, suffix: 'chat/completions' | 'embeddings'): string => {
  if (override?.trim()) {
    try { return new URL(override).toString(); } catch { throw new SimulationProviderError('permanent', 'LLM_CONFIG_INVALID', `LLM_${suffix === 'embeddings' ? 'EMBEDDING' : 'CHAT'}_API_URL must be an absolute URL`); }
  }
  const clean = base.toString().replace(/\/$/u, '').replace(/\/(?:chat\/completions|embeddings)$/u, '');
  return `${clean}/${suffix}`;
};

export function loadOpenAICompatibleConfig(env: ProviderEnvironment): OpenAICompatibleConfig {
  const rawUrl = required(env, 'LLM_API_URL');
  let base: URL;
  try { base = new URL(rawUrl); } catch { throw new SimulationProviderError('permanent', 'LLM_CONFIG_INVALID', 'LLM_API_URL must be an absolute HTTP(S) URL'); }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new SimulationProviderError('permanent', 'LLM_CONFIG_INVALID', 'LLM_API_URL must use HTTP(S)');
  const allowUnauthenticated = env.LLM_ALLOW_UNAUTHENTICATED === 'true';
  const apiKey = env.LLM_API_KEY?.trim() || null;
  if (!apiKey && !allowUnauthenticated) throw new SimulationProviderError('permanent', 'LLM_AUTH_REQUIRED', 'LLM_API_KEY is required unless LLM_ALLOW_UNAUTHENTICATED=true');
  return {
    apiUrl: base.toString(), chatUrl: endpoint(base, env.LLM_CHAT_API_URL, 'chat/completions'),
    embeddingUrl: endpoint(base, env.LLM_EMBEDDING_API_URL, 'embeddings'),
    chatModel: required(env, 'LLM_MODEL'), embeddingModel: required(env, 'LLM_EMBEDDING_MODEL'),
    embeddingDimension: positiveInteger(env.LLM_EMBEDDING_DIMENSION, 'LLM_EMBEDDING_DIMENSION'),
    apiKey, allowUnauthenticated, timeoutMs: positiveInteger(env.LLM_TIMEOUT_MS, 'LLM_TIMEOUT_MS', 30_000),
    maxAttempts: positiveInteger(env.LLM_MAX_ATTEMPTS, 'LLM_MAX_ATTEMPTS', 3),
  };
}

/** Secret-safe diagnostics. Never return the key, headers, prompts, or raw response. */
export function describeOpenAICompatibleConfig(config: OpenAICompatibleConfig): Record<string, string | number | boolean> {
  return { provider: 'openai-compatible', apiOrigin: new URL(config.apiUrl).origin, chatModel: config.chatModel,
    embeddingModel: config.embeddingModel, embeddingDimension: config.embeddingDimension,
    authenticated: config.apiKey !== null, timeoutMs: config.timeoutMs, maxAttempts: config.maxAttempts };
}
