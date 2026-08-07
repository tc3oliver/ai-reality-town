/**
 * WebGL detection (ART-118, FR-O001 AC#7).
 *
 * The point of the probe is that it never throws and never guesses: every way a
 * browser can fail to give us a context has to resolve to `false`, because the
 * alternative is Pixi's `Application` constructor throwing and taking the page
 * with it.
 *
 * Pure jest (no jsdom): the canvas factory is injected.
 */

import { detectWebGLSupport } from './webglSupport';

function canvasReturning(contexts: Record<string, unknown>): () => HTMLCanvasElement {
  return () =>
    ({
      getContext: (id: string) => contexts[id] ?? null,
    }) as unknown as HTMLCanvasElement;
}

describe('detectWebGLSupport', () => {
  test('true when a WebGL 2 context is available', () => {
    expect(detectWebGLSupport(canvasReturning({ webgl2: {} }))).toBe(true);
  });

  test('true when only the WebGL 1 context is available', () => {
    expect(detectWebGLSupport(canvasReturning({ webgl: {} }))).toBe(true);
  });

  test('false when every context request returns null', () => {
    expect(detectWebGLSupport(canvasReturning({}))).toBe(false);
  });

  test('false when getContext throws', () => {
    expect(
      detectWebGLSupport(
        () =>
          ({
            getContext: () => {
              throw new Error('WebGL is disabled');
            },
          }) as unknown as HTMLCanvasElement,
      ),
    ).toBe(false);
  });

  test('false when the canvas cannot be created at all', () => {
    expect(
      detectWebGLSupport(() => {
        throw new Error('document is not defined');
      }),
    ).toBe(false);
  });

  test('false when the element has no getContext (a non-browser environment)', () => {
    expect(detectWebGLSupport(() => ({}) as unknown as HTMLCanvasElement)).toBe(false);
  });
});
