import { useEffect, useState } from 'react';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Tracks the OS Reduced Motion preference (ART-118 / FR-O005 AC#6).
 *
 * The stylesheet's `prefers-reduced-motion` guard cannot reach the camera: a
 * pixi-viewport tween is a JavaScript animation on a canvas, not a CSS one. So
 * the preference is read here and fed into the camera model, which resolves it
 * to a transition of exactly zero milliseconds -- a snap, not a fast animation.
 *
 * Defaults to `false` where `matchMedia` is unavailable (SSR, jsdom without a
 * stub), which is the same frame a browser with no preference set would show.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion(globalWindow()));

  useEffect(() => {
    const win = globalWindow();
    if (win === undefined) return;
    const query = win.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

/** A window that can answer a media query, or `undefined` where none exists. */
type MediaWindow = Pick<Window, 'matchMedia'>;

function globalWindow(): MediaWindow | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  return window;
}

/**
 * Whether Reduced Motion is asked for. Split from the hook so the SSR default
 * and the "no `matchMedia`" case are testable without a React renderer.
 */
export function prefersReducedMotion(win: MediaWindow | undefined): boolean {
  if (win === undefined || typeof win.matchMedia !== 'function') return false;
  return win.matchMedia(REDUCED_MOTION_QUERY).matches;
}
