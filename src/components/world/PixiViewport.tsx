// Based on https://codepen.io/inlet/pen/yLVmPWv.
// Copyright (c) 2018 Patrick Brouwer, distributed under the MIT license.

import { PixiComponent } from '@pixi/react';
import { Viewport } from 'pixi-viewport';
import { Application } from 'pixi.js';
import { MutableRefObject, ReactNode } from 'react';

import { MAX_CAMERA_SCALE, fitScale } from './cameraModel';

export type ViewportProps = {
  app: Application;
  viewportRef?: MutableRefObject<Viewport | undefined>;

  screenWidth: number;
  screenHeight: number;
  worldWidth: number;
  worldHeight: number;
  /** ART-118 AC#6: no inertia and no smoothed wheel when the OS asks for less motion. */
  reducedMotion?: boolean;
  children?: ReactNode;
};

/** Props this component owns; everything else is forwarded onto the Viewport instance. */
const MANAGED_PROPS = new Set(['app', 'viewportRef', 'children', 'reducedMotion']);

/**
 * Drag, pinch and wheel, plus the motion plugins that Reduced Motion turns off.
 *
 * Re-applied when `reducedMotion` changes, because pixi-viewport plugins are
 * installed once and have no "reconfigure" path.
 */
function applyMotionPlugins(viewport: Viewport, reducedMotion: boolean): void {
  viewport.drag().pinch({}).wheel({ smooth: reducedMotion ? 0 : 3 });
  if (reducedMotion) {
    viewport.plugins.remove('decelerate');
  } else {
    viewport.decelerate();
  }
}

/**
 * Pan bounds and zoom bounds, both derived from the current screen and world size.
 *
 * The inherited version configured these exactly once, in `create`, from a
 * hardcoded `(1.04 * screenWidth) / (worldWidth / 2)` expression. A resize
 * therefore left the camera clamped to bounds computed for the old viewport, and
 * on a narrow screen the minimum scale could exceed the scale at which the map
 * fits -- the map could not be zoomed out far enough to be seen whole.
 */
function applyCameraBounds(viewport: Viewport, props: ViewportProps): void {
  viewport.clamp({ direction: 'all', underflow: 'center' });
  viewport.clampZoom({ minScale: fitScale(props), maxScale: MAX_CAMERA_SCALE });
}

/**
 * Survives unmount (ART-118).
 *
 * `pixi-viewport`'s `InputManager.destroy()` unconditionally dereferences
 * `viewport.options.events.domElement` to unbind its wheel listener, but
 * `@pixi/react`'s `Stage` destroys the whole `Application` in its own
 * `componentWillUnmount` -- which React runs *before* it removes children -- and
 * that sets `domElement` to null. Tearing the map down therefore threw
 * `Cannot read properties of null (reading 'removeEventListener')` from inside
 * React's commit phase, where no error boundary can catch it: the whole app
 * unmounted to a blank page on every navigation away from the map.
 *
 * ART-113 never hit this because nothing ever mounted the renderer; FR-O001 is
 * the first route that does, and the first that can leave it.
 *
 * Restoring a detached element makes the upstream `removeEventListener` a no-op
 * rather than a crash. The real listener is already gone with the destroyed
 * renderer's canvas, so nothing leaks; the rest of `Viewport.destroy()` (ticker
 * function, plugins, display objects) still runs normally.
 */
export function detachViewportFromDom(viewport: Viewport): void {
  const events = viewport.options.events as unknown as { domElement: unknown };
  if (events !== undefined && events !== null && events.domElement === null) {
    events.domElement = { removeEventListener: () => undefined };
  }
}

// https://davidfig.github.io/pixi-viewport/jsdoc/Viewport.html
export default PixiComponent('Viewport', {
  willUnmount(viewport: Viewport) {
    detachViewportFromDom(viewport);
  },
  create(props: ViewportProps) {
    const { app, children, viewportRef, reducedMotion, ...viewportProps } = props;
    const viewport = new Viewport({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      events: app.renderer.events,
      passiveWheel: false,
      ...viewportProps,
    });
    if (viewportRef) {
      viewportRef.current = viewport;
    }
    applyMotionPlugins(viewport, reducedMotion === true);
    applyCameraBounds(viewport, props);
    // The inherited code opened on `.setZoom(-10)`, a negative scale: the world
    // was drawn mirrored and 10x, and only became legible once the viewer
    // happened to zoom out past the clamp. `fitWorld` frames the whole map at
    // exactly the minimum scale, which is the frame the town view (FR-O005)
    // returns to.
    viewport.fitWorld(true);
    viewport.moveCenter(props.worldWidth / 2, props.worldHeight / 2);
    return viewport;
  },
  applyProps(viewport, oldProps: ViewportProps, newProps: ViewportProps) {
    let boundsStale = false;
    for (const key of Object.keys(newProps) as (keyof ViewportProps)[]) {
      if (MANAGED_PROPS.has(key)) continue;
      if (oldProps[key] === newProps[key]) continue;
      boundsStale = true;
      // @ts-expect-error Ignoring TypeScript here
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      viewport[key] = newProps[key];
    }
    if (oldProps.reducedMotion !== newProps.reducedMotion) {
      applyMotionPlugins(viewport, newProps.reducedMotion === true);
    }
    if (boundsStale) {
      applyCameraBounds(viewport, newProps);
    }
  },
});
