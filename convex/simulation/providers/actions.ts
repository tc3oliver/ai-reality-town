'use node';

import { internalAction } from '../../_generated/server';
import { describeOpenAICompatibleConfig, loadOpenAICompatibleConfig } from './config';
import { OpenAICompatibleProvider } from './openAICompatible';
import { probeProviderCapabilities } from './probes';

/** Server-only deployment probe. Return value is deliberately secret/prompt free. */
export const probeConfiguredOpenAICompatibleProvider = internalAction({
  args: {},
  handler: async () => {
    const config = loadOpenAICompatibleConfig(process.env);
    const capabilities = await probeProviderCapabilities(new OpenAICompatibleProvider(config), config);
    return { config: describeOpenAICompatibleConfig(config), capabilities };
  },
});
