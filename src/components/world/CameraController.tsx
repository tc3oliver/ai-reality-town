import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { Viewport } from 'pixi-viewport';

import type { CameraView } from './cameraModel';

/**
 * Applies a {@link CameraView} to the live viewport (ART-118 / FR-O005).
 *
 * Renders nothing: it exists so the imperative half of the camera -- the two
 * pixi-viewport calls that actually move it -- sits in one auditable place
 * instead of being scattered through the page.
 *
 * Data props only. It takes the ref to the viewport and the frame to show, and
 * exposes no callback and no `on*` prop, so it does not weaken the property
 * `readOnlyWorld.dom.test.tsx` asserts about this module: nothing in the render
 * tree can be invoked by a viewer.
 *
 * `transitionMs === 0` snaps rather than animating over zero milliseconds. That
 * is what Reduced Motion resolves to (AC#6), and it means no tween is scheduled
 * at all rather than one that finishes immediately.
 */
export function CameraController({
  viewportRef,
  camera,
}: {
  viewportRef: MutableRefObject<Viewport | undefined>;
  camera: CameraView;
}) {
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === undefined) return;
    if (camera.transitionMs <= 0) {
      viewport.setZoom(camera.scale, true);
      viewport.moveCenter(camera.centerX, camera.centerY);
      return;
    }
    viewport.animate({
      time: camera.transitionMs,
      position: { x: camera.centerX, y: camera.centerY },
      scale: camera.scale,
      // A viewer who grabs the map mid-transition keeps the drag; the camera
      // does not fight them back to its target.
      removeOnInterrupt: true,
    });
  }, [viewportRef, camera]);

  return null;
}
