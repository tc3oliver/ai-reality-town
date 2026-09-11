/**
 * The sprite load probe's entry point (ART-173). **Benchmark only.**
 *
 * Mounted from `bench.html`, which `vite.config.ts` adds as an input ONLY when
 * `VITE_E2E_FIXTURE === '1'`. `npm run build` never sets that, so no shipped bundle contains this
 * module, this page, or anything they reach that the product does not already reach.
 *
 * It renders `ReadOnlyWorld` — the same renderer the live map draws with, the same sprite sheets,
 * the same motion clock — around a synthetic cast built by `spriteLoadWorld.ts`. Nothing else: no
 * Convex client, no page shell, no queries, no camera controller. That is deliberate and it is the
 * measurement's boundary. What this produces is「the renderer sustained N animated sprites」and
 * nothing about the live page's time-to-interactive, which is why the benchmark records no TTI
 * from it.
 *
 * See `spriteLoadWorld.ts` for why the live page could not be driven above twelve without either
 * inventing a world or putting a benchmark seam in the shipped renderer.
 */

import React, { useMemo } from 'react';
import ReactDOM from 'react-dom/client';

import { mistwoodWorldMap } from '../../data/mistwood';
import { mistwoodCharacterSpriteKeys } from '../../data/mistwoodCharacters';
import { useMotionClock } from '../components/live/useMotionClock';
import { useSpriteAssets } from '../components/live/useSpriteAssets';
import { ReadOnlyWorld } from '../components/world/ReadOnlyWorld';
import { composeReadOnlyWorldViewModel } from '../components/world/worldViewModel';
import {
  PROBE_CENSUS_GLOBAL,
  probeCharacterCount,
  probeMotions,
  probeSpriteKeys,
  type ProbeCensus,
} from './spriteLoadWorld';

/** Matches the live map's clock, so the per-frame work is the per-frame work the product does. */
const MOTION_CLOCK_INTERVAL_MS = 100;

function SpriteLoadProbe() {
  const requested = probeCharacterCount(window.location.search);
  const spriteAssets = useSpriteAssets();
  const nowMs = useMotionClock(MOTION_CLOCK_INTERVAL_MS);
  // The walks are minted once, at mount. Regenerating them on every clock tick would measure this
  // component's allocation rate rather than the renderer's throughput.
  const started = useMemo(() => Date.now(), []);

  const viewModel = useMemo(() => composeReadOnlyWorldViewModel({
    map: mistwoodWorldMap,
    motions: probeMotions({
      count: requested,
      mapWidth: mistwoodWorldMap.width,
      mapHeight: mistwoodWorldMap.height,
      nowMs: started,
    }),
    spriteKeys: probeSpriteKeys(requested, mistwoodCharacterSpriteKeys),
    nowMs,
  }), [requested, started, nowMs]);

  /**
   * The census, published from the COMPOSED model rather than from the request.
   *
   * `composeReadOnlyWorldViewModel` drops anything unbound, so if the synthetic sprite map were
   * wrong this reports fewer than were asked for. The benchmark asserts the two are equal, which
   * is what stops a probe that quietly drew twelve sprites from publishing a flattering frame rate
   * against a load that was never applied.
   */
  const census: ProbeCensus = { requested, drawn: viewModel.characters.length };
  (window as unknown as Record<string, unknown>)[PROBE_CENSUS_GLOBAL] = census;

  return (
    <main data-probe-drawn={census.drawn} data-probe-requested={census.requested}>
      <ReadOnlyWorld
        viewModel={viewModel}
        spriteAssets={spriteAssets}
        screenWidth={window.innerWidth}
        screenHeight={window.innerHeight}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  // No `StrictMode`: its double render is a correctness aid and a measurement contaminant, and
  // this file exists only to measure.
  <SpriteLoadProbe />,
);
