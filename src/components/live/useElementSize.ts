import { useCallback, useEffect, useRef, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

export const EMPTY_ELEMENT_SIZE: ElementSize = { width: 0, height: 0 };

/**
 * Report `node`'s size whenever it changes, and hand back a teardown.
 *
 * Split out of the hook so the behaviour that matters -- rounded whole pixels,
 * an immediate first measurement, and an observer that is actually
 * disconnected -- is testable without a React renderer. A leaked
 * `ResizeObserver` keeps a detached canvas alive on every route change, which is
 * exactly the kind of defect a "the hook renders" test would not catch.
 *
 * Returns a no-op teardown where `ResizeObserver` is unavailable (SSR, old
 * browsers); the caller then simply never mounts the stage.
 */
export function observeElementSize(
  node: HTMLElement,
  onResize: (size: ElementSize) => void,
): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const measure = () => {
    const box = node.getBoundingClientRect();
    onResize({ width: Math.round(box.width), height: Math.round(box.height) });
  };
  const observer = new ResizeObserver(measure);
  observer.observe(node);
  measure();
  return () => observer.disconnect();
}

/**
 * The measured size of a DOM element (ART-118 / FR-O001 AC#1).
 *
 * The Pixi stage needs explicit pixel dimensions, so "works on desktop and
 * mobile" means measuring the container rather than hardcoding a size. A
 * `ResizeObserver` also covers device rotation and browser-chrome changes,
 * which a `window.resize` listener alone misses on mobile Safari.
 *
 * Reports {@link EMPTY_ELEMENT_SIZE} until the first measurement; the caller
 * must not mount the stage at zero size.
 */
export function useElementSize(): {
  ref: (node: HTMLElement | null) => void;
  size: ElementSize;
} {
  const [size, setSize] = useState<ElementSize>(EMPTY_ELEMENT_SIZE);
  const teardown = useRef<(() => void) | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    teardown.current?.();
    teardown.current = node === null ? null : observeElementSize(node, setSize);
  }, []);

  useEffect(() => () => teardown.current?.(), []);

  return { ref, size };
}
