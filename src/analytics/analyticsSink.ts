import {
  isDynamicViewEvent,
  sanitizeAnalyticsPayload,
  type DynamicViewEvent,
  type DynamicViewEventName,
} from './dynamicViewEvents';

/**
 * Where analytics events go (FR-Q007 / ART-140).
 *
 * ## The default does nothing, and that is the delivery
 *
 * There is no compliant collection mechanism in this repo — ART-47 owns building one — and the
 * client structurally cannot invent one: `readOnlyClientBoundary` forbids every write primitive
 * and `publicReadOnlyGuarantee.test.ts` asserts the shipped bundle reaches exactly one Convex
 * function, a query. A reporting mutation would be a hole in FR-O009 rather than an extension
 * of it.
 *
 * So the default sink discards. Shipping this changes no network behaviour whatsoever, which is
 * asserted rather than asserted-about: `analyticsSurface.test.ts` reads every file in this
 * module for request and timer APIs, the same way `liveMapSurface.test.ts` does for the live
 * map.
 *
 * What that leaves is the part worth having early: the seventeen events fire from the right
 * places, with payloads proven clean. When ART-47 lands it installs a sink and the events are
 * already flowing correctly — as against writing the emission points at the same time as the
 * transport, when a payload mistake ships to a collector rather than to a no-op.
 *
 * ## Why sanitisation happens HERE
 *
 * `emitDynamicViewEvent` sanitises before handing anything to the sink, so there is no path by
 * which an unsanitised payload reaches a collector. Leaving it to call sites would make the
 * privacy guarantee a discipline; doing it at the one choke point makes it a structure, and a
 * future sink installed by ART-47 inherits it without having to know it exists.
 */

export type AnalyticsSink = (event: DynamicViewEvent) => void;

/** Discards. The shipped default; see above. */
export const noopAnalyticsSink: AnalyticsSink = () => undefined;

let sink: AnalyticsSink = noopAnalyticsSink;

/**
 * Install a sink. ART-47's entry point, and the test suites'.
 *
 * Module-level rather than React context on purpose: events fire from pure handlers and from
 * effects in components that have no reason to know about a provider, and threading a context
 * through them would put an analytics concern into every signature it passes.
 */
export function setAnalyticsSink(next: AnalyticsSink): void {
  sink = next;
}

/** Restore the discarding default. Every test that installs a sink must end here. */
export function resetAnalyticsSink(): void {
  sink = noopAnalyticsSink;
}

/**
 * Emit one event.
 *
 * Total and silent: an unknown name is dropped rather than thrown, and a sink that throws is
 * swallowed. Analytics is the least important thing on the page, and a viewer losing the live
 * map because a telemetry call failed would be a far worse defect than a missing event — the
 * same reasoning `liveViewSession` fails open for a remembered camera.
 */
export function emitDynamicViewEvent(name: string, payload: unknown = {}): void {
  if (!isDynamicViewEvent(name)) return;
  try {
    sink({ name: name as DynamicViewEventName, payload: sanitizeAnalyticsPayload(payload) });
  } catch {
    // Deliberately empty. See above.
  }
}
