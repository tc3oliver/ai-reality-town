import { useQuery } from 'convex/react';
import { useMemo, useState } from 'react';

import { mistwoodCharacterSpriteKeys } from '../../../data/mistwoodCharacters';
import { mistwoodAmbientAnchorsByLocationId } from '../../../data/mistwoodAmbientAnchors';
import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import { focusTargetsFrom, primaryLocationId } from '../world/cameraModel';
import { detectRenderQualityTierFromNavigator, updateIntervalMs } from '../world/renderQuality';
import { detectWebGLSupport } from '../world/webglSupport';
import { composeReadOnlyWorldViewModel } from '../world/worldViewModel';
import type { PublicCharacterMotion } from '../world/worldViewModel';
import { LiveMapView } from './LiveMapView';
import { getPublicDynamicProjectionRef } from './publicDynamicRef';
import { useMotionClock } from './useMotionClock';
import { useReducedMotion } from './useReducedMotion';

const NO_MOTIONS: readonly PublicCharacterMotion[] = [];

/**
 * The live map route's data layer (ART-118 / FR-O001, animated by ART-119 / FR-O002).
 *
 * One public query, read-only, and nothing else -- no mutation, no action, no
 * client construction. Panning, zooming and focusing happen entirely inside
 * {@link ./LiveMapView}'s React state and issue no request at all, which is the
 * runtime half of AC#4; the structural half is `liveMapSurface.test.ts` plus the
 * `clientLive` module boundary.
 *
 * ART-119 added the second input the frame depends on: `nowMs`, from
 * {@link ./useMotionClock}. Before it, the interpolation was memoised on the
 * projection alone, so a character teleported to wherever the next projection
 * put it instead of walking there. The clock is purely local -- it reads
 * `Date.now()` and re-runs a pure function, and takes no network action -- so
 * animating at 60Hz still issues exactly the one query this page has always
 * issued.
 *
 * The sprite bindings arrive as a compile-time constant from `data/`, not from a
 * query. They are deterministic per deploy (FR-N004 AC#2), so a per-viewer round
 * trip would buy nothing; more importantly, the authored bindings in
 * `convex/visual/` transitively import the Canon seed's private character data,
 * which is why `clientLive` may not depend on `visual` and the shared roster
 * lives in `data/` instead.
 *
 * `useQuery` *throws* when the deployment returns an error, so the caller mounts
 * this page inside {@link ./LiveMapErrorBoundary} -- the boundary has to sit
 * above the read, not below it, or an unavailable backend blanks the page
 * instead of degrading it. Richer degradation (staleness banners, last-known-good
 * replay) is FR-O010 / ART-127; what this task owes is "never a blank page".
 */
export default function LiveMapPage({ worldId, base }: { worldId: string; base: string }) {
  const projection = useQuery(getPublicDynamicProjectionRef, { worldId });
  // Probed once per mount: each of these creates a canvas or reads `navigator`,
  // and doing that per render would be a per-frame cost for an answer that
  // cannot change while the page is open.
  const [webglSupported] = useState(detectWebGLSupport);
  const [qualityTier] = useState(detectRenderQualityTierFromNavigator);
  // Hoisted here from `LiveMapView` (which still reads it for the camera) because
  // ART-120 needs it *before* the view model is composed: Reduced Motion is what
  // turns in-zone drift off, and turning it off has to mean "never derived", not
  // "derived and then hidden".
  const reducedMotion = useReducedMotion();

  const motions: readonly PublicCharacterMotion[] = projection?.characters ?? NO_MOTIONS;
  // A world with nobody in it has nothing to interpolate, so the clock stays
  // parked rather than re-rendering an empty map on a timer.
  const nowMs = useMotionClock(updateIntervalMs(qualityTier), motions.length > 0);

  // Only the sprite poses are recomputed per tick. The camera targets stay on the
  // projection's cadence deliberately: a fresh `targets` array every tick would
  // make `LiveMapView`'s camera effect re-run and restart the viewport tween
  // thirty times a second, so the camera would judder while the characters
  // smoothed out. ART-120's ambient drift inherits that split for free, and that
  // is what keeps it invisible to the camera (RISK2-008).
  const viewModel = useMemo(
    () =>
      composeReadOnlyWorldViewModel({
        map: mistwoodWorldMap,
        motions,
        spriteKeys: mistwoodCharacterSpriteKeys,
        nowMs,
        ambientAnchorsByLocationId: mistwoodAmbientAnchorsByLocationId,
        worldDay: projection?.worldDay,
        reducedMotion,
      }),
    [motions, nowMs, projection?.worldDay, reducedMotion],
  );
  const camera = useMemo(
    () => ({
      targets: focusTargetsFrom({
        motions,
        footprints: mistwoodLocationFootprints,
        map: mistwoodWorldMap,
        nowMs: Date.now(),
      }),
      primaryLocationId: primaryLocationId(motions),
    }),
    [motions],
  );

  return (
    <LiveMapView
      worldId={worldId}
      base={base}
      viewModel={viewModel}
      targets={camera.targets}
      primaryLocationId={camera.primaryLocationId}
      timeSlot={projection?.timeSlot}
      reducedMotion={reducedMotion}
      webglSupported={webglSupported}
      loading={projection === undefined}
    />
  );
}
