/**
 * The measurements themselves (FR-Q005 / ART-136).
 *
 * Split out of the spec so each one is a named function with its own reasoning, and so the
 * arithmetic that decides pass or fail is unit-testable without a browser — `measure.test.ts`
 * exercises the FPS and heap-slope maths against hand-built samples, which is the half of a
 * benchmark most likely to be quietly wrong.
 */

import type { BenchSoak, BenchSample } from './profile';

/**
 * Frames per second, sampled in-page over `durationMs`.
 *
 * Counted with `requestAnimationFrame` rather than read from a CDP trace on purpose: rAF is
 * what the renderer is actually driven by (`useMotionClock`), so this counts the frames the
 * product schedules rather than the compositor's own cadence. A page that scheduled thirty
 * frames and dropped none reads 30 here, which is the honest answer to "how often did the map
 * update".
 *
 * Returns per-frame intervals, so the caller can take both a mean and a low percentile. A mean
 * alone hides the case that actually looks broken: a run that holds 60 and then stalls for
 * 400ms averages fine.
 */
export async function sampleFrameIntervals(
  page: { evaluate: <T>(fn: (arg: number) => Promise<T> | T, arg: number) => Promise<T> },
  durationMs: number,
): Promise<number[]> {
  return page.evaluate(async (ms: number) => {
    const stamps: number[] = [];
    await new Promise<void>((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        stamps.push(now);
        if (now - start >= ms) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const intervals: number[] = [];
    for (let index = 1; index < stamps.length; index += 1) {
      intervals.push(stamps[index] - stamps[index - 1]);
    }
    return intervals;
  }, durationMs);
}

/** Mean FPS from per-frame intervals. `0` for a run that produced no frames at all. */
export function averageFps(intervals: readonly number[]): number {
  const usable = intervals.filter((interval) => interval > 0);
  if (usable.length === 0) return 0;
  const meanInterval = usable.reduce((total, interval) => total + interval, 0) / usable.length;
  return round(1_000 / meanInterval);
}

/**
 * The 5th-percentile FPS: the slowest frames, which is what a viewer perceives as a stutter.
 *
 * Derived from the 95th-percentile INTERVAL, not from the 5th-percentile of per-frame FPS
 * values — those are the same ordering, but going through intervals keeps the arithmetic in
 * the units the samples are actually in.
 */
export function p5Fps(intervals: readonly number[]): number {
  const usable = intervals.filter((interval) => interval > 0).sort((a, b) => a - b);
  if (usable.length === 0) return 0;
  const index = Math.min(usable.length - 1, Math.floor(usable.length * 0.95));
  return round(1_000 / usable[index]);
}

/**
 * The slowest single frame, as FPS.
 *
 * Reported beside the mean and the percentile because neither of those catches ONE stall, and
 * one 400ms stall is exactly what a viewer calls "it froze". With 120 frames a single hitch is
 * the worst 0.8% — below the 5th percentile entirely — so P5 correctly reports 60 and correctly
 * tells you nothing about it. Three figures, three questions: how fast on average, how bad when
 * it is consistently bad, and how bad at its worst.
 */
export function worstFps(intervals: readonly number[]): number {
  const usable = intervals.filter((interval) => interval > 0);
  if (usable.length === 0) return 0;
  return round(1_000 / Math.max(...usable));
}

/** How many windows the heap floor is measured over. Enough to see a trend, few enough to be a floor. */
const HEAP_FLOOR_BUCKETS = 6;

/**
 * Growth of the heap's POST-COLLECTION FLOOR over time, in bytes per minute.
 *
 * ## Why the floor and not the raw samples
 *
 * A least-squares fit over raw heap samples was the first version of this, and it is wrong in a
 * way that looks right. Every JS heap sawtooths — allocate, collect, allocate — and a
 * regression over a sawtooth does not return zero unless the cycles happen to align with the
 * sample window. A perfectly healthy page cycling 40→60 MiB reported nearly 3 MiB/min of
 * "growth" purely from where its cycles fell, which would have failed AC#7 on a page with no
 * leak at all. Raising the threshold until that stopped happening would have been fitting the
 * gate to the noise.
 *
 * What actually distinguishes a leak is that the heap does not come back DOWN as far as it did
 * before. So the run is split into windows, the minimum of each window is taken — the
 * post-collection floor — and the trend is measured across those. A sawtooth of constant
 * amplitude has a flat floor; a leak has a rising one.
 *
 * "Last minus first" is wrong for the same underlying reason and in both directions: a run
 * ending just after a collection reports negative growth while leaking, and one ending just
 * before reports a large positive while healthy.
 *
 * Returns `0` for too few samples or a zero-width time span — an undefined slope is not a
 * measurement, and the soak separately requires a minimum sample count before its verdict
 * means anything.
 */
export function heapGrowthBytesPerMinute(
  samples: readonly { atMs: number; usedHeapBytes: number }[],
): number {
  if (samples.length < 2) return 0;
  const floors = heapFloors(samples);
  if (floors.length < 2) return 0;

  const n = floors.length;
  const meanX = floors.reduce((total, s) => total + s.atMs, 0) / n;
  const meanY = floors.reduce((total, s) => total + s.usedHeapBytes, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (const floor of floors) {
    const dx = floor.atMs - meanX;
    covariance += dx * (floor.usedHeapBytes - meanY);
    variance += dx * dx;
  }
  if (variance === 0) return 0;
  return round((covariance / variance) * 60_000);
}

/**
 * The minimum sample in each of {@link HEAP_FLOOR_BUCKETS} equal time windows.
 *
 * Windows by TIME rather than by sample count, so an interval that drifts — and
 * `page.waitForTimeout` does drift under CPU throttling — does not skew which samples land in
 * which bucket. An empty window contributes nothing rather than a zero.
 */
function heapFloors(
  samples: readonly { atMs: number; usedHeapBytes: number }[],
): Array<{ atMs: number; usedHeapBytes: number }> {
  const first = samples[0].atMs;
  const last = samples[samples.length - 1].atMs;
  const span = last - first;
  if (span <= 0) return [];
  const width = span / HEAP_FLOOR_BUCKETS;

  const floors: Array<{ atMs: number; usedHeapBytes: number }> = [];
  for (let bucket = 0; bucket < HEAP_FLOOR_BUCKETS; bucket += 1) {
    const start = first + bucket * width;
    const end = bucket === HEAP_FLOOR_BUCKETS - 1 ? last + 1 : start + width;
    const inWindow = samples.filter((sample) => sample.atMs >= start && sample.atMs < end);
    if (inWindow.length === 0) continue;
    floors.push(inWindow.reduce((lowest, sample) =>
      sample.usedHeapBytes < lowest.usedHeapBytes ? sample : lowest));
  }
  return floors;
}

/** Two decimal places, so a recorded figure does not imply precision the sampling lacks. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Whether a sample meets its thresholds, and which criterion each verdict settles. */
export function verdictsFor(
  sample: BenchSample,
  thresholds: { timeToInteractiveMs: number; averageFps: number },
): Array<{ criterion: string; metric: string; value: number; threshold: number; pass: boolean }> {
  return [
    {
      criterion: 'AC#1',
      metric: 'timeToInteractiveMs',
      value: sample.timeToInteractiveMs,
      threshold: thresholds.timeToInteractiveMs,
      pass: sample.timeToInteractiveMs <= thresholds.timeToInteractiveMs,
    },
    {
      criterion: 'AC#4',
      metric: 'averageFps',
      value: sample.averageFps,
      threshold: thresholds.averageFps,
      pass: sample.averageFps >= thresholds.averageFps,
    },
  ];
}

export function soakVerdict(
  soak: BenchSoak,
  thresholdBytesPerMinute: number,
): { criterion: string; metric: string; value: number; threshold: number; pass: boolean } {
  return {
    criterion: 'AC#7',
    metric: 'heapGrowthBytesPerMinute',
    value: soak.heapGrowthBytesPerMinute,
    threshold: thresholdBytesPerMinute,
    pass: soak.heapGrowthBytesPerMinute <= thresholdBytesPerMinute,
  };
}
