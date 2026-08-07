import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { LiveMapFallback } from './LiveMapFallback';

/**
 * Catches a renderer failure that {@link ../world/webglSupport} could not predict
 * (ART-118 / FR-O001 AC#7).
 *
 * The probe answers "can this browser create a WebGL context", which is not the
 * same question as "can Pixi start". A context that is created and then lost, a
 * driver that rejects the shader compile, an out-of-memory texture upload -- all
 * of those throw during render, after the probe has already said yes. Without a
 * boundary they unmount the whole React tree and leave a blank page, which is a
 * worse answer than the text view.
 *
 * It wraps the map from outside the page frame, so the fallback renders as a
 * complete page rather than as a second `<main>` nested inside the first.
 */
export class LiveMapErrorBoundary extends Component<
  { worldId: string; base: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Live map renderer failed', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <LiveMapFallback worldId={this.props.worldId} base={this.props.base} reason="render-failed" />
      );
    }
    return this.props.children;
  }
}
