import {
  isAnalyticsEvent,
  sanitizeAnalyticsPayload,
  type AnalyticsEvent,
  type AnalyticsEventName,
} from '../../convex/shared/analyticsContract';

/**
 * Where analytics events go (FR-Q007 / ART-140, §15 / ART-47).
 *
 * ## The one choke point
 *
 * Every event in the product — §15's sixteen and §17's seventeen — reaches a sink through
 * {@link emitAnalyticsEvent} and through nothing else. That is what makes the privacy guarantee a
 * STRUCTURE rather than a discipline: sanitisation happens here, before the sink is handed
 * anything, so there is no path by which an unsanitised payload reaches a collector and no call
 * site that could forget. A transport installed later inherits it without having to know it
 * exists.
 *
 * ## The default still discards, and that is still deliberate
 *
 * ART-140 shipped with a discarding default because no sink existed. ART-47 builds one, and the
 * default here is unchanged: the sink is installed by
 * {@link ../components/analytics/AnalyticsTransport.tsx} at app boot, and a build that does not
 * mount it — every unit test, every module that imports this for the contract alone — still emits
 * into nothing.
 *
 * ## Failure isolation
 *
 * Total and silent: an unknown name is dropped rather than thrown, and a sink that throws is
 * swallowed. Analytics is the least important thing on the page, and a viewer losing the live map
 * because a telemetry call failed would be a far worse defect than a missing event — the same
 * reasoning `liveViewSession` fails open for a remembered camera. `analyticsSurface.test.ts`
 * proves it with a throwing sink, and the browser gate proves it against the real transport in a
 * build where the transport's call ALWAYS throws.
 *
 * Pure module: no React, no Convex, no DOM, no clock, no randomness. The transport is a separate
 * module for exactly that reason.
 */

export type AnalyticsSink = (event: AnalyticsEvent) => void;

/** Discards. The shipped default until a transport installs itself; see above. */
export const noopAnalyticsSink: AnalyticsSink = () => undefined;

let sink: AnalyticsSink = noopAnalyticsSink;

/**
 * Install a sink. The transport's entry point, and the test suites'.
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

/** Emit one event, of either family. Unknown names are dropped. */
export function emitAnalyticsEvent(name: string, payload: unknown = {}): void {
  if (!isAnalyticsEvent(name)) return;
  try {
    sink({ name: name as AnalyticsEventName, payload: sanitizeAnalyticsPayload(payload) });
  } catch {
    // Deliberately empty. See above.
  }
}

/**
 * ART-140's spelling, kept because forty call sites use it and renaming them would have made this
 * task's diff mostly noise. Identical behaviour: the registry it checks against is the shared one,
 * so a §15 name passed here is emitted rather than silently dropped.
 */
export const emitDynamicViewEvent = emitAnalyticsEvent;
