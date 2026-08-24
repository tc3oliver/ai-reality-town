import { useEffect, useState } from 'react';

/**
 * The width below which the live surface is a single column (FR-O008 / ART-126).
 *
 * Kept in lockstep with the `.live-stage` two-column rule in `src/index.css`; the number is
 * declared here as well because one decision that JavaScript and CSS both depend on has to be
 * checkable from both sides, and `liveResponsiveLayout.dom.test.tsx` asserts the two agree.
 */
export const COMPACT_VIEWPORT_MAX_REM = 64;

export const COMPACT_VIEWPORT_QUERY = `(max-width: ${COMPACT_VIEWPORT_MAX_REM - 0.0625}rem)`;

/**
 * Whether the live surface is rendering as a single stacked column (FR-O008 / ART-126).
 *
 * The layout itself is CSS and needs no help from here. What does need it is the ONE decision a
 * media query cannot express: whether the story overlay's `<details>` starts open. FR-O007 says a
 * mobile viewer is not required to be shown everything at once, and below the breakpoint the
 * overlay sits under the map — expanded by default it would push the rest of the page a screenful
 * further down for a viewer who came to watch the map. Above it the overlay is in its own column
 * beside the map, costs the map no space, and PRD 2.0 UX2-004's permanently-available context
 * applies.
 *
 * Defaults to `false` — the desktop arrangement — where `matchMedia` is unavailable (SSR, jsdom
 * without a stub). That is the safer default of the two: it errs towards showing the context
 * rather than hiding it, so a viewer never loses information to a missing browser API.
 */
export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(() => isCompactViewport(globalWindow()));

  useEffect(() => {
    const win = globalWindow();
    if (win === undefined) return;
    const query = win.matchMedia(COMPACT_VIEWPORT_QUERY);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return compact;
}

/** A window that can answer a media query, or `undefined` where none exists. */
type MediaWindow = Pick<Window, 'matchMedia'>;

function globalWindow(): MediaWindow | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  return window;
}

/**
 * Whether the viewport is below the single-column breakpoint. Split from the hook, exactly as
 * `prefersReducedMotion` is, so the SSR default and the "no `matchMedia`" case are testable
 * without a React renderer.
 */
export function isCompactViewport(win: MediaWindow | undefined): boolean {
  if (win === undefined || typeof win.matchMedia !== 'function') return false;
  return win.matchMedia(COMPACT_VIEWPORT_QUERY).matches;
}
