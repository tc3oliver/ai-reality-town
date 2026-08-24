/**
 * The benchmark's arithmetic (FR-Q005 / ART-136).
 *
 * The half of a benchmark most likely to be quietly wrong is not the browser driving — a broken
 * navigation fails loudly — it is the statistics. A mean taken over the wrong array, a
 * percentile off by one, a slope with the axes swapped: all of those produce plausible numbers
 * that pass a threshold and mean nothing. So the maths is a pure module and is exercised
 * against samples whose right answer is known by construction.
 */

import {
  averageFps,
  heapGrowthBytesPerMinute,
  p5Fps,
  soakVerdict,
  verdictsFor,
  worstFps,
} from './measure';
import { BENCH_CHARACTER_COUNTS, BENCH_MODES, BENCH_PROFILES, BENCH_THRESHOLDS, CHARACTER_COUNT_LIMIT } from './profile';

describe('frame rate', () => {
  test('a steady 60fps run reads as 60', () => {
    expect(averageFps(Array(120).fill(1000 / 60))).toBeCloseTo(60, 1);
  });

  test('a steady 30fps run reads as 30', () => {
    expect(averageFps(Array(60).fill(1000 / 30))).toBeCloseTo(30, 1);
  });

  test('a single stall is invisible to BOTH the mean and the percentile — only the worst frame sees it', () => {
    // 119 good frames and one 400ms hitch. The mean is fine, and so is P5: one bad frame in 120
    // is the worst 0.8%, well inside the 5th percentile. That is P5 behaving correctly, and it
    // is also why reporting only a mean and a percentile would let a visible freeze through.
    const intervals = [...Array(119).fill(1000 / 60), 400];
    expect(averageFps(intervals)).toBeGreaterThan(45);
    expect(p5Fps(intervals)).toBeGreaterThan(45);
    expect(worstFps(intervals)).toBeLessThan(10);
  });

  test('sustained choppiness is what the percentile is for', () => {
    // A tenth of the run at 8fps. Now the mean still passes a 45fps threshold, and P5 is the
    // figure that says the viewer spent real time watching it stutter.
    const intervals = [...Array(108).fill(1000 / 60), ...Array(12).fill(125)];
    expect(averageFps(intervals)).toBeGreaterThan(30);
    expect(p5Fps(intervals)).toBeLessThan(12);
  });

  test('a run that produced no frames reads as zero, not NaN', () => {
    // NaN fails every threshold comparison silently, so a page that never painted would be
    // recorded as passing rather than as broken.
    expect(averageFps([])).toBe(0);
    expect(p5Fps([])).toBe(0);
    expect(worstFps([])).toBe(0);
    expect(averageFps([0, 0])).toBe(0);
  });
});

describe('heap growth', () => {
  const at = (minute: number, mb: number) => ({ atMs: minute * 60_000, usedHeapBytes: mb * 1024 * 1024 });

  test('a flat heap has no growth', () => {
    expect(heapGrowthBytesPerMinute([at(0, 50), at(1, 50), at(2, 50), at(3, 50)])).toBe(0);
  });

  test('a steady leak is reported at its real rate', () => {
    // 1 MiB per minute, exactly.
    const samples = [0, 1, 2, 3, 4].map((minute) => at(minute, 50 + minute));
    expect(heapGrowthBytesPerMinute(samples)).toBeCloseTo(1024 * 1024, -3);
  });

  test('an ordinary sawtooth is not mistaken for a leak', () => {
    // The case that broke the first implementation. A plain regression over these raw samples
    // reported nearly 3 MiB/min of growth for a heap that returns to the same floor every
    // cycle — enough to fail AC#7 on a page with no leak at all. Measuring the post-collection
    // FLOOR is what makes the answer zero.
    const samples = [];
    for (let minute = 0; minute < 18; minute += 1) {
      samples.push(at(minute, [40, 55, 70][minute % 3]));
    }
    expect(Math.abs(heapGrowthBytesPerMinute(samples))).toBeLessThan(64 * 1024);
  });

  test('a leak hiding under a sawtooth is still caught, because the floor rises', () => {
    // Same cycle amplitude, but each collection leaves 1 MiB more behind than the last. The
    // peaks and the floor both climb; the floor is the one that means something.
    const samples = [];
    for (let minute = 0; minute < 18; minute += 1) {
      samples.push(at(minute, [40, 55, 70][minute % 3] + minute));
    }
    expect(heapGrowthBytesPerMinute(samples)).toBeGreaterThan(512 * 1024);
  });

  test('a run that ends just after a collection is not reported as shrinking', () => {
    // The mirror failure: a genuine leak whose final sample lands right after a GC. "Last minus
    // first" would report NEGATIVE growth and pass a leaking page.
    const samples = [];
    for (let minute = 0; minute < 12; minute += 1) samples.push(at(minute, 50 + minute * 2));
    samples.push(at(12, 55));
    expect(heapGrowthBytesPerMinute(samples)).toBeGreaterThan(0);
  });

  test('too few samples report zero rather than an invented slope', () => {
    expect(heapGrowthBytesPerMinute([])).toBe(0);
    expect(heapGrowthBytesPerMinute([at(0, 50)])).toBe(0);
    // Every sample at the same instant: the slope is undefined, not infinite.
    expect(heapGrowthBytesPerMinute([at(0, 50), at(0, 90)])).toBe(0);
  });
});

describe('verdicts point at requirements, not at numbers', () => {
  const sample = {
    profileId: 'desktop-reference',
    mode: 'stream' as const,
    characterCount: 12,
    timeToInteractiveMs: 1_200,
    averageFps: 58,
    p5Fps: 40,
    worstFps: 22,
    frameSamples: 200,
  };

  test('a healthy sample passes both of its criteria', () => {
    const verdicts = verdictsFor(sample, { timeToInteractiveMs: 4_000, averageFps: 45 });
    expect(verdicts.every((verdict) => verdict.pass)).toBe(true);
    expect(verdicts.map((verdict) => verdict.criterion)).toEqual(['AC#1', 'AC#4']);
  });

  test('the comparisons run in the right DIRECTION for each metric', () => {
    // TTI is an upper bound and FPS is a lower one. Getting the inequality backwards is the
    // single easiest way to build a benchmark that always passes, and it would look correct.
    const slow = verdictsFor({ ...sample, timeToInteractiveMs: 9_000 }, { timeToInteractiveMs: 4_000, averageFps: 45 });
    expect(slow.find((verdict) => verdict.metric === 'timeToInteractiveMs')?.pass).toBe(false);

    const choppy = verdictsFor({ ...sample, averageFps: 10 }, { timeToInteractiveMs: 4_000, averageFps: 45 });
    expect(choppy.find((verdict) => verdict.metric === 'averageFps')?.pass).toBe(false);
  });

  test('a threshold met exactly passes', () => {
    const verdicts = verdictsFor({ ...sample, timeToInteractiveMs: 4_000, averageFps: 45 }, {
      timeToInteractiveMs: 4_000,
      averageFps: 45,
    });
    expect(verdicts.every((verdict) => verdict.pass)).toBe(true);
  });

  test('the soak verdict is an upper bound on growth', () => {
    const soak = { profileId: 'desktop-reference', durationMs: 60_000, samples: [], heapGrowthBytesPerMinute: 0 };
    expect(soakVerdict({ ...soak, heapGrowthBytesPerMinute: 10 }, 1_000).pass).toBe(true);
    expect(soakVerdict({ ...soak, heapGrowthBytesPerMinute: 5_000 }, 1_000).pass).toBe(false);
  });
});

describe('the profile is part of the record, not just the setup', () => {
  test('every profile is named and carries a throttling factor', () => {
    for (const profile of BENCH_PROFILES) {
      expect(profile.id).toMatch(/^[a-z-]+$/);
      // AC#8 asks for a NAMED device or equivalent throttling profile. A profile whose label
      // did not say what it was would satisfy the type and not the criterion.
      expect(profile.label.length).toBeGreaterThan(profile.id.length);
      expect(profile.cpuThrottling).toBeGreaterThanOrEqual(1);
    }
  });

  test('there is a threshold for every profile, for every thresholded metric', () => {
    // A profile added without thresholds would silently be measured and never judged.
    for (const profile of BENCH_PROFILES) {
      expect(BENCH_THRESHOLDS.timeToInteractiveMs).toHaveProperty(profile.id);
      expect(BENCH_THRESHOLDS.averageFps).toHaveProperty(profile.id);
    }
  });

  test('the four NFR2-002 modes are all declared', () => {
    expect([...BENCH_MODES]).toEqual(['stream', 'delayed', 'snapshot', 'degraded']);
  });

  test('the unreachable character counts are stated with a reason, not omitted', () => {
    const unreachable = BENCH_CHARACTER_COUNTS.filter((count) => count > CHARACTER_COUNT_LIMIT.available);
    expect(unreachable).toEqual([20, 40]);
    // The reason has to name the constraint. A gap recorded as "not supported" teaches the
    // next reader nothing and invites someone to fabricate the number.
    expect(CHARACTER_COUNT_LIMIT.reason).toContain('FR-N004');
  });
});
