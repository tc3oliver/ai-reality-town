import { resolve } from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The benchmark's sprite load probe is a SECOND Vite input, not a route (ART-173).
 *
 * `build:e2e` sets `VITE_E2E_FIXTURE=1`; `build` never does, and `fixtureIsolation.test.ts`
 * already pins that. So `bench.html` and everything it reaches are absent from the shipped
 * bundle by construction rather than by a branch some future edit could make reachable — which
 * is what lets the probe exist without giving any production module a benchmark-only seam.
 *
 * Vite builds `index.html` alone unless `rollupOptions.input` says otherwise, so the file sitting
 * in the repository root is not enough to ship it; this list is.
 */
const isE2eBuild = process.env.VITE_E2E_FIXTURE === '1';

const inputs = {
  main: resolve(__dirname, 'index.html'),
  ...(isE2eBuild ? { bench: resolve(__dirname, 'bench.html') } : {}),
};

// https://vitejs.dev/config/
export default defineConfig({
  base: '/ai-town',
  plugins: [react()],
  build: {
    rollupOptions: { input: inputs },
  },
  server: {
    allowedHosts: ['ai-town-your-app-name.fly.dev', 'localhost', '127.0.0.1'],
  },
});
