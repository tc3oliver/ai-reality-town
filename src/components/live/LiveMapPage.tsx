import { useQuery } from 'convex/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { mistwoodCharacterSpriteKeys } from '../../../data/mistwoodCharacters';
import { mistwoodAmbientAnchorsByLocationId } from '../../../data/mistwoodAmbientAnchors';
import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import { focusTargetsFrom, primaryLocationId, primarySceneLocationId } from '../world/cameraModel';
import type { SceneFocusInput } from '../world/cameraModel';
import { composeActiveScenePanel, type ActiveSceneInput } from './activeSceneModel';
import { detectRenderQualityTierFromNavigator, updateIntervalMs } from '../world/renderQuality';
import { detectWebGLSupport } from '../world/webglSupport';
import { composeReadOnlyWorldViewModel } from '../world/worldViewModel';
import type { PublicCharacterMotion } from '../world/worldViewModel';
import { LiveMapView } from './LiveMapView';
import { getPublicDynamicProjectionRef } from './publicDynamicRef';
import { getPublicVisualReplayRef } from './publicVisualReplayRef';
import {
  IDLE_REPLAY_PLAYBACK,
  advanceReplay,
  beginReplay,
  replayFrame,
  skipReplay,
} from './replayPlayback';
import { hasAutoPlayed, markAutoPlayed, replaySessionStorage } from './replaySession';
import { composeTimeStateBadges } from './timeStateLabel';
import { useMotionClock } from './useMotionClock';
import { useReducedMotion } from './useReducedMotion';

const NO_MOTIONS: readonly PublicCharacterMotion[] = [];
const NO_SCENES: readonly ActiveSceneInput[] = [];

/**
 * The live map route's data layer (ART-118 / FR-O001, animated by ART-119 / FR-O002,
 * replayed by ART-121 / FR-O013).
 *
 * Two public queries, read-only, and nothing else -- no mutation, no action, no client
 * construction. Panning, zooming, focusing, skipping a replay and asking for another all
 * happen entirely inside React state and issue no request at all, which is the runtime half
 * of AC#4; the structural half is `liveMapSurface.test.ts` plus the `clientLive` module
 * boundary.
 *
 * The second query is the replay (FR-O013). It is a *separate* read rather than a field on
 * the projection because the two change on entirely different cadences and are allowed to
 * fail independently: a replay that cannot be built must leave the live map exactly as it
 * was, and a projection rebuild must not invalidate a replay nothing about the world changed.
 *
 * ART-119 added the second input the frame depends on: `nowMs`, from
 * {@link ./useMotionClock}. Before it, the interpolation was memoised on the projection
 * alone, so a character teleported to wherever the next projection put it instead of walking
 * there. The clock is purely local -- it reads `Date.now()` and re-runs a pure function, and
 * takes no network action -- so animating at 60Hz still issues exactly the two queries this
 * page issues on mount. It is also what advances replay playback: there is no second timer.
 *
 * The sprite bindings arrive as a compile-time constant from `data/`, not from a query. They
 * are deterministic per deploy (FR-N004 AC#2), so a per-viewer round trip would buy nothing;
 * more importantly, the authored bindings in `convex/visual/` transitively import the Canon
 * seed's private character data, which is why `clientLive` may not depend on `visual` and the
 * shared roster lives in `data/` instead.
 *
 * `useQuery` *throws* when the deployment returns an error, so the caller mounts this page
 * inside {@link ./LiveMapErrorBoundary} -- the boundary has to sit above the read, not below
 * it, or an unavailable backend blanks the page instead of degrading it.
 */
export default function LiveMapPage({ worldId, base }: { worldId: string; base: string }) {
  const projection = useQuery(getPublicDynamicProjectionRef, { worldId });
  const replayResponse = useQuery(getPublicVisualReplayRef, { worldId });
  // Probed once per mount: each of these creates a canvas or reads `navigator`, and doing
  // that per render would be a per-frame cost for an answer that cannot change while the
  // page is open.
  const [webglSupported] = useState(detectWebGLSupport);
  const [qualityTier] = useState(detectRenderQualityTierFromNavigator);
  // Hoisted here from `LiveMapView` (which still reads it for the camera) because ART-120
  // needs it *before* the view model is composed: Reduced Motion is what turns in-zone drift
  // off, and turning it off has to mean "never derived", not "derived and then hidden".
  const reducedMotion = useReducedMotion();

  const liveMotions: readonly PublicCharacterMotion[] = projection?.characters ?? NO_MOTIONS;
  const scenes: readonly ActiveSceneInput[] = projection?.activeScenes ?? NO_SCENES;
  const replay = replayResponse?.replay ?? null;

  const [playback, setPlayback] = useState(IDLE_REPLAY_PLAYBACK);
  // The tab's storage, read once. `hasAutoPlayed` fails closed, so a null here means the
  // auto-play never fires and the manual button is the only way in -- which is correct for a
  // browser that cannot remember whether it already played.
  const [autoPlayStorage] = useState(replaySessionStorage);
  // A second guard beside the storage mark, for the window between deciding to auto-play and
  // React committing the state: without it, two renders in the same tick could both see an
  // unmarked replay. Per mount rather than per session, because the storage mark is what
  // carries across mounts.
  const autoPlayedThisMount = useRef<string | null>(null);

  // A world with nobody in it has nothing to interpolate, so the clock stays parked rather
  // than re-rendering an empty map on a timer. A replay in flight is the second reason to
  // tick: it is what advances playback.
  const replayActive = playback.phase === 'playing';
  const nowMs = useMotionClock(updateIntervalMs(qualityTier), liveMotions.length > 0 || replayActive);

  // AC#5 / AC#7. Fires at most once per replay per viewing session, and Reduced Motion
  // suppresses it entirely (FR-O011 AC#8's convention: motion a viewer did not ask for is the
  // thing that preference is about). The manual control in `ReplayControls` stays available
  // regardless, so nothing is unreachable -- it just stops being automatic.
  useEffect(() => {
    if (!replay || reducedMotion) return;
    if (autoPlayedThisMount.current === replay.replayId) return;
    if (hasAutoPlayed(replay.replayId, autoPlayStorage)) return;
    autoPlayedThisMount.current = replay.replayId;
    markAutoPlayed(replay.replayId, autoPlayStorage);
    setPlayback(beginReplay(replay, Date.now()));
  }, [replay, reducedMotion, autoPlayStorage]);

  // The end of playback, derived from the clock rather than scheduled. `advanceReplay`
  // returns the same object when nothing changed, so React bails out on every frame but the
  // one that actually ends the replay -- no new timer, and no re-render per tick.
  useEffect(() => {
    setPlayback((previous) => advanceReplay(replay, previous, nowMs));
  }, [replay, nowMs]);

  const frame = useMemo(() => replayFrame(replay, playback, nowMs), [replay, playback, nowMs]);

  // The one substitution that makes replay work: the synthesised motions take the place of
  // the live ones, and when the frame becomes null they stop -- so the return to the ambient
  // live state (AC#2) needs no teardown at all. Everything downstream of here is the same
  // code path a live frame takes.
  const motions = frame ? frame.motions : liveMotions;

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
  // Memoised on the projection's own cadence, never on `nowMs`: a fresh `targets` array per
  // animation tick would restart the viewport tween thirty times a second and make the
  // camera judder. Adding scenes here does not change that -- `activeScenes` moves when
  // Canon commits, which is exactly when the camera should reconsider where to look.
  const camera = useMemo(
    () => ({
      targets: focusTargetsFrom({
        motions: liveMotions,
        footprints: mistwoodLocationFootprints,
        map: mistwoodWorldMap,
        nowMs: Date.now(),
        scenes: scenes as readonly SceneFocusInput[],
      }),
      // The published scene is the real answer to "what is the world's attention on";
      // character density is the documented fallback for worlds and payloads that carry no
      // placeable scene (see `primaryLocationId`).
      primaryLocationId: primarySceneLocationId(scenes as readonly SceneFocusInput[])
        ?? primaryLocationId(liveMotions),
    }),
    [liveMotions, scenes],
  );
  const scenePanel = useMemo(
    () => composeActiveScenePanel({ scenes, footprints: mistwoodLocationFootprints, worldId }),
    [scenes, worldId],
  );
  const timeStateBadges = useMemo(
    () =>
      composeTimeStateBadges({
        replay: frame
          ? {
              worldDay: frame.worldDay,
              timeSlot: frame.timeSlot,
              sceneIndex: frame.sceneIndex,
              sceneCount: replay?.scenes.length ?? 0,
            }
          : null,
        worldDay: projection?.worldDay,
        timeSlot: projection?.timeSlot,
      }),
    [frame, replay?.scenes.length, projection?.worldDay, projection?.timeSlot],
  );

  // Resolved at read time by the server and looked up by address here. An address the server
  // could not resolve is simply absent from `texts`, and the card falls back to naming the
  // scene rather than showing a sentence that may since have been withheld (AC#10).
  const replayText = useMemo(() => {
    const reference = frame?.summaryRef;
    if (!reference) return null;
    const match = replayResponse?.texts.find(
      (entry) =>
        entry.publicSummaryId === reference.publicSummaryId
        && entry.publicationVersion === reference.publicationVersion,
    );
    return match?.text ?? null;
  }, [frame, replayResponse]);

  return (
    <LiveMapView
      worldId={worldId}
      base={base}
      viewModel={viewModel}
      targets={camera.targets}
      // Playback owns the camera while it runs: a replay whose scene the viewer cannot see
      // is not a replay. It reverts to the live answer the moment the frame goes away.
      primaryLocationId={frame ? frame.locationId : camera.primaryLocationId}
      scenePanel={scenePanel}
      timeSlot={projection?.timeSlot}
      timeStateBadges={timeStateBadges}
      replayAvailable={replay !== null}
      replayPlaying={replayActive}
      replayText={replayText}
      onSkipReplay={() => setPlayback(skipReplay)}
      onReplay={() => replay && setPlayback(beginReplay(replay, Date.now()))}
      reducedMotion={reducedMotion}
      webglSupported={webglSupported}
      loading={projection === undefined}
    />
  );
}
