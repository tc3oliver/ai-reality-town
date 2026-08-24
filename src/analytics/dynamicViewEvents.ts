/**
 * The dynamic viewing analytics event contract (FR-Q007 / ART-140, PRD 2.0 §17).
 *
 * ## The constraint that shapes this whole module
 *
 * The task says to use "the existing compliant collection mechanism". There isn't one. ART-47
 * (the privacy-preserving analytics platform) is still To Do, and there is no sink of any kind
 * in this repo today.
 *
 * More than that, there structurally CANNOT be one on the client's own initiative:
 * `readOnlyClientBoundary` forbids every client write primitive, and
 * `convex/publicRead/publicReadOnlyGuarantee.test.ts` (ART-128 / FR-O009) asserts that the
 * shipped bundle reaches exactly one Convex surface, a query. Adding a reporting mutation would
 * not extend that guarantee — it would be a hole in it. `docs/dynamic-view-observability.md`
 * reached the same conclusion for the two `client_external` metrics and said so: the collector
 * is "most likely an external analytics sink rather than a Convex write path".
 *
 * ## So what this task actually delivers
 *
 * Everything except the transport, which is ART-47's:
 *
 * 1. **The contract** — all seventeen §17 events, declared once, with the payload each carries.
 * 2. **The privacy guarantee** — {@link sanitizeAnalyticsPayload} strips anything outside the
 *    declared allowlist, and the negative tests are the load-bearing part of this task. AC#2 is
 *    the one criterion that is cheaper to get right before a sink exists than after.
 * 3. **The emission points** — real triggers in the live surface, through {@link ./analyticsSink}.
 * 4. **The derivations** — §18.1's click-rate and replay-completion computed from the event
 *    stream, so AC#4 is a demonstrated property rather than a promise.
 *
 * The default sink does nothing, so shipping this changes no network behaviour at all and the
 * read-only guarantee is untouched. That is deliberate: an event contract that is proven clean
 * and emitted from the right places is the expensive half, and it is the half that has to exist
 * before any sink can be pointed at it.
 *
 * Pure module: no React, no Convex, no DOM, no clock, no randomness.
 */

/** The seventeen events PRD 2.0 §17 names for the live surface, in the order it names them. */
export const DYNAMIC_VIEW_EVENTS = [
  'live_view_opened',
  'live_map_ready',
  'live_map_failed',
  'live_fallback_used',
  'live_character_selected',
  'live_scene_selected',
  'live_arc_opened',
  'live_episode_opened',
  'live_camera_follow_enabled',
  'live_camera_follow_disabled',
  'live_zoom_used',
  'live_runtime_stale_seen',
  'live_return_to_town',
  'live_replay_started',
  'live_replay_completed',
  'live_replay_skipped',
  'live_replay_manual_triggered',
] as const;

export type DynamicViewEventName = (typeof DYNAMIC_VIEW_EVENTS)[number];

/**
 * Every field any event may carry, and nothing else.
 *
 * An ALLOWLIST rather than a denylist, and that choice is the whole privacy design. A denylist
 * has to enumerate every private field that exists now and every one added later; the payloads
 * here are built from view models that carry private-adjacent data one property away, so the
 * first field someone forgets is the first leak. An allowlist fails the other way: a field
 * nobody thought about is dropped, and the event is merely less informative.
 *
 * Note what is NOT here: no viewer id, no session id, no IP, no user agent, no free text of any
 * kind. `characterId`, `sceneId`, `arcId` and `locationId` are WORLD identifiers — already
 * public on every Episode page — not personal ones, and PRD 2.0 §17's click-rate metric cannot
 * be computed without knowing which thing was clicked.
 */
export const ALLOWED_PAYLOAD_KEYS = [
  /** Which world. Public, and every event is scoped to one. */
  'worldId',
  /** A world identifier the surface already publishes. Never a viewer identifier. */
  'characterId',
  'sceneId',
  'arcId',
  'locationId',
  /** Canon time. Already printed on every Episode page. */
  'worldDay',
  'timeSlot',
  /** Which ladder rung produced the event (FR-O010). */
  'degradationLevel',
  /** The server's freshness verdict at the moment of the event. */
  'freshness',
  /** Which Episode was opened. */
  'episodeNumber',
  /** Camera zoom step, as an integer. Not a position, and not a viewport size. */
  'zoomStep',
  /** Replay progress, so §18.1's completion rate is computable. */
  'replayId',
  'sceneIndex',
  'sceneCount',
  /** Why a fallback happened, from the ladder's closed vocabulary. */
  'reason',
] as const;

export type AllowedPayloadKey = (typeof ALLOWED_PAYLOAD_KEYS)[number];

/**
 * Values a payload field may hold.
 *
 * Deliberately narrow. Objects and arrays are refused outright rather than walked, because a
 * nested value is how a whole view model gets attached to an event by accident — and a
 * recursive sanitiser would then have to decide what is private INSIDE it, which is the
 * judgement this design exists to avoid making at every call site.
 */
export type AnalyticsPayloadValue = string | number | boolean;

export type DynamicViewEventPayload = Partial<Record<AllowedPayloadKey, AnalyticsPayloadValue>>;

export type DynamicViewEvent = {
  name: DynamicViewEventName;
  payload: DynamicViewEventPayload;
};

/**
 * The longest a payload string may be.
 *
 * Not an aesthetic limit. Every allowed key holds an identifier or an enum member, and none of
 * those is long — so a value past this length is, by elimination, something that is not an
 * identifier: a summary, a sentence, a name. Truncating would still emit most of it, so an
 * over-long value is DROPPED. The event survives with one fewer field, which is the right
 * trade against publishing a sentence nobody reviewed.
 */
export const MAX_PAYLOAD_VALUE_LENGTH = 64;

/**
 * Strip a payload to the declared contract.
 *
 * Total: any input, including one carrying a whole view model, yields a payload containing only
 * allowlisted keys holding short scalars. Called inside {@link ./analyticsSink}'s emit rather
 * than left to call sites, so there is no path by which an event reaches a sink unsanitised —
 * "remember to sanitise" is a discipline, and this is a structure.
 */
export function sanitizeAnalyticsPayload(payload: unknown): DynamicViewEventPayload {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const source = payload as Record<string, unknown>;
  const clean: Record<string, AnalyticsPayloadValue> = {};

  for (const key of ALLOWED_PAYLOAD_KEYS) {
    const value = source[key];
    if (typeof value === 'string') {
      // Dropped, not truncated — see MAX_PAYLOAD_VALUE_LENGTH.
      if (value.length > 0 && value.length <= MAX_PAYLOAD_VALUE_LENGTH) clean[key] = value;
    } else if (typeof value === 'number') {
      // A non-finite number serialises as `null` in JSON and reads as a missing field, so it is
      // dropped here rather than emitted as one.
      if (Number.isFinite(value)) clean[key] = value;
    } else if (typeof value === 'boolean') {
      clean[key] = value;
    }
  }
  return clean;
}

/** Whether a name is one of the seventeen. Unknown names are refused, not passed through. */
export function isDynamicViewEvent(name: string): name is DynamicViewEventName {
  return (DYNAMIC_VIEW_EVENTS as readonly string[]).includes(name);
}

/**
 * PRD 2.0 §18.1's two live metrics, computed from the event stream (AC#4).
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
