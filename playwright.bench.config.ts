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
     *
     * ## `channel: 'chromium'` is what makes "prefers the real GL stack" true (ART-138)
     *
     * It was not true before, and the flag above is why it looked true. Playwright's default
     * headless Chromium is `chrome-headless-shell`, a build with **no GPU support at all** — so
     * `--ignore-gpu-blocklist` was granting permission to use hardware that the binary could not
     * reach, and every run silently bound SwiftShader. On this project's own host, an Apple M2
     * with Metal 3, the three launch modes answer differently:
     *
     * | Launch | `UNMASKED_RENDERER_WEBGL` |
     * | --- | --- |
     * | default headless (`chrome-headless-shell`) | `ANGLE (Google, … SwiftShader Device …)` |
     * | `channel: 'chromium'` (new headless) | `ANGLE (Apple, ANGLE Metal Renderer: Apple M2, …)` |
     * | headed | `ANGLE (Apple, ANGLE Metal Renderer: Apple M2, …)` |
     *
     * So ART-138 AC#11 was never blocked on hardware this project lacks — it was blocked on the
     * harness being unable to reach hardware it had. `channel: 'chromium'` selects the full
     * Chromium build in new headless mode, which is the one that binds a GPU.
     *
     * The channel is left unset for the software path, so `BENCH_SOFTWARE_GL=1` keeps the binary
     * it always used. And because a launch option is a request rather than an outcome, the
     * benchmark does not trust this: `dynamicView.bench.ts` reads the renderer off a real page and
     * refuses to measure anything when it is not hardware.
     */
    channel: process.env.BENCH_SOFTWARE_GL === '1' ? undefined : 'chromium',
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
