import { useQuery } from 'convex/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { mistwoodCharacterSpriteKeys } from '../../../data/mistwoodCharacters';
import { mistwoodAmbientAnchorsByLocationId } from '../../../data/mistwoodAmbientAnchors';
import { mistwoodLocationFootprints, mistwoodWorldMap } from '../../../data/mistwood';
import { focusTargetsFrom, primaryLocationId, primarySceneLocationId } from '../world/cameraModel';
import type { SceneFocusInput } from '../world/cameraModel';
import { getPublishedReadModelRef } from '../public/publicReadModelRef';
import { getPublicRuntimeSnapshotRef } from '../public/publicRuntimeSnapshotRef';
import type { CharacterProjection, CharacterRecentEvent } from '../public/characterRoute';
import { resolveDegradationLevel } from './degradationLadder';
import { composeStaticMap } from './staticMapModel';
import { composeActiveScenePanel, type ActiveSceneInput } from './activeSceneModel';
import { composeCharacterCardViewModel } from './characterCardModel';
import {
  composeStoryOverlayViewModel,
  type StoryOverlayArcInput,
  type StoryOverlaySummaryInput,
} from './storyOverlayModel';
import { detectRenderQualityTierFromNavigator, updateIntervalMs } from '../world/renderQuality';
import { detectWebGLSupport } from '../world/webglSupport';
import { composeReadOnlyWorldViewModel, latestMotionPerCharacter } from '../world/worldViewModel';
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
import { liveViewSessionStorage, rememberCamera, resolveLiveEntry } from './liveViewSession';
import { hasAutoPlayed, markAutoPlayed, replaySessionStorage } from './replaySession';
import { composeTimeStateBadges } from './timeStateLabel';
import { useMotionClock } from './useMotionClock';
import { useReducedMotion } from './useReducedMotion';

const NO_MOTIONS: readonly PublicCharacterMotion[] = [];
const NO_SCENES: readonly ActiveSceneInput[] = [];

/** The `timeline:<worldId>` read model, as the character card reads it (ART-124 / FR-O006). */
type TimelinePayload = {
  entries: Array<{
    eventId: string; worldDay: number; timeSlot: string;
    publicSummary: string | null; characterIds: string[]; episodeNumber: number | null;
  }>;
};

/** The `live:<worldId>` projection, as the story overlay reads it (ART-125 / FR-O007). */
type LiveStatePayload = { activeArcs: StoryOverlayArcInput[] };

/**
 * The live map route's data layer (ART-118 / FR-O001, animated by ART-119 / FR-O002,
 * replayed by ART-121 / FR-O013).
 *
 * Public queries, read-only, and nothing else -- no mutation, no action, no client
 * construction. Panning, zooming, focusing, skipping a replay and asking for another all
 * happen entirely inside React state and issue no request at all, which is the runtime half
 * of AC#4; the structural half is `liveMapSurface.test.ts` plus the `clientLive` module
 * boundary.
 *
 * Four of the six fire on mount. The other two -- the character projection and the world
 * timeline behind the character card (FR-O006 / ART-124) -- are `'skip'`ped until a viewer
 * opens a card, and all four of the non-projection reads are the same failure-isolated
 * `getPublishedReadModel` the public pages already read through.
 *
 * The two that ART-125 (FR-O007) added -- the onboarding summary and the Live projection behind
 * the story overlay -- are deliberately NOT skip-gated: PRD 2.0 UX2-004 asks for narrative
 * context to be permanently available beside the map, so the overlay is always present and only
 * visually collapsible. Both are precomputed on Canon commit and served from the read-model
 * cache, so mounting them can never cause a summary to be generated (FR-O007 AC#6).
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
 * takes no network action -- so animating at 60Hz still issues exactly the queries this page
 * issues on mount and no more. It is also what advances replay playback: there is no second
 * timer.
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
  /**
   * Where an editorial page sent this viewer, and where they left the camera last time
   * (FR-P002 / ART-130 AC#5). Both are resolved ONCE, in a `useState` initialiser, because both
   * are answers to "how should this page open" — recomputing them per render would drag the
   * camera back every time the projection updated.
   *
   * The URL wins over the memory, and deliberately: a viewer who just followed a link asking for
   * a particular character is asking for that character NOW, and honouring a remembered camera
   * instead would ignore the thing they clicked.
   */
  const [cameraSessionStorage] = useState(liveViewSessionStorage);
  const [entry] = useState(() =>
    resolveLiveEntry({
      // SSR-safe, as every other route read on these pages is.
      search: typeof window === 'undefined' ? '' : window.location.search,
      worldId,
      storage: liveViewSessionStorage(),
    }),
  );

  // Which character's card is open (FR-O006 / ART-124). It is state on the DATA layer rather
  // than on the view, because it parameterises a read: the card's identity fields come from the
  // published `character:<id>` projection, and every read this feature makes has to be here.
  //
  // Seeded from the link (ART-130 AC#2): an Episode that says "see 何俊 on the map" opens the map
  // AND the card, so the viewer lands on the answer rather than on a page they must then search.
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    entry.openCharacterId,
  );

  const projection = useQuery(getPublicDynamicProjectionRef, { worldId });
  const replayResponse = useQuery(getPublicVisualReplayRef, { worldId });
  // Both card reads are skipped until a card is actually opened, so watching the map costs the
  // same two queries it always did. They are the same failure-isolated public read the character
  // page uses -- no new backend surface, and no generation on read.
  const characterResult = useQuery(
    getPublishedReadModelRef,
    selectedCharacterId === null
      ? 'skip'
      : { worldId, modelKind: 'character', modelRef: `character:${selectedCharacterId}` },
  );
  const timelineResult = useQuery(
    getPublishedReadModelRef,
    selectedCharacterId === null
      ? 'skip'
      : { worldId, modelKind: 'timeline', modelRef: `timeline:${worldId}` },
  );
  // The story overlay's two reads (FR-O007 / ART-125), on mount rather than skip-gated: the
  // overlay is always present. Both are cached published models rebuilt on Canon commit -- the
  // same two the homepage reads -- so neither can trigger generation on a public view (AC#6).
  const onboardingResult = useQuery(getPublishedReadModelRef, {
    worldId,
    modelKind: 'world',
    modelRef: `onboarding:${worldId}`,
  });
  const liveStateResult = useQuery(getPublishedReadModelRef, {
    worldId,
    modelKind: 'liveState',
    modelRef: `live:${worldId}`,
  });
  /**
   * The last valid runtime snapshot (FR-O010 / ART-127, ladder rung 2).
   *
   * ART-116 has published this since it was written, and until now the live map — the one
   * surface whose entire job is showing the world state — never read it. Its only reader was
   * the homepage, and only for the freshness chip. Reading it here is what makes rung 2 exist
   * at all: `getPublicDynamicProjection` returns `null` when even the read model store's
   * last-known-good is gone, and this table is an INDEPENDENT store that may still have
   * content from before whatever broke.
   *
   * Not skip-gated, because a snapshot that is only fetched once the projection has already
   * failed arrives one round trip after the viewer needed it — and the whole ladder is about
   * what is on screen at that moment. It is an anonymous cached read on the public allowlist
   * (`publicReadOnlyGuarantee.test.ts` has enumerated it since ART-131), so a third standing
   * subscription costs a row read and can trigger no generation.
   */
  const runtimeSnapshot = useQuery(getPublicRuntimeSnapshotRef, { worldId });
  // Probed once per mount: each of these creates a canvas or reads `navigator`, and doing
  // that per render would be a per-frame cost for an answer that cannot change while the
  // page is open.
  const [webglSupported] = useState(detectWebGLSupport);
  const [qualityTier] = useState(detectRenderQualityTierFromNavigator);
  // Hoisted here from `LiveMapView` (which still reads it for the camera) because ART-120
  // needs it *before* the view model is composed: Reduced Motion is what turns in-zone drift
  // off, and turning it off has to mean "never derived", not "derived and then hidden".
  const reducedMotion = useReducedMotion();

  /**
   * The degradation ladder (FR-O010 / ART-127).
   *
   * `rendererFailed` is the ONLY latched piece of this feature, and it latches the renderer
   * rather than the level: every rung below it is re-derived from the data on every render,
   * so recovery (AC#5) needs no mechanism — when the projection comes back, the next render
   * is already `stream` again. The latch clears when the map identity changes, and on nothing
   * else; a timer here would be the retry loop AC#4 forbids.
   */
  const [rendererFailed, setRendererFailed] = useState(false);
  const mapId = projection?.mapId ?? runtimeSnapshot?.mapId ?? null;
  useEffect(() => {
    setRendererFailed(false);
  }, [mapId]);

  const streamMotions: readonly PublicCharacterMotion[] = projection?.characters ?? NO_MOTIONS;
  const snapshotMotions: readonly PublicCharacterMotion[] =
    runtimeSnapshot?.characterStates ?? NO_MOTIONS;

  const degradation = resolveDegradationLevel({
    // `undefined` is the read in flight. Kept apart from `null` (resolved, nothing published)
    // for the reason the card and overlay already draw the same distinction: collapsing them
    // makes the first paint flash the bottom rung before the data lands.
    loading: projection === undefined,
    streamContent: streamMotions.length > 0,
    snapshotContent: snapshotMotions.length > 0,
    webglSupported,
    rendererFailed,
    // Mistwood is the only authored floor plan today, exactly as `visualRuntimeForWorld`
    // records on the server side. A world with no footprints has no static rung and drops
    // straight to the informational one rather than drawing an empty rectangle.
    mapAvailable: mistwoodLocationFootprints.length > 0,
  });

  // One source of positions per rung, chosen once. Everything downstream — the view model,
  // the camera, the scene panel, the character card — reads this, so no two parts of the page
  // can end up describing different rungs.
  const liveMotions = degradation.source === 'snapshot' ? snapshotMotions : streamMotions;
  const scenes: readonly ActiveSceneInput[] = (degradation.source === 'snapshot'
    ? runtimeSnapshot?.activeSceneStates
    : projection?.activeScenes) ?? NO_SCENES;
  /**
   * The visual replay is withdrawn on the rungs that draw no animation (FR-O010 / ART-127).
   *
   * FR-O013's replay is a VISUAL replay: it re-enacts a scene by moving characters. A static
   * floor plan cannot move, so "replaying" on it would mean the plan silently jumping between
   * historical positions — a picture that changes for no visible reason and claims to be
   * "last known positions" while showing positions from hours ago.
   *
   * Withdrawn by nulling the replay itself rather than by branching in four places: with no
   * replay, the auto-play effect returns early, `advanceReplay` has nothing to advance,
   * `replayFrame` is null and the controls report nothing available. It also needs no undoing —
   * when the renderer recovers the replay simply reappears, which is the same
   * derive-don't-latch property the rest of the ladder has.
   *
   * The browser suite caught this: the plan was drawing the replay's motions, so it showed the
   * ONE character in the current replay scene instead of all twelve.
   */
  const rendererDrawing = degradation.level === 'stream' || degradation.level === 'snapshot';
  const replay = rendererDrawing ? replayResponse?.replay ?? null : null;

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
  /**
   * The floor plan for rung 3 (FR-O010 AC#1).
   *
   * Projected from the SAME view model the Pixi stage consumes and the SAME focus targets the
   * camera controls are built from, so the static plan is structurally incapable of naming a
   * different person or a different place than the animated map does. Composed only when the
   * rung is actually reached: it is the one thing here that costs work nobody on rung 1 needs.
   */
  const staticMap = useMemo(
    () =>
      degradation.level === 'static-map'
        ? composeStaticMap({
            viewModel,
            footprints: mistwoodLocationFootprints,
            targets: camera.targets,
            tileSize: mistwoodWorldMap.tileDim,
          })
        : null,
    [degradation.level, viewModel, camera.targets],
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

  // The open card (FR-O006 / ART-124). Nothing here is a new read: identity comes from the
  // `character:<id>` projection, location and activity from the motion the map is already
  // drawing, the active arc from `activeScenes`, and the recent events from the world timeline
  // filtered by `characterIds` -- the same filter `CharacterPage.tsx` applies.
  const characterCard = useMemo(() => {
    if (selectedCharacterId === null) return null;
    const timeline = (timelineResult?.payload ?? null) as TimelinePayload | null;
    const recentEvents: CharacterRecentEvent[] | null = timeline
      ? timeline.entries
          .filter((entry) => entry.characterIds.includes(selectedCharacterId))
          .map((entry) => ({
            eventId: entry.eventId, worldDay: entry.worldDay, timeSlot: entry.timeSlot,
            publicSummary: entry.publicSummary, episodeNumber: entry.episodeNumber,
          }))
      : null;
    return composeCharacterCardViewModel({
      worldId,
      characterId: selectedCharacterId,
      // `undefined` (read in flight) and `null` (read completed, no model published) are kept
      // apart deliberately: collapsing them shows "loading…" forever for a character whose
      // projection has never been built. `CharacterPage.tsx` draws the same distinction.
      character: characterResult === undefined
        ? undefined
        : ((characterResult?.payload ?? null) as CharacterProjection | null),
      // Read off the same array the canvas renders, so a card opened during a replay describes
      // the frame on screen rather than a live position the viewer cannot see.
      motion: latestMotionPerCharacter(motions)
        .find((motion) => motion.characterId === selectedCharacterId) ?? null,
      scenes,
      recentEvents,
      spriteKeys: mistwoodCharacterSpriteKeys,
      footprints: mistwoodLocationFootprints,
    });
  }, [selectedCharacterId, characterResult, timelineResult, motions, scenes, worldId]);

  // The story overlay (FR-O007 / ART-125). Half of it needs no read at all: the day, the slot and
  // the scenes are the ones the canvas beside it is already drawing, so the overlay and the map
  // cannot disagree about the world state (AC#4). `undefined` and `null` are kept apart for both
  // published models, for the reason `composeCharacterCardViewModel` records.
  const storyOverlay = useMemo(
    () =>
      composeStoryOverlayViewModel({
        worldId,
        summary: onboardingResult === undefined
          ? undefined
          : ((onboardingResult?.payload ?? null) as StoryOverlaySummaryInput | null),
        activeArcs: liveStateResult === undefined
          ? undefined
          : (((liveStateResult?.payload ?? null) as LiveStatePayload | null)?.activeArcs ?? null),
        worldDay: projection?.worldDay,
        timeSlot: projection?.timeSlot,
        scenes,
      }),
    [worldId, onboardingResult, liveStateResult, projection?.worldDay, projection?.timeSlot, scenes],
  );

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
      storyOverlay={storyOverlay}
      timeSlot={projection?.timeSlot}
      timeStateBadges={timeStateBadges}
      replayAvailable={replay !== null}
      replayPlaying={replayActive}
      replayText={replayText}
      onSkipReplay={() => setPlayback(skipReplay)}
      onReplay={() => replay && setPlayback(beginReplay(replay, Date.now()))}
      characterCard={characterCard}
      onOpenCharacterCard={setSelectedCharacterId}
      onCloseCharacterCard={() => setSelectedCharacterId(null)}
      // FR-P002 / ART-130 AC#5. Seeded once from the link or the remembered camera; reported on
      // every change so the return leg lands where the viewer left off rather than at the town
      // view, which is what makes the navigation continuous in both directions.
      initialCameraMode={entry.mode}
      onCameraModeChange={(mode) =>
        rememberCamera(
          worldId,
          { focusId: mode.focusId, follow: mode.follow, zoomStep: mode.zoomStep },
          cameraSessionStorage,
        )
      }
      reducedMotion={reducedMotion}
      webglSupported={webglSupported}
      loading={projection === undefined}
      // FR-O010 / ART-127. The verdict, the plan for rung 3, and the two labels AC#3 requires
      // at every rung. `contentUpdatedAt` follows the rung's own source rather than always
      // reporting the projection's: on rung 2 the projection is what is missing, so quoting
      // its timestamp would date the screen by a thing that is not on it.
      degradation={degradation}
      staticMap={staticMap}
      freshness={runtimeSnapshot?.freshness ?? null}
      contentUpdatedAt={
        degradation.source === 'snapshot'
          ? runtimeSnapshot?.contentUpdatedAt ?? null
          : projection?.updatedAt ?? null
      }
      nowMs={nowMs}
      onRendererFailure={() => setRendererFailed(true)}
      rendererResetKey={mapId ?? undefined}
    />
  );
}
