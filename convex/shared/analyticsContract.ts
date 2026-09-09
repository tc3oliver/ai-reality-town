/**
 * THE analytics event contract — one allowlist, one sanitizer, both sides (ART-47 / ART-140).
 *
 * ## Why this lives in `shared`
 *
 * ART-140 built the payload allowlist inside `src/analytics`, which was the right place while
 * there was no sink: the only consumer was the browser. ART-47 adds a server that receives these
 * payloads from an untrusted client, and a server that trusts a client-side sanitizer has no
 * sanitizer at all.
 *
 * The obvious move — a second filter on the server — is the one thing this must not be. Two
 * allowlists drift, and a drift here is silent: both sides keep producing well-formed payloads
 * while one of them starts admitting a field the other rejects, and the field that gets through
 * is by construction one nobody was thinking about. `shared` depends on nothing and every module
 * may depend on it, so the emitter and the ingest run the SAME function over the SAME list. There
 * is one boundary, and it is enforced twice.
 *
 * ## What the two event families are
 *
 * - **PRD 1.0 §15** — sixteen product events across the public surface. ART-47's.
 * - **PRD 2.0 §17** — seventeen `live_*` events on the dynamic surface. ART-140's, moved here
 *   verbatim so both families share the boundary rather than sitting either side of it.
 *
 * Pure module: no React, no Convex, no DOM, no clock, no randomness.
 */

/** PRD 1.0 §15, in the order it names them. */
export const PRODUCT_ANALYTICS_EVENTS = [
  'home_viewed',
  'current_situation_expanded',
  'recommended_episode_opened',
  'episode_viewed',
  'episode_completed',
  'character_viewed',
  'character_followed',
  'story_arc_viewed',
  'story_arc_followed',
  'relationship_graph_opened',
  'timeline_filtered',
  'vote_viewed',
  'vote_submitted',
  'return_recap_viewed',
  'live_scene_opened',
  'share_action',
] as const;

/** PRD 2.0 §17, in the order it names them (FR-Q007 / ART-140). */
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

export const ANALYTICS_EVENTS = [...PRODUCT_ANALYTICS_EVENTS, ...DYNAMIC_VIEW_EVENTS] as const;

export type ProductAnalyticsEventName = (typeof PRODUCT_ANALYTICS_EVENTS)[number];
export type DynamicViewEventName = (typeof DYNAMIC_VIEW_EVENTS)[number];
export type AnalyticsEventName = ProductAnalyticsEventName | DynamicViewEventName;

/**
 * Every field any event may carry, and nothing else.
 *
 * An ALLOWLIST rather than a denylist, and that choice is the whole privacy design. A denylist
 * has to enumerate every private field that exists now and every one added later; these payloads
 * are built from view models that carry private-adjacent data one property away, so the first
 * field someone forgets is the first leak. An allowlist fails the other way: a field nobody
 * thought about is dropped, and the event is merely less informative.
 *
 * Note what is NOT here: no viewer id, no session id, no IP, no user agent, no account identity,
 * and no free text of any kind. The identifiers that ARE here — `characterId`, `sceneId`,
 * `arcId`, `locationId` — are WORLD identifiers, already public on every Episode page, and PRD
 * §16.1's click-through metrics cannot be computed without knowing which thing was clicked.
 *
 * The viewer and session keys travel on the ENVELOPE rather than in a payload, so no call site
 * can attach one and no event can carry a second one. See {@link AnalyticsEventEnvelope}.
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

  // --- §15 product events (ART-47) ---
  /**
   * Which public page emitted this, from a closed vocabulary of route names.
   *
   * Needed because §15 names one event for several surfaces — `share_action` fires from an
   * Episode, a character and an arc — and a metric that cannot tell them apart answers a
   * question nobody asked. It is a ROUTE name, never a URL: a URL carries query parameters, and
   * a query parameter is where a viewer identifier ends up by accident.
   */
  'surface',
  /** Which timeline filter was applied, from the filter UI's closed vocabulary. */
  'filterKind',
  /** Which share format was taken, from `episode-share-formats`' closed vocabulary. */
  'shareTarget',
  /** Position of a recommended entry point in its list, so CTR can be read by rank. */
  'entryRank',
  /** Whether a follow control turned following ON. `false` is an unfollow. */
  'followed',
] as const;

export type AllowedPayloadKey = (typeof ALLOWED_PAYLOAD_KEYS)[number];

/**
 * Values a payload field may hold.
 *
 * Deliberately narrow. Objects and arrays are refused outright rather than walked, because a
 * nested value is how a whole view model gets attached to an event by accident — and a recursive
 * sanitiser would then have to decide what is private INSIDE it, which is the judgement this
 * design exists to avoid making at every call site.
 */
export type AnalyticsPayloadValue = string | number | boolean;

export type AnalyticsPayload = Partial<Record<AllowedPayloadKey, AnalyticsPayloadValue>>;

export type AnalyticsEvent = {
  name: AnalyticsEventName;
  payload: AnalyticsPayload;
};

/**
 * The longest a payload string may be.
 *
 * Not an aesthetic limit. Every allowed key holds an identifier or a member of a closed
 * vocabulary, and none of those is long — so a value past this length is, by elimination,
 * something that is not an identifier: a summary, a sentence, a name. Truncating would still emit
 * most of it, so an over-long value is DROPPED. The event survives with one fewer field, which is
 * the right trade against publishing a sentence nobody reviewed.
 */
export const MAX_PAYLOAD_VALUE_LENGTH = 64;

/**
 * Strip a payload to the declared contract.
 *
 * Total: any input, including one carrying a whole view model, yields a payload containing only
 * allowlisted keys holding short scalars. Called inside the client's single emitter AND at the
 * server's ingest boundary — the client call makes a mistake cheap to catch, the server call is
 * what makes the guarantee true, because the client is not trusted.
 */
export function sanitizeAnalyticsPayload(payload: unknown): AnalyticsPayload {
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

/** Whether a name is a declared event. Unknown names are refused, not passed through. */
export function isAnalyticsEvent(name: string): name is AnalyticsEventName {
  return (ANALYTICS_EVENTS as readonly string[]).includes(name);
}

/**
 * The fields that identify WHAT an occurrence of each event is about.
 *
 * This is the definition of「一次邏輯量測」and therefore of every rate in §16.1, so it is declared
 * per event rather than inferred. The unit of measurement is `(session, event, subject)`: a
 * viewer who opens Episode 7 twice in one visit opened one Episode, and a component that
 * re-renders four times reports one open.
 *
 * That has to be explicit for two separate reasons:
 *
 *  - **Deriving the subject from "every field present" would silently double-count.**
 *    `live_view_opened` carries a `freshness` verdict that changes while the viewer sits there.
 *    Two emissions with different verdicts are one view, and folding `freshness` into the subject
 *    would inflate the denominator of every §18.1 rate.
 *  - **Deriving it from `worldId` alone would silently under-count.** Filtering the timeline
 *    twice with two different filters is two interactions, and both are real.
 *
 * Exhaustive by type: an event added without a subject list does not compile, which is what stops
 * the next event from getting whichever default happened to be convenient.
 */
export const EVENT_SUBJECT_KEYS: Readonly<Record<AnalyticsEventName, readonly AllowedPayloadKey[]>> = {
  // --- §15 ---
  home_viewed: ['worldId'],
  current_situation_expanded: ['worldId'],
  recommended_episode_opened: ['worldId', 'worldDay'],
  episode_viewed: ['worldId', 'worldDay'],
  episode_completed: ['worldId', 'worldDay'],
  character_viewed: ['worldId', 'characterId'],
  character_followed: ['worldId', 'characterId', 'followed'],
  story_arc_viewed: ['worldId', 'arcId'],
  story_arc_followed: ['worldId', 'arcId', 'followed'],
  relationship_graph_opened: ['worldId'],
  timeline_filtered: ['worldId', 'filterKind'],
  vote_viewed: ['worldId', 'worldDay'],
  vote_submitted: ['worldId', 'worldDay'],
  return_recap_viewed: ['worldId'],
  live_scene_opened: ['worldId', 'sceneId'],
  share_action: ['worldId', 'surface', 'shareTarget'],

  // --- §17 ---
  live_view_opened: ['worldId'],
  live_map_ready: ['worldId'],
  live_map_failed: ['worldId', 'reason'],
  live_fallback_used: ['worldId', 'degradationLevel'],
  live_character_selected: ['worldId', 'characterId'],
  live_scene_selected: ['worldId', 'sceneId'],
  live_arc_opened: ['worldId', 'arcId'],
  live_episode_opened: ['worldId', 'worldDay'],
  live_camera_follow_enabled: ['worldId', 'characterId'],
  live_camera_follow_disabled: ['worldId'],
  live_zoom_used: ['worldId', 'zoomStep'],
  live_runtime_stale_seen: ['worldId'],
  live_return_to_town: ['worldId'],
  live_replay_started: ['worldId', 'replayId'],
  live_replay_completed: ['worldId', 'replayId'],
  live_replay_skipped: ['worldId', 'replayId'],
  live_replay_manual_triggered: ['worldId', 'replayId'],
};

/**
 * The key one logical measurement is counted under.
 *
 * DERIVED, never transmitted. The client computes it to drop its own repeats, and the server
 * computes it again from the envelope it received — it does not read a key the client sent. A
 * caller-supplied dedupe key would let anyone suppress a row by claiming an existing key, or
 * inflate a metric by varying one, and neither is detectable after the fact.
 *
 * `sessionKey` is already scoped to one viewer, so it carries the whole identity portion; the
 * subject carries `worldId`, so keys cannot collide across worlds.
 */
export function analyticsDedupeKey(
  sessionKey: string,
  name: AnalyticsEventName,
  payload: AnalyticsPayload,
): string {
  const subject = EVENT_SUBJECT_KEYS[name]
    .map((key) => `${key}=${payload[key] === undefined ? '' : String(payload[key])}`)
    .join('&');
  return `${sessionKey}#${name}#${subject}`;
}

/** One event as it crosses the wire. The keys travel beside it, on the batch. */
export type AnalyticsEventEnvelope = {
  name: AnalyticsEventName;
  payload: AnalyticsPayload;
  /** Milliseconds since this session's first event. A DURATION, never a wall-clock instant. */
  sessionElapsedMs: number;
};

/**
 * How many events one batch may carry.
 *
 * The queue flushes well below this; the bound exists because the ingest is a public surface and
 * an unbounded array argument is an unbounded write.
 */
export const MAX_ANALYTICS_BATCH_SIZE = 32;

/** The UTC day an instant falls in. The bucket every retention window is measured in. */
export const MS_PER_DAY = 86_400_000;
export const dayIndexOf = (epochMs: number): number => Math.floor(epochMs / MS_PER_DAY);

/**
 * How many distinct return-day offsets one viewer row records.
 *
 * Sized well past D7 — the furthest window §16.1 defines — so a truncated row is a viewer far
 * outside anything the PRD measures rather than a routine occurrence. It lives with the contract
 * rather than with the table because it is a rule about MEASUREMENT: the retention metric has to
 * know the same number in order to exclude a row that can no longer answer.
 */
export const MAX_RETURN_DAY_OFFSETS = 32;

/**
 * The analytics events that count as viewer interaction WITH AN ARC (FR-F006 / ART-32).
 *
 * Every one of them carries `arcId` in `ANALYTICS_EVENT_PAYLOAD_KEYS`, which is what makes a
 * per-arc rollup possible without widening what analytics stores: `arcId` is a world identifier,
 * already public on every Episode page, and is listed here as such.
 *
 * `story_arc_followed` counts whether the viewer followed or UNfollowed. Interaction is attention,
 * and un-following an arc is attention paid to it — a rollup that counted only the positive
 * direction would report an arc people are actively abandoning as one nobody has an opinion about.
 *
 * Declared in `shared` rather than beside the ingest that bumps the counter, because the heat
 * scorer in `story` and the ingest in `analytics` must agree on the set and may not import each
 * other.
 */
export const ARC_INTERACTION_EVENTS = [
  'story_arc_viewed',
  'story_arc_followed',
  'live_arc_opened',
] as const;
export type ArcInteractionEvent = (typeof ARC_INTERACTION_EVENTS)[number];

export const isArcInteractionEvent = (eventName: string): eventName is ArcInteractionEvent =>
  (ARC_INTERACTION_EVENTS as readonly string[]).includes(eventName);
