'use node';

import { internalAction } from '../../_generated/server';
import { describeOpenAICompatibleConfig, loadOpenAICompatibleConfig } from './config';
import { createLanguageModelProvider } from './safeProvider';
import { probeProviderCapabilities } from './probes';

/** Server-only deployment probe. Return value is deliberately secret/prompt free. */
export const probeConfiguredOpenAICompatibleProvider = internalAction({
  args: {},
  handler: async () => {
    const config = loadOpenAICompatibleConfig(process.env);
    // ART-156: obtained through the gated factory, never by constructing the adapter directly —
    // `safeProviderBoundary.test.ts` fails the build if a second construction site appears.
    const capabilities = await probeProviderCapabilities(createLanguageModelProvider(config), config);
    return { config: describeOpenAICompatibleConfig(config), capabilities };
  },
});
