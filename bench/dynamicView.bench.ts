import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_CHARACTER_IDS } from '../src/e2e/fixtureWorld';
import { FIXTURE_SCENARIO_GLOBAL } from '../src/e2e/fixtureScenario';
import {
  BENCH_CHARACTER_COUNTS,
  BENCH_MODES,
  BENCH_PROFILES,
  BENCH_THRESHOLDS,
  CHARACTER_COUNT_LIMIT,
  REQUIRES_DEPLOYMENT,
  type BenchDeviceProfile,
  type BenchMode,
  type BenchSample,
} from './profile';
import {
  averageFps,
  heapGrowthBytesPerMinute,
  p5Fps,
  sampleFrameIntervals,
  worstFps,
  soakVerdict,
  verdictsFor,
} from './measure';

/**
 * The dynamic viewing performance benchmark (FR-Q005 / ART-136, implementing NFR2-002).
 *
 * ## What makes this a benchmark rather than a set of timings
 *
 * Three things, and all three are in the OUTPUT rather than only in the setup: a named device
 * profile with a fixed CPU throttling factor, the browser version it ran under, and a fixed
 * camera zoom. A figure without those is not reproducible, and a number nobody can reproduce
 * cannot catch a regression — which is the only reason to have it.
 *
 * ## The four modes (AC#10)
 *
 * `stream` is the ordinary page. `degraded` is produced by denying WebGL through the browser,
 * exactly as `dynamicView.spec.ts` does — no product flag. `delayed` and `snapshot` are facts
 * about what the SERVER returned and cannot be produced from the browser at all, so they come
 * from the E2E fixture's scenario knob, which lives entirely inside the module the production
 * bundle reaches through one import behind one build-time literal.
 *
 * `snapshot` is the rung ART-127 wired up, and measuring it was not possible before that: the
 * live map had no code path that read the runtime snapshot.
 *
 * ## What this harness deliberately does NOT claim
 *
 * AC#2 (query P95) and AC#3 (runtime-to-screen latency) measure the transport and the server.
 * The E2E build replaces the transport with a synchronous in-process fixture, so measuring them
 * here would record roughly zero and print a pass for a path that was never exercised. They are
 * emitted as `requires_deployment` with the reason and the owning task, because a gate that
 * silently drops what it cannot measure reports green for a system nobody measured — which is
 * worse than reporting a gap, since it looks like evidence.
 *
 * Likewise the character-count sweep: Mistwood has twelve bound residents and FR-N004 AC#6
 * makes the view model drop unbound ones, so twenty and forty are not representable. Recorded
 * as `unreachable` with the reason rather than skipped. See `profile.ts`.
 */

const BASE = '/ai-town';
const LIVE = `${BASE}/live/mistwood`;
const RESULTS = resolve(process.cwd(), 'docs/benchmarks/dynamic-view-latest.json');

/** How long each FPS sample runs. Long enough to include a GC and a few camera tweens. */
const FPS_SAMPLE_MS = 4_000;

/**
 * Soak length, in minutes. Defaults to a short run so `npm run bench` stays usable; the eight
 * hours NFR2-002 asks for is an operator step at the release gate, set with the same knob.
 *
 * Stated rather than hidden: a ten-minute soak is evidence that the harness can DETECT growth,
 * not evidence that an eight-hour run is clean.
 */
const SOAK_MINUTES = Number(process.env.BENCH_SOAK_MINUTES ?? '2');
const SOAK_SAMPLE_INTERVAL_MS = 10_000;

type Result = {
  recordedAt: string;
  browser: string;
  /** Which GL stack drew the frames. A frame rate without it is not comparable to anything. */
  renderer: string;
  soakMinutes: number;
  samples: BenchSample[];
  verdicts: Array<{ profileId: string; mode: BenchMode; criterion: string; metric: string; value: number; threshold: number; pass: boolean }>;
  semanticStability: { throttledRate: number; identical: boolean; locations: Record<string, string> };
  soak: { profileId: string; durationMs: number; sampleCount: number; heapGrowthBytesPerMinute: number; verdict: ReturnType<typeof soakVerdict> } | null;
  notMeasured: Array<{ criterion: string; metric: string; status: string; reason: string }>;
};

const result: Result = {
  // Stamped by the runner, not by the page: this is metadata about the RUN.
  recordedAt: new Date().toISOString(),
  browser: '',
  renderer: '',
  soakMinutes: SOAK_MINUTES,
  samples: [],
  verdicts: [],
  semanticStability: { throttledRate: 6, identical: false, locations: {} },
  soak: null,
  notMeasured: [
    {
      criterion: 'AC#2',
      metric: 'publicDynamicQueryP95Ms',
      status: 'requires_deployment',
      reason: REQUIRES_DEPLOYMENT.publicDynamicQueryP95Ms,
    },
    {
      criterion: 'AC#3',
      metric: 'runtimeToScreenMs',
      status: 'requires_deployment',
      reason: REQUIRES_DEPLOYMENT.runtimeToScreenMs,
    },
    {
      criterion: 'AC#4 (mobile)',
      metric: 'averageFps',
      status: 'measured_but_inconclusive',
      reason: REQUIRES_DEPLOYMENT.mobileFpsRenderer,
    },
    ...BENCH_CHARACTER_COUNTS.filter((count) => count > CHARACTER_COUNT_LIMIT.available).map(
      (count) => ({
        criterion: 'AC#6/AC#9',
        metric: `visibleCharacters=${count}`,
        status: 'unreachable',
        reason: CHARACTER_COUNT_LIMIT.reason,
      }),
    ),
  ],
};

/** Deny WebGL the way a browser without it does — no product flag, no query parameter. */
async function denyWebGL(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patched(
      this: HTMLCanvasElement,
      id: string,
      ...rest: unknown[]
    ) {
      if (id === 'webgl' || id === 'webgl2' || id === 'experimental-webgl') return null;
      return (original as unknown as (...args: unknown[]) => unknown).call(this, id, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

async function setScenario(page: Page, scenario: string) {
  await page.addInitScript(
    ([name, value]) => {
      (globalThis as Record<string, unknown>)[name as string] = value;
    },
    [FIXTURE_SCENARIO_GLOBAL, scenario],
  );
}

/** CPU throttling through CDP. Chromium only, which is the fixed browser this gate names. */
async function throttleCpu(page: Page, rate: number) {
  if (rate <= 1) return;
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}

/**
 * Time to interactive: navigation start to the first camera control being operable.
 *
 * Measured against a control rather than against `load` or `domContentLoaded`, because the
 * viewer's question is "can I use this yet", and a page that has fired `load` while the Pixi
 * stage is still compiling shaders is not interactive. The town-view control is the first thing
 * a viewer can press and is present at every rung, so the same definition holds across all four
 * modes rather than measuring something different in each.
 */
async function timeToInteractive(page: Page, url: string): Promise<number> {
  const started = Date.now();
  await page.goto(url);
  await expect(page.locator('main')).toBeVisible();
  await page.locator('.degradation-notice').waitFor({ state: 'attached' });
  return Date.now() - started;
}

/** Fix the zoom (AC#9), so a figure is not quietly measured at a different scale each run. */
async function fixZoom(page: Page) {
  const townView = page.getByRole('button', { name: '回到全鎮' });
  if (await townView.count() > 0) await townView.click();
}

/** Skip the replay so the sample measures the ambient page, as `dynamicView.spec.ts` does. */
async function settle(page: Page) {
  const skip = page.getByRole('button', { name: '跳過重播' });
  if (await skip.count() > 0) await skip.click();
}

async function measureMode(page: Page, profile: BenchDeviceProfile, mode: BenchMode): Promise<BenchSample> {
  if (mode === 'degraded') await denyWebGL(page);
  if (mode === 'delayed' || mode === 'snapshot') await setScenario(page, mode);
  await throttleCpu(page, profile.cpuThrottling);

  const ttiMs = await timeToInteractive(page, LIVE);
  await settle(page);
  await fixZoom(page);

  const intervals = await sampleFrameIntervals(page, FPS_SAMPLE_MS);
  /**
   * How many characters the surface is actually presenting.
   *
   * Counted from the per-character FOCUS CONTROLS, not from `[data-character]`. The first
   * version counted the latter and recorded `0` for every animated rung — the characters are
   * drawn on a `<canvas>` and have no DOM nodes there, so the figure was silently zero in
   * exactly the three modes it mattered for, and the FPS beside it looked like it had been
   * measured against an empty map. The controls exist at every rung and are the same standard
   * ART-137's AC#2 uses for "visible": a character the surface never offers is invisible in
   * the sense that matters.
   */
  const characterCount = await page.getByRole('button', { name: /的角色卡$/ }).count();

  return {
    profileId: profile.id,
    mode,
    // What was actually on screen, not what was requested. A sample that silently drew fewer
    // characters than intended would otherwise report a flattering FPS against the wrong load.
    characterCount,
    timeToInteractiveMs: ttiMs,
    averageFps: averageFps(intervals),
    p5Fps: p5Fps(intervals),
    worstFps: worstFps(intervals),
    frameSamples: intervals.length,
  };
}

test.describe.configure({ mode: 'serial' });

test.describe('dynamic viewing benchmark (FR-Q005 / ART-136)', () => {
  test('records the browser under test', async ({ browser }) => {
    // Part of the result, not a log line. Two runs on different Chromium builds are not
    // comparable, and a results file that does not say which one ran is not reproducible.
    result.browser = `${browser.browserType().name()} ${browser.version()}`;
    expect(result.browser).not.toBe('');

    // Recorded from the page rather than inferred from the launch flags: `--ignore-gpu-blocklist`
    // is a request, and a host with no usable GPU silently falls back to SwiftShader anyway. The
    // difference between a hardware and a software rasteriser is worth roughly everything to an
    // FPS figure, so the answer has to come from the renderer that actually ran.
    const page = await browser.newPage();
    try {
      result.renderer = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2')
          ?? document.createElement('canvas').getContext('webgl');
        if (gl === null) return 'none';
        const info = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
        return info === null
          ? 'unknown'
          : String((gl as WebGLRenderingContext).getParameter(
            (info as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL));
      });
    } finally {
      await page.close();
    }
    expect(result.renderer).not.toBe('none');
  });

  for (const profile of BENCH_PROFILES) {
    for (const mode of BENCH_MODES) {
      test(`${profile.id} / ${mode}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: profile.viewport,
          deviceScaleFactor: profile.deviceScaleFactor,
          hasTouch: profile.hasTouch,
          isMobile: profile.hasTouch,
        });
        const page = await context.newPage();
        try {
          const sample = await measureMode(page, profile, mode);
          result.samples.push(sample);
          for (const verdict of verdictsFor(sample, {
            timeToInteractiveMs: BENCH_THRESHOLDS.timeToInteractiveMs[profile.id as 'desktop-reference'],
            averageFps: BENCH_THRESHOLDS.averageFps[profile.id as 'desktop-reference'],
          })) {
            result.verdicts.push({ profileId: profile.id, mode, ...verdict });
          }
        } finally {
          await context.close();
        }
      });
    }
  }

  test('AC#5 — a reduced frame rate never changes a semantic position', async ({ browser }) => {
    /**
     * `motionQualityTiers.test.ts` already proves this of the pure function. This proves it of
     * the whole path in a real engine: the same four characters are read at 1x and at 6x CPU,
     * and the location the CARD shows — the thing a viewer actually reads — must be identical.
     *
     * Read through the card rather than through an internal, because the claim worth making is
     * about what the product says, not about a field nobody sees.
     */
    const read = async (rate: number): Promise<Record<string, string>> => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      try {
        await throttleCpu(page, rate);
        await page.goto(LIVE);
        await expect(page.locator('main')).toBeVisible();
        await settle(page);
        const locations: Record<string, string> = {};
        for (const characterId of FIXTURE_CHARACTER_IDS.slice(0, 4)) {
          // Exact names. The open control reads 「查看 X 的角色卡」 and the close control
          // 「關閉 <display name> 的角色卡」, so a substring match on 「X 的角色卡」 matches both
          // the moment a card is open — a strict-mode violation that reads as a missing element.
          await page.getByRole('button', { name: `查看 ${characterId} 的角色卡`, exact: true }).click();
          const card = page.locator('section.live-character-card');
          await expect(card).toBeVisible();
          locations[characterId] = await card.locator('li', { hasText: '目前地點' }).innerText();
          await card.getByRole('button', { name: /^關閉/ }).click();
          await expect(card).toHaveCount(0);
        }
        return locations;
      } finally {
        await context.close();
      }
    };

    const unthrottled = await read(1);
    const throttled = await read(6);
    result.semanticStability = {
      throttledRate: 6,
      identical: JSON.stringify(unthrottled) === JSON.stringify(throttled),
      locations: throttled,
    };
    // Not merely recorded: a frame rate that moved a character is a correctness defect, so this
    // one is an assertion rather than a figure in a table.
    expect(throttled).toEqual(unthrottled);
  });

  test(`AC#7 — a ${SOAK_MINUTES}-minute soak shows no sustained heap growth`, async ({ browser }) => {
    test.setTimeout(SOAK_MINUTES * 60_000 + 120_000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(LIVE);
      await expect(page.locator('main')).toBeVisible();
      await settle(page);

      const durationMs = SOAK_MINUTES * 60_000;
      const samples: Array<{ atMs: number; usedHeapBytes: number }> = [];
      const started = Date.now();
      while (Date.now() - started < durationMs) {
        await page.waitForTimeout(SOAK_SAMPLE_INTERVAL_MS);
        const used = await page.evaluate(() =>
          (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
            ?.usedJSHeapSize ?? 0);
        samples.push({ atMs: Date.now() - started, usedHeapBytes: used });
      }

      const growth = heapGrowthBytesPerMinute(samples);
      const soak = { profileId: 'desktop-reference', durationMs, samples, heapGrowthBytesPerMinute: growth };
      result.soak = {
        profileId: soak.profileId,
        durationMs,
        sampleCount: samples.length,
        heapGrowthBytesPerMinute: growth,
        verdict: soakVerdict(soak, BENCH_THRESHOLDS.heapGrowthBytesPerMinute),
      };

      // `performance.memory` is Chromium-only and returns 0 elsewhere. A run of zeroes would
      // produce a perfect slope and a meaningless pass, so the reading is required to be real
      // before the verdict means anything.
      expect(samples.every((sample) => sample.usedHeapBytes > 0)).toBe(true);
      expect(samples.length).toBeGreaterThanOrEqual(3);
      expect(growth).toBeLessThanOrEqual(BENCH_THRESHOLDS.heapGrowthBytesPerMinute);
    } finally {
      await context.close();
    }
  });

  test.afterAll(() => {
    mkdirSync(dirname(RESULTS), { recursive: true });
    writeFileSync(RESULTS, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  });
});
