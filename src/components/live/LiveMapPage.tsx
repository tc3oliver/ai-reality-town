import { useQuery } from 'convex/react';
import { useMemo, useState } from 'react';

import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import { focusTargetsFrom, primaryLocationId } from '../world/cameraModel';
import { detectWebGLSupport } from '../world/webglSupport';
import { composeReadOnlyWorldViewModel } from '../world/worldViewModel';
import type { PublicCharacterMotion } from '../world/worldViewModel';
import { LiveMapView } from './LiveMapView';
import { getPublicDynamicProjectionRef } from './publicDynamicRef';

const NO_MOTIONS: readonly PublicCharacterMotion[] = [];

/**
 * The live map route's data layer (ART-118 / FR-O001).
 *
 * One public query, read-only, and nothing else -- no mutation, no action, no
 * client construction. Panning, zooming and focusing happen entirely inside
 * {@link ./LiveMapView}'s React state and issue no request at all, which is the
 * runtime half of AC#4; the structural half is `liveMapSurface.test.ts` plus the
 * `clientLive` module boundary.
 *
 * The frame is memoised on the projection rather than recomputed per render, so
 * the interpolation clock advances only when new world state arrives. Animating
 * between projections is FR-O002 (ART-119), not this task.
 *
 * `useQuery` *throws* when the deployment returns an error, so the caller mounts
 * this page inside {@link ./LiveMapErrorBoundary} -- the boundary has to sit
 * above the read, not below it, or an unavailable backend blanks the page
 * instead of degrading it. Richer degradation (staleness banners, last-known-good
 * replay) is FR-O010 / ART-127; what this task owes is "never a blank page".
 */
export default function LiveMapPage({ worldId, base }: { worldId: string; base: string }) {
  const projection = useQuery(getPublicDynamicProjectionRef, { worldId });
  // Probed once per mount: `detectWebGLSupport` creates a canvas, and doing that
  // on every render would be a per-frame allocation for an answer that cannot change.
  const [webglSupported] = useState(detectWebGLSupport);

  const motions: readonly PublicCharacterMotion[] = projection?.characters ?? NO_MOTIONS;
  const frame = useMemo(() => {
    const nowMs = Date.now();
    return {
      viewModel: composeReadOnlyWorldViewModel({
        map: mistwoodWorldMap,
        motions,
        // FR-O002 (ART-119) resolves `characterId -> spriteKey`; no public query
        // publishes it yet, so no sprite is drawn rather than a guessed one.
        spriteKeys: {},
        nowMs,
      }),
      targets: focusTargetsFrom({
        motions,
        footprints: mistwoodLocationFootprints,
        map: mistwoodWorldMap,
        nowMs,
      }),
      primaryLocationId: primaryLocationId(motions),
    };
  }, [motions]);

  return (
    <LiveMapView
      worldId={worldId}
      base={base}
      viewModel={frame.viewModel}
      targets={frame.targets}
      primaryLocationId={frame.primaryLocationId}
      webglSupported={webglSupported}
      loading={projection === undefined}
    />
  );
}
