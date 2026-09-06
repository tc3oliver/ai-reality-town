import { SimulationProviderError, type LanguageModelProvider } from '../provider';
import type { OpenAICompatibleConfig } from './config';

export type ProviderCapabilityProbe = {
  /**
   * `model` is the CONFIGURED id, which may be a routing alias. `resolvedModel` and
   * `upstreamProvider` are what the gateway said actually served the probe, or null when it did
   * not say — the only way to see, without running a world day, whether an alias like `auto` is
   * observable at all in this deployment (ART-148).
   */
  chat: { compatible: true; model: string; resolvedModel: string | null; upstreamProvider: string | null };
  embedding: { compatible: true; model: string; resolvedModel: string | null; dimension: number };
};

export async function probeProviderCapabilities(
  provider: LanguageModelProvider,
  config: Pick<OpenAICompatibleConfig, 'chatModel' | 'embeddingModel' | 'embeddingDimension'>,
): Promise<ProviderCapabilityProbe> {
  let chat;
  try {
    chat = await provider.structuredChat({ messages: [{ role: 'user', content: 'Return {"probe":"ok"}.' }],
      schemaName: 'compatibility_probe', jsonSchema: { type: 'object', properties: { probe: { const: 'ok' } }, required: ['probe'], additionalProperties: false },
      temperature: 0, maxTokens: 32 });
  } catch (error) {
    if (error instanceof SimulationProviderError) throw error;
    throw new SimulationProviderError('permanent', 'LLM_CHAT_PROBE_FAILED', 'chat capability probe failed');
  }
  if (!chat.output || typeof chat.output !== 'object' || Array.isArray(chat.output)
      || (chat.output as Record<string, unknown>).probe !== 'ok') {
    throw new SimulationProviderError('permanent', 'LLM_STRUCTURED_OUTPUT_UNSUPPORTED', 'chat endpoint did not honor structured JSON output');
  }
  let embedding;
  try { embedding = await provider.embed('compatibility probe'); } catch (error) {
    if (error instanceof SimulationProviderError) throw error;
    throw new SimulationProviderError('permanent', 'LLM_EMBEDDING_PROBE_FAILED', 'embedding capability probe failed');
  }
  if (embedding.embedding.length !== config.embeddingDimension) {
    throw new SimulationProviderError('permanent', 'LLM_EMBEDDING_DIMENSION_MISMATCH', `expected ${config.embeddingDimension} embedding dimensions`);
  }
  return {
    chat: { compatible: true, model: config.chatModel,
      resolvedModel: chat.trace.resolvedModel, upstreamProvider: chat.trace.upstreamProvider },
    embedding: { compatible: true, model: config.embeddingModel,
      resolvedModel: embedding.trace.resolvedModel, dimension: config.embeddingDimension },
  };
}
