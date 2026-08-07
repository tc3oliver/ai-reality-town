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
import { CameraControls } from './CameraControls';
import { LiveMapFallback } from './LiveMapFallback';
import { textLiveHref } from './liveMapRoute';
import { useElementSize } from './useElementSize';
import { useReducedMotion } from './useReducedMotion';

export interface LiveMapViewProps {
  worldId: string;
  base: string;
  viewModel: ReadOnlyWorldViewModel;
  targets: readonly FocusTarget[];
  /** The location standing in for "the active scene" until FR-O003 publishes one. */
  primaryLocationId: string | null;
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
 * sees arrives as props from {@link ./LiveMapPage}, which reads one public
 * query and nothing else.
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
  webglSupported,
  loading,
}: LiveMapViewProps) {
  const reducedMotion = useReducedMotion();
  const viewportRef = useRef<Viewport | undefined>(undefined);
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

      <div ref={ref} className="live-map-canvas mt-3">
        {size.width > 0 && size.height > 0 && (
          <ReadOnlyWorld
            viewModel={viewModel}
            // FR-O002 (ART-119) publishes the sprite bindings; until then the
            // character layer is mounted and positioned but draws nothing.
            spriteAssets={{}}
            screenWidth={size.width}
            screenHeight={size.height}
            viewportRef={viewportRef}
            camera={camera ?? undefined}
            reducedMotion={reducedMotion}
            zones={mistwoodLocationFootprints}
            collision={mistwoodCollision}
          />
        )}
      </div>

      <CameraControls targets={targets} mode={mode} onModeChange={setMode} />

      <p className="mt-3 text-sm">
        {/* NFR-009 AC#3: the map always signposts its non-map equivalent. */}
        <a href={textLiveHref(worldId, base)}>改用文字實況(不需地圖)</a>
      </p>
    </PublicPageFrame>
  );
}
