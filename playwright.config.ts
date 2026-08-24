import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E for the dynamic viewing experience (FR-Q006 / ART-137).
 *
 * PRD 2.0 §22 makes browser evidence on desktop AND mobile a release gate, so both are projects
 * here and the same spec runs in both — a suite that only ran the mobile assertions on mobile
 * would leave the desktop layout's own regressions uncovered, and vice versa.
 *
 * Serves the `dist-e2e` build produced by `npm run build:e2e`, which is the ordinary production
 * build with one difference: `VITE_E2E_FIXTURE=1` swaps the Convex TRANSPORT for a deterministic
 * fixture. Every component, hook, view model and renderer in the run is the shipped one. Serving
 * a build rather than the dev server is deliberate — the gate is about what ships.
 *
 * `retries: 0` locally and in CI. A retried browser test hides exactly the flake this suite
 * exists to surface; if it is not deterministic, the fixture is wrong.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    // WITHOUT the `/ai-town` path segment, deliberately. Playwright resolves a goto argument
    // with `new URL`, so an absolute path like `/live/mistwood` DISCARDS the base's path and
    // requests `/live/mistwood` — a 404 that renders an empty page and fails every assertion for
    // a reason that looks nothing like the cause. The spec carries the deploy prefix explicitly.
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    // WebGL is what the map needs; without it the page legitimately renders the documented
    // fallback and every canvas assertion would be testing the wrong page.
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // A real phone profile rather than a resized desktop: touch, device scale and the
    // narrow viewport are all part of what AC#8 is about.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'npx vite preview --outDir dist-e2e --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/ai-town/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
