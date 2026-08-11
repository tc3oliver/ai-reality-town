import { useEffect, useRef, useState } from 'react';
import type { Viewport } from 'pixi-viewport';

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
import { LiveMapFallback } from './LiveMapFallback';
import { textLiveHref } from './liveMapRoute';
import { ReplayControls } from './ReplayControls';
import { StoryOverlay } from './StoryOverlay';
import type { StoryOverlayViewModel } from './storyOverlayModel';
import { TimeStateBanner } from './TimeStateBanner';
import type { TimeStateBadge } from './timeStateLabel';
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
  reducedMotion: reducedMotionProp,
  webglSupported,
  loading,
}: LiveMapViewProps) {
  const observed = useReducedMotion();
  const reducedMotion = reducedMotionProp ?? observed;
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
  const [mode, setMode] = useState<CameraMode>(INITIAL_CAMERA_MODE);
  const [camera, setCamera] = useState<CameraView | null>(null);

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

  if (!webglSupported) {
    return <LiveMapFallback worldId={worldId} base={base} />;
  }

  return (
    <PublicPageFrame worldId={worldId}>
      <header>
        <h1 className="text-3xl font-bold">實況地圖</h1>
        <p className="text-sm public-muted">
          {loading ? '載入中…' : '拖曳可平移,滾動或雙指可縮放。你只是在看,世界不會因此改變。'}
        </p>
      </header>

      {/* Above the canvas on purpose: "what am I looking at" has to be answerable before a
          viewer looks, not after they scroll past the map to find out (FR-O014 AC#9). */}
      {timeStateBadges.length > 0 && <TimeStateBanner badges={timeStateBadges} />}

      {/* Before the canvas, and a block sibling of it rather than a layer over it (FR-O007
          AC#5): "why does this matter" is what a viewer needs before they look at the map, and a
          block above it structurally cannot obscure it. */}
      {storyOverlay !== undefined && <StoryOverlay viewModel={storyOverlay} />}

      <div ref={ref} className="live-map-canvas mt-3">
        {size.width > 0 && size.height > 0 && (
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
                // Recorded before the state change, while the pressed button is still the
                // active element. `CharacterCard` takes focus from here on mount.
                const active = typeof document === 'undefined' ? null : document.activeElement;
                cardTriggerRef.current = active instanceof HTMLElement ? active : null;
                onOpenCharacterCard(characterId);
              }
        }
      />

      <p className="mt-3 text-sm">
        {/* NFR-009 AC#3: the map always signposts its non-map equivalent. */}
        <a href={textLiveHref(worldId, base)}>改用文字實況(不需地圖)</a>
      </p>
    </PublicPageFrame>
  );
}
