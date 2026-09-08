/**
 * The dynamic viewing analytics event contract (FR-Q007 / ART-140, PRD 2.0 §17).
 *
 * ## What moved, and why this file is now mostly re-exports
 *
 * ART-140 defined the seventeen `live_*` events, the payload ALLOWLIST and the sanitiser here,
 * because there was no sink and the browser was the only consumer. ART-47 added a server that
 * receives these payloads from an untrusted client, and a server that trusts a client-side
 * sanitiser has no sanitiser at all.
 *
 * The contract therefore moved to {@link ../../convex/shared/analyticsContract.ts}, which both
 * this module and the ingest import. It is one allowlist enforced twice, rather than two
 * allowlists that agree today — the failure mode of the second design is silent, because both
 * halves keep producing well-formed payloads while one starts admitting a field the other drops.
 *
 * What stays here is what is genuinely about the DYNAMIC surface: the seventeen names as a
 * separately addressable set, and §18.1's two live metrics.
 *
 * Pure module: no React, no Convex, no DOM, no clock, no randomness.
 */

export {
  ALLOWED_PAYLOAD_KEYS,
  DYNAMIC_VIEW_EVENTS,
  MAX_PAYLOAD_VALUE_LENGTH,
  sanitizeAnalyticsPayload,
  type AllowedPayloadKey,
  type AnalyticsPayloadValue,
  type DynamicViewEventName,
} from '../../convex/shared/analyticsContract';

import {
  DYNAMIC_VIEW_EVENTS,
  type AnalyticsPayload,
  type DynamicViewEventName,
} from '../../convex/shared/analyticsContract';

/** ART-140's name for a §17 payload. The shared contract calls it `AnalyticsPayload`. */
export type DynamicViewEventPayload = AnalyticsPayload;

export type DynamicViewEvent = {
  name: DynamicViewEventName;
  payload: DynamicViewEventPayload;
};

/**
 * Whether a name is one of the SEVENTEEN.
 *
 * Deliberately narrower than the shared contract's `isAnalyticsEvent`, which admits §15's
 * product events too. §18.1's metrics below are about the dynamic surface, and a predicate that
 * quietly widened to the whole registry would let a §15 event be counted as a live one.
 */
export function isDynamicViewEvent(name: string): name is DynamicViewEventName {
  return (DYNAMIC_VIEW_EVENTS as readonly string[]).includes(name);
}

/**
 * PRD 2.0 §18.1's two live metrics, computed from the event stream (ART-140 AC#4).
 *
 * Present as a function rather than as a claim in a document, because "these events make the
 * metric measurable" is exactly the kind of statement that turns out to be false when someone
 * finally tries — usually because the denominator was never emitted. Computing it here, against
 * the same event list a sink would receive, is what makes AC#4 checkable.
 *
 * - **Click-through rate** — of the viewers who opened the live view, how many then opened
 *   anything: a character, a scene, an arc or an Episode. `live_view_opened` is the denominator,
 *   which is why it must fire on every open including the degraded ones.
 * - **Replay completion rate** — completions over starts. Skips are counted separately rather
 *   than being folded in as failures: a viewer who skips has made a choice, and merging that
 *   with a replay that stopped for some other reason would answer neither question.
 */
export type DynamicViewMetricSummary = {
  liveViewsOpened: number;
  interactions: number;
  /** `null` when nothing opened the live view — a rate with a zero denominator is not zero. */
  clickThroughRate: number | null;
  replaysStarted: number;
  replaysCompleted: number;
  replaysSkipped: number;
  replayCompletionRate: number | null;
};

const INTERACTION_EVENTS: readonly DynamicViewEventName[] = [
  'live_character_selected',
  'live_scene_selected',
  'live_arc_opened',
  'live_episode_opened',
];

export function summariseDynamicViewEvents(
  events: readonly DynamicViewEvent[],
): DynamicViewMetricSummary {
  const count = (name: DynamicViewEventName) =>
    events.filter((event) => event.name === name).length;

  const liveViewsOpened = count('live_view_opened');
  const interactions = events.filter((event) => INTERACTION_EVENTS.includes(event.name)).length;
  const replaysStarted = count('live_replay_started');
  const replaysCompleted = count('live_replay_completed');

  return {
    liveViewsOpened,
    interactions,
    // `null`, not `0`. "Nobody clicked" and "nobody arrived" are different findings, and
    // reporting the second as the first is how a launch gets diagnosed as a UX problem.
    clickThroughRate: liveViewsOpened === 0 ? null : round(interactions / liveViewsOpened),
    replaysStarted,
    replaysCompleted,
    replaysSkipped: count('live_replay_skipped'),
    replayCompletionRate: replaysStarted === 0 ? null : round(replaysCompleted / replaysStarted),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
