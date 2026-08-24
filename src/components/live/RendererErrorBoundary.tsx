import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * Catches a renderer throw around the CANVAS ONLY (FR-O010 / ART-127).
 *
 * ## Why this is not `LiveMapErrorBoundary`
 *
 * That boundary wraps the whole route, so a renderer throw unmounts the page — including the
 * four public reads that live on it. That was the right shape when the only answer to a
 * renderer failure was "show a different page", but it makes the middle rungs of the
 * degradation ladder unreachable: rung 3 needs the DATA to survive the renderer, because the
 * whole idea is to keep drawing the same positions a different way.
 *
 * So the ladder gets an inner boundary around the Pixi stage. A throw here takes out the
 * canvas and nothing else: the queries stay subscribed, the view model stays composed, and
 * the page swaps in the static plan on the next render. `LiveMapErrorBoundary` stays where it
 * is as the outer net for a failure in the page itself — a read that throws, a view model
 * that cannot be built — where there really is nothing left to degrade to.
 *
 * ## Why this cannot become a retry loop (AC#4)
 *
 * The latch is state on this component and is cleared ONLY when `resetKey` changes — the map
 * identity. There is no timer, no backoff and no attempt counter, so there is no path by
 * which a failed render schedules another one. Remounting a renderer that just threw is a
 * crash loop, and a crash loop against a live deployment is precisely the shape of thing that
 * turns a rendering fault into load on everything behind it.
 *
 * Recovery for the rungs BELOW the renderer needs none of this: they are derived per render
 * from the data, so they climb back on their own (AC#5). Only the renderer itself is sticky,
 * and only because re-running it is the one thing known to fail.
 */
export class RendererErrorBoundary extends Component<
  {
    children: ReactNode;
    /**
     * Told once per failure, so the page can drop a rung. Called from `componentDidCatch`
     * rather than `getDerivedStateFromError`, which React may invoke during a render pass it
     * later discards — a setState from there can fire for a render that never committed.
     */
    onFailure?: () => void;
    /**
     * Clearing the latch. The map identity, so switching worlds is worth one more attempt at
     * the renderer; anything clock-derived here would be the retry loop this class exists to
     * not have.
     */
    resetKey?: string;
  },
  { failedKey: string | null }
> {
  state: { failedKey: string | null } = { failedKey: null };

  static getDerivedStateFromError() {
    // A sentinel rather than the key: `getDerivedStateFromError` is static and cannot read
    // props. `render` compares against the current key and treats a mismatch as recovered.
    return { failedKey: '__failed__' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Live map renderer failed', error, info.componentStack);
    this.props.onFailure?.();
  }

  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.failedKey !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ failedKey: null });
    }
  }

  render() {
    // Nothing, not a fallback: the page has already been told, and it renders the static plan
    // in this component's place. Rendering a second message here would put two explanations
    // of the same failure on one screen.
    if (this.state.failedKey !== null) return null;
    return this.props.children;
  }
}
