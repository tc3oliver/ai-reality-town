import { SimulationProviderError, type LanguageModelProvider } from '../provider';
import type { OpenAICompatibleConfig } from './config';

export type ProviderCapabilityProbe = {
  chat: { compatible: true; model: string };
  embedding: { compatible: true; model: string; dimension: number };
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
  return { chat: { compatible: true, model: config.chatModel },
    embedding: { compatible: true, model: config.embeddingModel, dimension: config.embeddingDimension } };
}
