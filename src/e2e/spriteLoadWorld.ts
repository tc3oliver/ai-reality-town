/**
 * A synthetic sprite LOAD PROBE for the dynamic-view benchmark (FR-Q005 / ART-136 AC#6, ART-173).
 *
 * ## What this is, and what it is emphatically not
 *
 * NFR2-002 AC#4 is a **renderer-capacity** threshold: can the dynamic layer sustain its frame
 * rate with N animated sprites plus ambient motion. It is not a claim that the town has forty
 * residents. The benchmark previously recorded 20 and 40 as `unreachable` because Mistwood has
 * twelve bound residents — an argument that is right about the WORLD and wrong about the
 * MEASUREMENT, and one that reported a limitation the requirement does not grant.
 *
 * **Nothing here is a world.** The characters are `probe-00 … probe-39`, they carry no Canon, no
 * names and no locations that mean anything, and they are never served to a viewer: this module
 * lives in `src/e2e/`, which production reaches through exactly one import inside one branch on
 * one build-time literal, and its entry point is a SEPARATE Vite input that only `build:e2e`
 * adds. A sample produced from it must be labelled as a probe wherever it is published — a figure
 * a reader could take as「Mistwood has forty residents」would be worse than the gap it closes.
 *
 * ## Why no production module changed
 *
 * `composeReadOnlyWorldViewModel` takes `spriteKeys` as a PARAMETER, and drops any character
 * missing from it (FR-N004 AC#6). The live page passes the production
 * `mistwoodCharacterSpriteKeys`, which is pinned against the real visual bindings — so the three
 * ways to drive the page above twelve were all bad: invent twenty-eight bindings (a world that
 * does not exist, which ART-107 §8 forbids), give the live page an overridable sprite map (a
 * benchmark seam in the shipped renderer), or drive the renderer directly. This is the third.
 *
 * The cost is stated rather than hidden: what gets measured is **the renderer at N sprites**, not
 * the live page at N characters. The page shell, its queries and its camera are not in the
 * figure. That is the right trade for AC#4 and the wrong one for AC#1, which is why the probe
 * publishes no time-to-interactive.
 *
 * ## Sprite keys are reused on purpose
 *
 * The forty probe characters map round-robin onto the twelve REAL sprite keys, so the renderer
 * draws from the same sheets with the same texture cache the live page uses. Minting synthetic
 * sheets would have measured a cache miss rate no viewer will ever see, and adding sheets to
 * `MISTWOOD_CHARACTER_VISUALS` is the thing this design exists to avoid.
 */

import type { PublicCharacterMotion } from '../../convex/publicRead/publicDynamicProjection';

/** The counts NFR2-002 AC#6 names, minus the one the real roster already covers. */
export const PROBE_CHARACTER_COUNTS = [20, 40] as const;

/** Hard ceiling, so a mistyped query string cannot ask for ten thousand sprites. */
export const MAX_PROBE_CHARACTERS = 64;

/** The query parameter the benchmark drives this with. */
export const PROBE_COUNT_PARAM = 'characters';

/**
 * The global the probe publishes its own census on.
 *
 * Namespaced by task number, like `__ART136_SCENARIO__`, so a reader can find what put it there.
 * `drawn` is read back from the composed view model — i.e. AFTER `composeReadOnlyWorldViewModel`
 * has dropped anything unbound — so a probe whose sprite map was wrong reports fewer than it was
 * asked for instead of reporting a flattering frame rate against a load that was never applied.
 */
export const PROBE_CENSUS_GLOBAL = '__ART173_PROBE__';

export type ProbeCensus = { requested: number; drawn: number };

/**
 * How many characters the probe was asked for, from a URL.
 *
 * Total by construction: anything unparseable, out of range or absent yields the roster's own
 * twelve, which measures what the ordinary benchmark already measures. A probe that threw
 * mid-run, or silently drew one sprite, would both be worse than measuring the normal case.
 */
export function probeCharacterCount(search: string): number {
  const raw = new URLSearchParams(search).get(PROBE_COUNT_PARAM);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 12;
  return Math.min(parsed, MAX_PROBE_CHARACTERS);
}

/**
 * `characterId -> spriteKey` for `count` probe characters, cycling the real keys.
 *
 * The caller supplies the real keys rather than this module importing them, so the one place that
 * knows which sheets exist stays `data/mistwoodCharacters.ts`.
 */
export function probeSpriteKeys(
  count: number,
  realSpriteKeys: Readonly<Record<string, string>>,
): Record<string, string> {
  const keys = Object.values(realSpriteKeys);
  if (keys.length === 0) throw new Error('probe needs at least one real sprite key');
  const map: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    map[probeCharacterId(index)] = keys[index % keys.length];
  }
  return map;
}

export function probeCharacterId(index: number): string {
  return `probe-${String(index).padStart(2, '0')}`;
}

/**
 * `count` characters mid-walk, spread over the map.
 *
 * **Walking, not idle.** The threshold is about sustained animation: an idle sprite is one
 * texture and a static transform, and forty of those would report a frame rate the renderer never
 * has to produce. Every probe character is given a walk whose `arriveAt` is far enough ahead that
 * it is still interpolating for the whole sample window, so the per-frame work is the per-frame
 * work AC#4 is about.
 *
 * Spread across the map on a grid rather than stacked: forty sprites at one point would let the
 * renderer cull or overdraw its way to a figure that does not generalise.
 */
export function probeMotions(input: {
  count: number;
  mapWidth: number;
  mapHeight: number;
  nowMs: number;
  /** How long each walk lasts. Longer than any sample window, so nothing arrives mid-measure. */
  walkMs?: number;
}): PublicCharacterMotion[] {
  const { count, mapWidth, mapHeight, nowMs } = input;
  const walkMs = input.walkMs ?? 10 * 60_000;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));

  return Array.from({ length: count }, (_unused, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    // Cell centres, so nothing sits on the map edge where the renderer clamps.
    const x = ((column + 0.5) / columns) * mapWidth;
    const y = ((row + 0.5) / rows) * mapHeight;
    // Alternating direction, so the four walk cycles in each sheet are all exercised rather than
    // one of them being the only animation the figure ever covers.
    const horizontal = index % 2 === 0;
    return {
      characterId: probeCharacterId(index),
      semanticLocationId: 'probe-zone',
      motionType: 'canon' as const,
      motionSequence: index + 1,
      from: { x, y },
      to: {
        x: horizontal ? clamp(x + mapWidth / (columns * 2), 0, mapWidth) : x,
        y: horizontal ? y : clamp(y + mapHeight / (rows * 2), 0, mapHeight),
      },
      startedAt: nowMs,
      arriveAt: nowMs + walkMs,
      animationState: 'walking' as const,
      direction: horizontal ? ('right' as const) : ('down' as const),
    };
  });
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
