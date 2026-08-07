/**
 * The render quality tier is a total function of an unreliable probe
 * (ART-119 / FR-O002 AC#7).
 *
 * `navigator.deviceMemory` is Chromium-only and `hardwareConcurrency` can be
 * absent, zero or deliberately fuzzed for privacy. A tier lookup that returned
 * `undefined` for any of those would divide by nothing and stop the clock, so
 * every input has to land on a real tier.
 *
 * Choosing *good* thresholds against real devices is FR-Q005 (ART-136); what is
 * asserted here is that the mechanism is total and ordered.
 */

import {
  cappedTier,
  DEFAULT_RENDER_QUALITY_TIER,
  detectRenderQualityTier,
  RENDER_QUALITY_TIERS,
  TIER_UPDATE_HZ,
  updateIntervalMs,
} from './renderQuality';

describe('tier definitions', () => {
  test('every tier has a positive, finite update rate', () => {
    for (const tier of RENDER_QUALITY_TIERS) {
      expect(TIER_UPDATE_HZ[tier]).toBeGreaterThan(0);
      expect(Number.isFinite(updateIntervalMs(tier))).toBe(true);
      expect(updateIntervalMs(tier)).toBeGreaterThan(0);
    }
  });

  test('the tiers are ordered: a lower tier ticks less often', () => {
    expect(TIER_UPDATE_HZ.high).toBeGreaterThan(TIER_UPDATE_HZ.medium);
    expect(TIER_UPDATE_HZ.medium).toBeGreaterThan(TIER_UPDATE_HZ.low);
    expect(updateIntervalMs('high')).toBeLessThan(updateIntervalMs('low'));
  });
});

describe('detectRenderQualityTier', () => {
  test('an unreadable probe gets the default, never `undefined`', () => {
    const unreadable = [
      undefined,
      {},
      { hardwareConcurrency: Number.NaN },
      { hardwareConcurrency: 0 },
      { hardwareConcurrency: -4 },
      { deviceMemory: Number.NaN },
      { hardwareConcurrency: Infinity, deviceMemory: Infinity },
    ];
    for (const probe of unreadable) {
      expect(detectRenderQualityTier(probe)).toBe(DEFAULT_RENDER_QUALITY_TIER);
    }
  });

  test('reads a workstation as high and a low-end phone as low', () => {
    expect(detectRenderQualityTier({ hardwareConcurrency: 16, deviceMemory: 32 })).toBe('high');
    expect(detectRenderQualityTier({ hardwareConcurrency: 2, deviceMemory: 1 })).toBe('low');
  });

  test('one readable signal is enough', () => {
    expect(detectRenderQualityTier({ hardwareConcurrency: 12 })).toBe('high');
    expect(detectRenderQualityTier({ deviceMemory: 1 })).toBe('low');
    expect(detectRenderQualityTier({ hardwareConcurrency: 4 })).toBe('medium');
  });

  test('little memory outranks many cores', () => {
    // A device that reports plenty of cores and 1GiB of RAM is a constrained
    // device whatever its core count says.
    expect(detectRenderQualityTier({ hardwareConcurrency: 16, deviceMemory: 1 })).toBe('low');
  });

  test('always returns a declared tier', () => {
    const probes = [
      undefined, {}, { hardwareConcurrency: 1 }, { hardwareConcurrency: 4 },
      { hardwareConcurrency: 64, deviceMemory: 64 }, { deviceMemory: 0.5 },
    ];
    for (const probe of probes) {
      expect(RENDER_QUALITY_TIERS).toContain(detectRenderQualityTier(probe));
    }
  });
});

describe('cappedTier', () => {
  test('lowers a faster tier and leaves a slower one alone', () => {
    expect(cappedTier('high', 'medium')).toBe('medium');
    expect(cappedTier('low', 'medium')).toBe('low');
    expect(cappedTier('medium', 'medium')).toBe('medium');
  });

  test('Reduced Motion caps the clock but never stops it', () => {
    // Freezing interpolation would park a walking character mid-street and then
    // snap it to its destination on the next projection -- which is exactly the
    // teleport AC#6 forbids. The accessibility answer is fewer camera tweens and
    // static indicators, not a frozen world.
    for (const tier of RENDER_QUALITY_TIERS) {
      expect(TIER_UPDATE_HZ[cappedTier(tier, 'medium')]).toBeGreaterThan(0);
    }
  });
});
