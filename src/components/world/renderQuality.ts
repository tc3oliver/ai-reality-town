/**
 * Render quality tiers for the animation clock (ART-119 / FR-O002 AC#7).
 *
 * A low-end device is allowed to advance the interpolation clock less often.
 * What it is *not* allowed to do is change what the world means: the tier picks
 * how many intermediate pixel positions get drawn between two projections, and
 * nothing else. `semanticLocationId`, the published destination and the animation
 * state all come from the projection, so every tier renders the same story at a
 * different smoothness — which is exactly what AC#7 asks for and what
 * `motionClock.test.ts` samples all four grids to prove.
 *
 * Pure, DOM-free and sibling to `webglSupport.ts`: the probe is injected, so the
 * thresholds are testable without a browser and the module stays inside the
 * plain-Node `unit` Jest project.
 *
 * Choosing *good* thresholds against real device data is FR-Q005 (ART-136).
 * This module ships the mechanism and a conservative default.
 */

export const RENDER_QUALITY_TIERS = ['high', 'medium', 'low'] as const;
export type RenderQualityTier = (typeof RENDER_QUALITY_TIERS)[number];

/** How often each tier advances the clock. */
export const TIER_UPDATE_HZ: Readonly<Record<RenderQualityTier, number>> = {
  high: 60,
  medium: 30,
  low: 10,
};

/**
 * The tier assumed when the device tells us nothing useful.
 *
 * `medium` rather than `high`: an unknown device is more likely to be a phone
 * than a workstation, and 30Hz interpolation is visually smooth while costing
 * half the work.
 */
export const DEFAULT_RENDER_QUALITY_TIER: RenderQualityTier = 'medium';

/** Milliseconds between clock ticks for a tier. Total: an unknown tier gets the default. */
export function updateIntervalMs(tier: RenderQualityTier): number {
  return 1000 / (TIER_UPDATE_HZ[tier] ?? TIER_UPDATE_HZ[DEFAULT_RENDER_QUALITY_TIER]);
}

/**
 * What the browser will tell us about the device. Both fields are optional
 * because both genuinely are: `deviceMemory` is Chromium-only and
 * `hardwareConcurrency` can be absent or deliberately fuzzed for privacy.
 */
export interface RenderQualityProbe {
  /** `navigator.hardwareConcurrency`: logical cores. */
  hardwareConcurrency?: number;
  /** `navigator.deviceMemory`: approximate RAM in GiB, rounded down to a power of two. */
  deviceMemory?: number;
}

const HIGH_TIER_MIN_CORES = 8;
const LOW_TIER_MAX_CORES = 2;
const LOW_TIER_MAX_MEMORY_GIB = 2;

function positiveOrUndefined(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Pick a tier from what the device reports.
 *
 * Total by construction: `undefined`, `NaN`, negative and absurd values all fall
 * through to {@link DEFAULT_RENDER_QUALITY_TIER} rather than producing a tier
 * name nothing maps. A probe that is *partly* readable is still used — one
 * signal is better than none.
 */
export function detectRenderQualityTier(probe?: RenderQualityProbe): RenderQualityTier {
  const cores = positiveOrUndefined(probe?.hardwareConcurrency);
  const memory = positiveOrUndefined(probe?.deviceMemory);
  if (cores === undefined && memory === undefined) return DEFAULT_RENDER_QUALITY_TIER;
  if ((cores !== undefined && cores <= LOW_TIER_MAX_CORES) ||
      (memory !== undefined && memory <= LOW_TIER_MAX_MEMORY_GIB)) {
    return 'low';
  }
  if (cores !== undefined && cores >= HIGH_TIER_MIN_CORES) return 'high';
  return DEFAULT_RENDER_QUALITY_TIER;
}

/**
 * Lower `tier` to at most `ceiling`.
 *
 * Reduced Motion uses this to cap the clock at `medium`. It deliberately does
 * *not* stop the clock: freezing interpolation would park a walking character
 * mid-street and then snap it to its destination on the next projection, which
 * is precisely the teleport AC#6 forbids. Reduced Motion instead collapses the
 * camera tween to zero (see `cameraModel.ts`) and holds the state indicators
 * static, both of which are the actual accessibility complaint.
 */
export function cappedTier(tier: RenderQualityTier, ceiling: RenderQualityTier): RenderQualityTier {
  return TIER_UPDATE_HZ[tier] > TIER_UPDATE_HZ[ceiling] ? ceiling : tier;
}

/** Read the tier off the real `navigator`, or the default where there is none. */
export function detectRenderQualityTierFromNavigator(): RenderQualityTier {
  if (typeof navigator === 'undefined') return DEFAULT_RENDER_QUALITY_TIER;
  const candidate = navigator as Navigator & { deviceMemory?: number };
  return detectRenderQualityTier({
    hardwareConcurrency: candidate.hardwareConcurrency,
    deviceMemory: candidate.deviceMemory,
  });
}
