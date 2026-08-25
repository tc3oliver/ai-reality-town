import { useEffect, useRef, useState } from 'react';
import type { Viewport } from 'pixi-viewport';

import { emitDynamicViewEvent } from '../../analytics/analyticsSink';
import { emitCameraEvents } from '../../analytics/cameraEvents';
import { mistwoodCollision, mistwoodLocationFootprints } from '../../../data/mistwood';
import { PublicPageFrame } from '../public/PublicPageFrame';
import { ReadOnlyWorld } from '../world/ReadOnlyWorld';
import {
  INITIAL_CAMERA_MODE,
  nextCamera,
  type CameraMode,
  type CameraView,
  type FocusTarget,
} from '../world/cameraModel';
import type { ReadOnlyWorldViewModel } from '../world/worldViewModel';
import { ActiveScenePanel } from './ActiveScenePanel';
import type { ActiveScenePanelModel } from './activeSceneModel';
import { CameraControls } from './CameraControls';
import { CharacterCard } from './CharacterCard';
import type { CharacterCardViewModel } from './characterCardModel';
import { DegradationNotice } from './DegradationNotice';
import type { DegradationVerdict } from './degradationLadder';
import { LiveMapFallback } from './LiveMapFallback';
import { textLiveHref } from './liveMapRoute';
import { RendererErrorBoundary } from './RendererErrorBoundary';
import { ReplayControls } from './ReplayControls';
import { StaticMapView } from './StaticMapView';
import type { StaticMapModel } from './staticMapModel';
import { StoryOverlay } from './StoryOverlay';
import type { StoryOverlayViewModel } from './storyOverlayModel';
import { TimeStateBanner } from './TimeStateBanner';
import type { TimeStateBadge } from './timeStateLabel';
import { useCompactViewport } from './useCompactViewport';
import { useElementSize } from './useElementSize';
import { useReducedMotion } from './useReducedMotion';
import { useSpriteAssets } from './useSpriteAssets';

const EMPTY_SCENE_PANEL: ActiveScenePanelModel = { hasScenes: false, scenes: [] };
const NO_TIME_STATE_BADGES: readonly TimeStateBadge[] = [];

export interface LiveMapViewProps {
  worldId: string;
  base: string;
  viewModel: ReadOnlyWorldViewModel;
  targets: readonly FocusTarget[];
  /** Where auto-follow points: the published active scene's location (FR-O003 / ART-122). */
  primaryLocationId: string | null;
  /** Display data for the active scene panel. Omitted renders the panel's empty state. */
  scenePanel?: ActiveScenePanelModel;
  /**
   * The story overlay's content (FR-O007 / ART-125). Omitted renders no overlay at all rather
   * than an empty one, so a caller that has not adopted it is unchanged.
   */
  storyOverlay?: StoryOverlayViewModel;
  /** The Canon slot of the last accepted event, driving the day/night wash (FR-O012). */
  timeSlot?: string;
  /** The replay/earlier/now rows (FR-O014 / ART-121 AC#9). Empty renders no banner. */
  timeStateBadges?: readonly TimeStateBadge[];
  /** Whether the world has a replay to play at all. */
  replayAvailable?: boolean;
  replayPlaying?: boolean;
  /**
   * The event card's text for the step currently on screen, already resolved by the server.
   * `null` when the reference no longer resolves — a withheld or superseded publication —
   * in which case the card names the scene and says so rather than showing stale text.
   */
  replayText?: string | null;
  onSkipReplay?: () => void;
  onReplay?: () => void;
  /**
   * The open character card (FR-O006 / ART-124), or null when none is open.
   *
   * Composed by {@link ./LiveMapPage} rather than here, because the card's identity fields come
   * from a `character:<id>` read that only the page may issue -- which is also why the selection
   * itself lives up there, beside the query it parameterises, instead of as local state here.
   */
  characterCard?: CharacterCardViewModel | null;
  onOpenCharacterCard?: (characterId: string) => void;
  onCloseCharacterCard?: () => void;
  /**
   * Where the camera should start (FR-P002 / ART-130 AC#5): the `?focus=` an editorial page
   * linked with, or the camera this viewer left behind. Read ONCE, as the initial state — after
   * that the camera is the viewer's, and re-applying a prop on every render would fight them.
   *
   * Omitted keeps {@link INITIAL_CAMERA_MODE}, so every existing caller is unchanged.
   */
  initialCameraMode?: CameraMode;
  /**
   * Told whenever the viewer moves the camera, so {@link ./LiveMapPage} can remember it for the
   * return leg. A callback rather than lifting the state up: the camera is view state that never
   * leaves the browser, and moving it to the data layer would put a `useState` setter that fires
   * on every pan next to the queries.
   */
  onCameraModeChange?: (mode: CameraMode) => void;
  /**
   * The viewer's Reduced Motion preference, decided by the caller (ART-120).
   *
   * The page now needs it before this component renders — it gates whether in-zone drift is
   * derived at all — so it is passed in rather than read twice. Omitted falls back to reading
   * it here, which keeps every existing caller and test working unchanged.
   */
  reducedMotion?: boolean;
  /** Decided once by the caller, so the probe does not create a canvas per render. */
  webglSupported: boolean;
  loading: boolean;
  /**
   * Which rung of the degradation ladder to render (FR-O010 / ART-127).
   *
   * Decided by {@link ./LiveMapPage}, because two of its four inputs are reads only that layer
   * may issue. Omitted keeps the pre-ART-127 behaviour exactly — animated map, or the
   * standalone fallback page when WebGL is absent — so every existing caller and test is
   * unchanged and the ladder is opt-in at the seam rather than a rewrite of this component's
   * contract.
   */
  degradation?: DegradationVerdict;
  /** The floor plan for rung 3. Required in practice whenever `degradation` is passed. */
  staticMap?: StaticMapModel | null;
  /** The server's freshness verdict for the content on screen (AC#3). */
  freshness?: string | null;
  /** When that content was last updated (AC#3). */
  contentUpdatedAt?: number | null;
  /** Read once per render for the relative age; never a second clock. */
  nowMs?: number;
  /** Told when the Pixi stage throws, so the page can drop to the static plan. */
  onRendererFailure?: () => void;
  /**
   * Clears the renderer latch when it changes. The projection's `mapId`: switching to a
   * different map is worth one more attempt at the renderer, and it is the only signal here
   * that is not a clock — a time-based reset would be the retry loop AC#4 forbids.
   */
  rendererResetKey?: string;
}

/**
 * The live map page body (ART-118 / FR-O001, FR-O005).
 *
 * Holds the entire camera state of the feature -- the viewer's mode and the
 * frame it resolves to -- as React state that never leaves the browser. There
 * is no effect here that talks to the network: the only data this component
 * sees arrives as props from {@link ./LiveMapPage}, which is the one file in
 * this module allowed to read anything at all.
 *
 * The canvas is deliberately mute. Every affordance is a DOM button in
 * {@link ./CameraControls}, sitting beside the canvas rather than on it, so the
 * renderer keeps the "no handler anywhere in the tree" property ART-113 proved
 * and every control stays keyboard-reachable.
 */
export function LiveMapView({
  worldId,
  base,
  viewModel,
  targets,
  primaryLocationId,
  scenePanel,
  storyOverlay,
  timeSlot,
  timeStateBadges = NO_TIME_STATE_BADGES,
  replayAvailable = false,
  replayPlaying = false,
  replayText = null,
  onSkipReplay = () => undefined,
  onReplay = () => undefined,
  characterCard = null,
  onOpenCharacterCard,
  onCloseCharacterCard = () => undefined,
  initialCameraMode,
  onCameraModeChange,
  reducedMotion: reducedMotionProp,
  webglSupported,
  loading,
  degradation,
  staticMap = null,
  freshness = null,
  contentUpdatedAt = null,
  nowMs = 0,
  onRendererFailure,
  rendererResetKey,
}: LiveMapViewProps) {
  const observed = useReducedMotion();
  const reducedMotion = reducedMotionProp ?? observed;
  // Only the story overlay's default open state depends on this; the layout itself is CSS.
  const compactViewport = useCompactViewport();
  const spriteAssets = useSpriteAssets();
  const viewportRef = useRef<Viewport | undefined>(undefined);
  /**
   * The control that opened the character card, so closing it returns focus there (NFR-009).
   *
   * Captured from `document.activeElement` at open time rather than plumbed down as a ref,
   * because the trigger is one of N per-character buttons inside `CameraControls` and threading
   * a ref per row would put focus bookkeeping into a component whose entire contract is that it
   * only calls state setters. Without this, closing drops focus on `<body>` and a keyboard user
   * restarts from the top of the page.
   */
  const cardTriggerRef = useRef<HTMLElement | null>(null);
  const { ref, size } = useElementSize();
  // Seeded once. `useState`'s initial value is read on the first render only, which is exactly
  // the semantics ART-130 AC#5 wants: honour where the viewer was sent or where they left off,
  // then get out of the way.
  const [mode, setModeState] = useState<CameraMode>(initialCameraMode ?? INITIAL_CAMERA_MODE);
  const [camera, setCamera] = useState<CameraView | null>(null);

  /**
   * Every camera change goes through here, so there is exactly one place that both updates the
   * view and reports the change (ART-130 AC#5). Routing some changes around it is how "the
   * camera came back wrong, but only if you used the zoom buttons" bugs happen.
   */
  const setMode = (next: CameraMode) => {
    // FR-Q007 / ART-140. Every camera change already goes through here, so the four camera
    // events are derived from the TRANSITION rather than bolted onto each control — a control
    // added later emits correctly without anyone remembering to instrument it, which is the
    // same reason this function exists at all.
    emitCameraEvents(mode, next, worldId);
    setModeState(next);
    onCameraModeChange?.(next);
  };

  const { worldWidth, worldHeight } = viewModel;
  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    setCamera((previous) =>
      nextCamera({
        mode,
        targets,
        primaryLocationId,
        viewport: { screenWidth: size.width, screenHeight: size.height, worldWidth, worldHeight },
        reducedMotion,
        previous,
      }),
    );
  }, [mode, targets, primaryLocationId, size.width, size.height, worldWidth, worldHeight, reducedMotion]);

  // Pre-ART-127 behaviour, kept for callers that have not adopted the ladder: without a
  // verdict there are no middle rungs to fall to, so an absent WebGL context still means the
  // standalone signpost page.
  if (degradation === undefined && !webglSupported) {
    return <LiveMapFallback worldId={worldId} base={base} />;
  }

  const level = degradation?.level ?? 'stream';
  const showCanvas = level === 'stream' || level === 'snapshot';

  return (
    // `wide` is what makes AC#1 reachable: the prose measure every other public page uses is
    // narrower than a map beside a panel. Only this surface asks for it.
    <PublicPageFrame worldId={worldId} width="wide">
      <header>
        <h1 className="text-3xl font-bold">實況地圖</h1>
        <p className="text-sm public-muted">
          {loading ? '載入中…' : '拖曳可平移,滾動或雙指可縮放。你只是在看,世界不會因此改變。'}
        </p>
      </header>

      {/* Above the canvas on purpose: "what am I looking at" has to be answerable before a
          viewer looks, not after they scroll past the map to find out (FR-O014 AC#9). */}
      {timeStateBadges.length > 0 && <TimeStateBanner badges={timeStateBadges} />}

      {/* AC#3, and above the stage for the same reason the time-state banner is: "what am I
          looking at, and how old is it" has to be answerable BEFORE the viewer looks, not
          after they scroll past the map to find out. Rendered at every rung including the
          top — see `DegradationNotice` for why a notice that only appears when something is
          wrong fails AC#3 in the case that matters most. */}
      {degradation !== undefined && (
        <DegradationNotice
          verdict={degradation}
          freshness={freshness}
          updatedAt={contentUpdatedAt}
          nowMs={nowMs}
        />
      )}

      {/* The responsive stage (FR-O008 / ART-126). Exactly two children: the canvas and the
          story overlay, as block siblings — never one inside the other, so the overlay remains
          structurally incapable of obscuring the map (FR-O007 AC#5).

          The canvas comes FIRST in the DOM, which is also its visual position at every width.
          Below the breakpoint the stage is one column, so the map leads and the overlay is the
          card beneath it (AC#2, map-first). Above it the stage is two columns and they are on
          screen together (AC#1). Because the arrangement is achieved by changing the number of
          columns rather than by reordering, visual order equals DOM order in both — a flex/grid
          `order` that put the map first on mobile would have desynchronised the reading order
          from the focus order (WCAG 1.3.2 / 2.4.3) to buy the same result.

          ART-125 rendered the overlay before the canvas so "why does this matter" was answerable
          first. FR-O008 AC#2 asks for the opposite on small screens and wins; what ART-125 AC#5
          actually required — that the overlay never obscure the map — is untouched, and is still
          asserted by `storyOverlayLayout.dom.test.tsx`. */}
      <div className="live-stage mt-3">
        {/* Still the FIRST of the stage's exactly-two children at every rung, and still
            `.live-map-canvas`. The responsive contract ART-126 proved — one column with the
            map leading below 64rem, two columns above it, visual order equal to DOM order at
            both — is a property of the stage's shape, and a degraded rung has no business
            changing how the page lays out. Only what is INSIDE this box changes. */}
        <div ref={ref} className="live-map-canvas" data-rung={level}>
          {showCanvas && size.width > 0 && size.height > 0 && (
            // Around the canvas alone (FR-O010). A throw here takes out the renderer and
            // leaves the reads, the view model and the rest of the page standing, which is
            // what makes the static rung a DEGRADATION rather than a different page.
            <RendererErrorBoundary onFailure={onRendererFailure} resetKey={rendererResetKey}>
              <ReadOnlyWorld
                viewModel={viewModel}
                spriteAssets={spriteAssets}
                screenWidth={size.width}
                screenHeight={size.height}
                viewportRef={viewportRef}
                camera={camera ?? undefined}
                reducedMotion={reducedMotion}
                timeSlot={timeSlot}
                zones={mistwoodLocationFootprints}
                collision={mistwoodCollision}
              />
            </RendererErrorBoundary>
          )}
          {level === 'static-map' && staticMap !== null && <StaticMapView model={staticMap} />}
          {level === 'informational' && (
            <div className="live-informational">
              <p>
                目前沒有可顯示的角色位置。世界的地點、場景與最近事件仍可閱讀。
              </p>
              <p className="mt-2">
                <a className="public-tap" href={textLiveHref(worldId, base)}>
                  開啟文字實況(不需地圖)
                </a>
              </p>
            </div>
          )}
        </div>

        {storyOverlay !== undefined && (
          <StoryOverlay viewModel={storyOverlay} defaultOpen={!compactViewport} />
        )}
      </div>

      {replayPlaying && (
        <p className="live-replay-card mt-3">
          {replayText ?? '這個場景的公開摘要目前無法顯示。'}
        </p>
      )}

      <ReplayControls
        available={replayAvailable}
        playing={replayPlaying}
        onSkip={onSkipReplay}
        onReplay={onReplay}
      />

      {/* Between the scene panel and the camera chrome, and never over the canvas: the card is
          about a character the viewer can see, so covering them would hide the answer (FR-O006). */}
      {characterCard !== null && (
        <CharacterCard
          viewModel={characterCard}
          spriteAsset={
            characterCard.spriteAssetKey === null
              ? undefined
              : spriteAssets[characterCard.spriteAssetKey]
          }
          onClose={() => {
            onCloseCharacterCard();
            // After the card unmounts. Focus goes back to the button that opened it, not to
            // `<body>`; if that button has since gone (the character left the projection), the
            // optional chain simply does nothing and the browser keeps its own fallback.
            const trigger = cardTriggerRef.current;
            cardTriggerRef.current = null;
            trigger?.focus();
          }}
        />
      )}

      <ActiveScenePanel
        model={scenePanel ?? EMPTY_SCENE_PANEL}
        mode={mode}
        onModeChange={setMode}
      />

      <CameraControls
        targets={targets}
        mode={mode}
        onModeChange={setMode}
        onOpenCharacterCard={
          onOpenCharacterCard === undefined
            ? undefined
            : (characterId) => {
                // FR-Q007 / ART-140. Emitted HERE rather than in the page's handler, because
                // this wrapper is the one place every card open passes through — a caller that
                // supplies its own `onOpenCharacterCard` would otherwise silently emit nothing,
                // which is what the DOM test caught.
                emitDynamicViewEvent('live_character_selected', { worldId, characterId });
                // Recorded before the state change, while the pressed button is still the
                // active element. `CharacterCard` takes focus from here on mount.
                const active = typeof document === 'undefined' ? null : document.activeElement;
                cardTriggerRef.current = active instanceof HTMLElement ? active : null;
                onOpenCharacterCard(characterId);
              }
        }
      />

      <p className="mt-3 text-sm">
        {/* NFR-009 AC#3: the map always signposts its non-map equivalent. `public-tap` because it
            is a standalone control on a touch surface (FR-O008 AC#3), not a link inside a
            sentence — the WCAG 2.5.8 inline exception does not apply to it. */}
        <a className="public-tap" href={textLiveHref(worldId, base)}>
          改用文字實況(不需地圖)
        </a>
      </p>
    </PublicPageFrame>
  );
}
