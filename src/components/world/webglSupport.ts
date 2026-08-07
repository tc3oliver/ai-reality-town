/**
 * WebGL availability probe (ART-118 / FR-O001 AC#7).
 *
 * Pixi 7 ships no software renderer: `@pixi/canvas-renderer` is a separate,
 * uninstalled package and the `Application` constructor throws outright when no
 * WebGL context can be created. So the fallback has to be decided *before* the
 * stage is mounted, which is what this probe is for -- see
 * `components/live/LiveMapFallback.tsx` for what is shown instead.
 *
 * The canvas factory is injected so the failure modes (no `getContext`, a null
 * context, a driver that throws) can be exercised without a browser.
 */
export function detectWebGLSupport(
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): boolean {
  try {
    const canvas = createCanvas();
    if (typeof canvas.getContext !== 'function') return false;
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    // A blocked or crashing driver is indistinguishable from an absent one as
    // far as the viewer is concerned: both mean "show the text view instead".
    return false;
  }
}
