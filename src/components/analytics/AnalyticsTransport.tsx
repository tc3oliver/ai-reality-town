/**
 * Mounts the analytics transport (§15 / ART-47).
 *
 * Renders nothing. It exists to connect three things that must not know about each other: the
 * emitter (`src/analytics`, pure, and reachable from every page), the identity
 * ({@link ./analyticsIdentity.ts}, the only part that touches storage) and the ingest
 * ({@link ./useAnalyticsIngest.ts}, the only part that may write).
 *
 * ## Why the sink is installed here rather than at module load
 *
 * The mutation is a React binding, so it does not exist until something is mounted. Installing at
 * import time would mean any module that imported the transport for a type started sending — and
 * a unit test importing a component would silently acquire a network path.
 *
 * ## What a page that is merely watched does
 *
 * Nothing. `AnalyticsTransport` schedules no repeating timer: the flush is a debounce armed by
 * the FIRST queued event, so an idle page holds no timer and issues no request. The only other
 * trigger is the page becoming hidden, which is a viewer leaving rather than a viewer watching.
 */

import { useEffect } from 'react';

import { resetAnalyticsSink, setAnalyticsSink } from '../../analytics/analyticsSink';
import { browserAnalyticsIdentity } from './analyticsIdentity';
import { createAnalyticsTransport } from './analyticsTransport';
import { useRecordAnalyticsEvents } from './useAnalyticsIngest';

export default function AnalyticsTransport(): null {
  const record = useRecordAnalyticsEvents();

  useEffect(() => {
    const identity = browserAnalyticsIdentity();
    // A private-mode window where storage throws. The product keeps working and reports nothing,
    // which is a true statement about that browser — never a minted per-render key, which would
    // fabricate an acquisition on every page load.
    if (identity === null) return undefined;

    const transport = createAnalyticsTransport(identity, {
      now: () => Date.now(),
      // Rebuilt field by field rather than passed through. The envelopes are already sanitised
      // and already typed to the contract, but Convex's generated argument type spells the same
      // object with mutable arrays — and copying explicitly is what makes a field added to the
      // contract without being added to the ingest a compile error rather than a silent drop.
      send: (request) => record({
        worldId: request.worldId,
        deviceKey: request.deviceKey,
        sessionToken: request.sessionToken,
        events: request.events.map((event) => ({
          name: event.name, payload: { ...event.payload }, sessionElapsedMs: event.sessionElapsedMs,
        })),
        droppedEventCount: request.droppedEventCount,
      }),
      schedule: (delayMs, run) => {
        const handle = setTimeout(run, delayMs);
        return () => clearTimeout(handle);
      },
    });

    setAnalyticsSink((event) => transport.accept(event));

    const onHidden = () => {
      // `visibilitychange` rather than `unload`: `unload` is unreliable on mobile and is not
      // fired at all in the back/forward cache, so a viewer who leaves a tab would keep their
      // last batch forever. This is the last point at which a page is reliably still alive.
      if (document.visibilityState === 'hidden') void transport.flush();
    };
    document.addEventListener('visibilitychange', onHidden);

    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      transport.stop();
      // Back to discarding. A component that emits during unmount must not reach a transport
      // whose timers have been cancelled.
      resetAnalyticsSink();
    };
  }, [record]);

  return null;
}
