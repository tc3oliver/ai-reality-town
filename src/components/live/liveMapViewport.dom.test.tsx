/**
 * Responsive sizing and the Reduced Motion probe (ART-118, FR-O001 AC#1 / AC#6).
 *
 * Runs in the `dom` Jest project because `ResizeObserver` and `matchMedia` are
 * browser globals; nothing is rendered and no component is mounted, matching the
 * convention `readOnlyWorld.dom.test.tsx` set.
 */

import { EMPTY_ELEMENT_SIZE, observeElementSize } from './useElementSize';
import { REDUCED_MOTION_QUERY, prefersReducedMotion } from './useReducedMotion';

type Callback = () => void;

/** A minimal ResizeObserver: fires on demand, and records that it was disconnected. */
function installResizeObserver() {
  const instances: Array<{ observed: Element[]; disconnected: boolean; fire: Callback }> = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    private readonly record = { observed: [] as Element[], disconnected: false, fire: () => undefined as void };
    constructor(callback: Callback) {
      this.record.fire = callback;
      instances.push(this.record);
    }
    observe(element: Element) {
      this.record.observed.push(element);
    }
    unobserve() {
      /* not used by the module under test */
    }
    disconnect() {
      this.record.disconnected = true;
    }
  };
  return instances;
}

function sizedElement(width: number, height: number): HTMLElement {
  const node = document.createElement('div');
  node.getBoundingClientRect = () => ({ width, height }) as DOMRect;
  return node;
}

describe('observeElementSize (AC#1)', () => {
  const original = (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  afterEach(() => {
    (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = original;
  });

  test('measures immediately, so the stage does not wait a frame to appear', () => {
    installResizeObserver();
    const sizes: Array<{ width: number; height: number }> = [];
    observeElementSize(sizedElement(1024, 768), (size) => sizes.push(size));
    expect(sizes).toEqual([{ width: 1024, height: 768 }]);
  });

  test('reports whole pixels, and re-measures when the box changes', () => {
    const instances = installResizeObserver();
    let width = 390.4;
    const node = document.createElement('div');
    node.getBoundingClientRect = () => ({ width, height: 663.6 }) as DOMRect;
    const sizes: Array<{ width: number; height: number }> = [];
    observeElementSize(node, (size) => sizes.push(size));
    expect(sizes).toEqual([{ width: 390, height: 664 }]);

    // Rotation: the observer fires again and the new box is picked up.
    width = 844;
    instances[0].fire();
    expect(sizes[1]).toEqual({ width: 844, height: 664 });
    expect(instances[0].observed).toHaveLength(1);
  });

  test('teardown disconnects, so a detached canvas is not kept alive', () => {
    const instances = installResizeObserver();
    const stop = observeElementSize(sizedElement(100, 100), () => undefined);
    expect(instances[0].disconnected).toBe(false);
    stop();
    expect(instances[0].disconnected).toBe(true);
  });

  test('is inert where ResizeObserver does not exist', () => {
    (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = undefined;
    const sizes: unknown[] = [];
    const stop = observeElementSize(sizedElement(100, 100), (size) => sizes.push(size));
    expect(sizes).toEqual([]);
    expect(() => stop()).not.toThrow();
    // The caller therefore never sees a non-zero size and never mounts the stage.
    expect(EMPTY_ELEMENT_SIZE).toEqual({ width: 0, height: 0 });
  });
});

describe('prefersReducedMotion (AC#6)', () => {
  test('reads the standard media query', () => {
    const asked: string[] = [];
    const win = {
      matchMedia: (query: string) => {
        asked.push(query);
        return { matches: true } as MediaQueryList;
      },
    };
    expect(prefersReducedMotion(win)).toBe(true);
    expect(asked).toEqual([REDUCED_MOTION_QUERY]);
  });

  test('is false when the preference is not set', () => {
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) as MediaQueryList })).toBe(
      false,
    );
  });

  test('defaults to false where matchMedia does not exist', () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(prefersReducedMotion({} as unknown as Pick<Window, 'matchMedia'>)).toBe(false);
  });
});
