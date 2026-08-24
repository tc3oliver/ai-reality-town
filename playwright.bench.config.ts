import { defineConfig } from '@playwright/test';

/**
 * The performance benchmark's runner (FR-Q005 / ART-136).
 *
 * Separate from `playwright.config.ts` because a benchmark and a correctness suite want
 * opposite things. The E2E suite runs two device projects over the same spec; the benchmark
 * owns its own device profiles as DATA (`bench/profile.ts`), because the profile has to appear
 * in the results file — a figure whose environment is not recorded cannot be reproduced, and a
 * figure nobody can reproduce cannot catch a regression.
 *
 * `workers: 1` and serial mode are not tidiness. Two benchmark pages sharing a CPU measure each
 * other's contention, and CPU contention is exactly what the figures are about.
 *
 * Serves the same `dist-e2e` build the E2E suite does: the shipped bundle with the transport
 * replaced. Benchmarking a dev-server page would measure Vite's module graph rather than the
 * product.
 */
export default defineConfig({
  testDir: './bench',
  testMatch: ['**/*.bench.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A retried benchmark reports the luckiest run, which is the opposite of what a gate wants.
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    /**
     * GL selection is a MEASUREMENT decision here, not a compatibility one.
     *
     * The E2E suite forces `--use-gl=swiftshader` so the map draws deterministically wherever
     * it runs. Doing that in a benchmark would measure a software rasteriser and then judge it
     * against a threshold written for a device with a GPU — the figure would be a floor for a
     * machine with no graphics hardware at all, not a proxy for a mid-tier phone.
     *
     * So the benchmark prefers the real GL stack and falls back to swiftshader only when the
     * host has none. `BENCH_SOFTWARE_GL=1` forces the software path; the results file records
     * which one ran, because a frame rate whose renderer is unrecorded is not comparable to
     * anything.
     */
    launchOptions: {
      args: process.env.BENCH_SOFTWARE_GL === '1'
        ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
        : ['--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npx vite preview --outDir dist-e2e --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/ai-town/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
