/**
 * The benchmark's fixed environment and its thresholds (FR-Q005 / ART-136 AC#8).
 *
 * A performance number without a recorded environment is not a benchmark — it is an anecdote.
 * Two runs on different machines are not comparable, and neither is the same machine before
 * and after an OS update. So the device profile, the throttling factor and the browser version
 * are all part of the OUTPUT, not just the input, and the report prints them beside every
 * figure.
 *
 * ## Why CPU throttling rather than a real phone
 *
 * NFR2-002 names a "mid-tier mobile" target. This repo's CI has no device lab, and a benchmark
 * that only ran where someone had a Pixel would not be the repeatable gate AC#11 asks for. CDP's
 * `Emulation.setCPUThrottlingRate` gives a deterministic, named slowdown that the same figure
 * can be reproduced against anywhere — which is the property that matters for catching a
 * regression. What it does NOT reproduce is a mobile GPU, and that is stated in the report
 * rather than implied: the mobile FPS figure here is a CPU-bound proxy, and the release gate
 * (ART-138) is where a real device is expected to appear.
 */

/** Named, so a recorded figure says what it was measured on. */
export type BenchDeviceProfile = {
  id: string;
  label: string;
  viewport: { width: number; height: number };
  /** CDP CPU throttling multiplier. 1 is unthrottled. */
  cpuThrottling: number;
  deviceScaleFactor: number;
  hasTouch: boolean;
};

export const BENCH_PROFILES: readonly BenchDeviceProfile[] = [
  {
    id: 'desktop-reference',
    label: 'Desktop reference — 1440×900, no CPU throttling',
    viewport: { width: 1440, height: 900 },
    cpuThrottling: 1,
    deviceScaleFactor: 1,
    hasTouch: false,
  },
  {
    /**
     * The named mid-tier device AC#8 requires. Pixel 5's viewport and device scale, with a 4×
     * CPU slowdown — the factor Chrome's own "Mid-tier mobile" preset uses, so the number is
     * an industry reference point rather than one invented here.
     */
    id: 'mid-tier-mobile',
    label: 'Mid-tier mobile — Pixel 5 viewport, 4× CPU throttling',
    viewport: { width: 393, height: 851 },
    cpuThrottling: 4,
    deviceScaleFactor: 2.75,
    hasTouch: true,
  },
];

/**
 * NFR2-002's thresholds, one constant per PRD figure.
 *
 * Transcribed rather than paraphrased, and each carries the acceptance criterion it settles so
 * a failing run points at a requirement rather than at a number.
 */
export const BENCH_THRESHOLDS = {
  /** AC#1 */
  timeToInteractiveMs: { 'desktop-reference': 4_000, 'mid-tier-mobile': 6_000 },
  /** AC#4 */
  averageFps: { 'desktop-reference': 45, 'mid-tier-mobile': 30 },
  /** AC#2 — transport-bound; see `requiresDeployment`. */
  publicDynamicQueryP95Ms: 500,
  /** AC#3 — server-bound; see `requiresDeployment`. */
  runtimeToScreenMs: 5_000,
  /**
   * AC#7. A soak passes when the least-squares slope of heap size over the run is below this.
   * Not "the last sample is no higher than the first": GC timing makes any two samples a coin
   * flip, and a run that happened to end just after a collection would pass while leaking.
   */
  heapGrowthBytesPerMinute: 512 * 1024,
} as const;

/**
 * The criteria this harness cannot settle from a fixture build, and who settles them.
 *
 * Recorded in the results file as `requires_deployment` rather than omitted or defaulted to
 * pass. A gate that silently drops the criteria it cannot measure reports green for a system
 * nobody has measured — which is worse than reporting a gap, because it looks like evidence.
 */
export const REQUIRES_DEPLOYMENT = {
  publicDynamicQueryP95Ms:
    'AC#2 measures Convex query latency. The E2E build replaces the TRANSPORT with a '
    + 'synchronous in-process fixture, so measuring it here would record ~0ms and report a '
    + 'pass for a path that was never exercised. Must be measured against a deployment; the '
    + 'release gate (ART-138) owns the execution.',
  runtimeToScreenMs:
    'AC#3 measures Canon-commit to on-screen latency, which spans the simulation, the '
    + 'projection rebuild and the subscription push — none of which exist in a fixture build. '
    + "ART-133 already publishes the server half as the `runtimeProjectionLatency` metric "
    + '(`server_measured`); the end-to-end figure belongs to ART-138.',
  mobileFpsRenderer:
    'AC#4 mobile. This host has no usable GPU: Chromium reports an ANGLE/SwiftShader device '
    + 'even with the GPU blocklist ignored, so the mobile profile software-rasterises a '
    + '1080x2340 backing store (2.5 Mpx, roughly twice the desktop profile) while also under 4x '
    + 'CPU throttling. The recorded figure is real and is reported as a FAIL against the 30fps '
    + 'threshold — it is not exempted — but it cannot settle the criterion either way for a '
    + 'device with hardware graphics. An authoritative mobile figure needs a real device, which '
    + 'is the release gate (ART-138). Re-running on a GPU host, or with BENCH_SOFTWARE_GL '
    + 'unset on a machine that has one, produces the comparable number.',
} as const;

/** The character counts NFR2-002 asks for (AC#6 / AC#9). */
export const BENCH_CHARACTER_COUNTS = [12, 20, 40] as const;

/**
 * Why only twelve are reachable, recorded so the gap is a finding rather than an omission.
 *
 * Mistwood has exactly twelve residents: `MISTWOOD_CHARACTER_VISUALS` holds twelve,
 * `mistwoodCharacterSpriteKeys` is derived from it, and `mistwoodCharacters.test.ts` pins the
 * roster against `buildMistwoodCharacterVisualBindings()`. `composeReadOnlyWorldViewModel` then
 * DROPS any character with no visual binding, because FR-N004 AC#6 requires an unbound
 * character to be rejected rather than silently reskinned.
 *
 * So twenty and forty visible characters are not "not yet measured" — they are not
 * representable in this world without breaking one of those two guarantees. The harness takes
 * the count as a parameter, so the criterion becomes measurable the day a world has more
 * residents; inventing twelve extra bindings to make a number appear would be measuring a
 * world that does not exist, which is precisely what the fixture rule (ART-107 §8) forbids.
 */
export const CHARACTER_COUNT_LIMIT = {
  available: 12,
  reason:
    'Mistwood has twelve bound residents. FR-N004 AC#6 makes the view model drop unbound '
    + 'characters, and the roster is pinned against the production visual bindings, so 20 and '
    + '40 visible characters cannot be produced without breaking one of those guarantees.',
} as const;

/** The four states NFR2-002 requires figures for (AC#10). */
export const BENCH_MODES = ['stream', 'delayed', 'snapshot', 'degraded'] as const;
export type BenchMode = (typeof BENCH_MODES)[number];

export type BenchSample = {
  profileId: string;
  mode: BenchMode;
  characterCount: number;
  timeToInteractiveMs: number;
  averageFps: number;
  /** The 5th percentile — sustained choppiness, as against a one-off. */
  p5Fps: number;
  /** The single slowest frame. The only one of the three that sees a lone stall. */
  worstFps: number;
  frameSamples: number;
};

export type BenchSoak = {
  profileId: string;
  durationMs: number;
  samples: Array<{ atMs: number; usedHeapBytes: number }>;
  heapGrowthBytesPerMinute: number;
};
