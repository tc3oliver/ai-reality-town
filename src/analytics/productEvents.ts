/**
 * PRD 1.0 §15's sixteen product events, as the public surface emits them (ART-47).
 *
 * ## Why typed emitters rather than raw `emitAnalyticsEvent('episode_viewed', {...})`
 *
 * The sanitiser guarantees no FORBIDDEN field survives. It cannot guarantee that a REQUIRED one
 * was supplied, and a missing field is the failure mode that matters for §16.1: an
 * `episode_viewed` with no `worldDay` still passes every privacy test, still reaches the sink,
 * and dedupes against every other Episode the viewer opened — so the metric reports one Episode
 * open for a session that opened nine. That is silent, and it is exactly the class of defect
 * `EVENT_SUBJECT_KEYS` exists to make explicit.
 *
 * So each event gets a function whose parameters ARE its subject keys. A call site cannot omit
 * one, and cannot invent a field, because there is nowhere to put it.
 *
 * ## The closed vocabularies
 *
 * `surface`, `filterKind` and `shareTarget` are unions rather than strings for the same reason.
 * The sanitiser accepts any short string, so nothing stops a call site putting an Episode
 * headline in `surface` — short enough to survive, free text in a field the contract says is a
 * route name. Making the type closed moves that from "the sanitiser would probably drop it" to
 * "it does not compile".
 *
 * Pure module: no React, no Convex, no DOM, no clock, no randomness.
 */

import { emitAnalyticsEvent } from './analyticsSink';

/**
 * Which public surface emitted an event, as a ROUTE name.
 *
 * Never a URL. A URL carries query parameters and a fragment, and a query parameter is where an
 * identifier ends up by accident — a deep link a viewer pasted, a campaign tag, a scroll
 * position. A closed set of route names cannot carry any of that.
 */
export const ANALYTICS_SURFACES = [
  'home', 'episode', 'episodes', 'character', 'arc', 'graph', 'timeline', 'recap', 'live',
] as const;
export type AnalyticsSurface = (typeof ANALYTICS_SURFACES)[number];

/** The three dimensions `timelineRoute.ts`'s `TimelineFilter` offers. */
export const ANALYTICS_FILTER_KINDS = ['arc', 'character', 'eventType'] as const;
export type AnalyticsFilterKind = (typeof ANALYTICS_FILTER_KINDS)[number];

/** `SHARE_FORMAT_KINDS` from `convex/editorial/derived/shareFormats.ts`, plus the raw link. */
export const ANALYTICS_SHARE_TARGETS = [
  'local_news', 'social_post', 'share_card', 'next_day_teaser', 'link',
] as const;
export type AnalyticsShareTarget = (typeof ANALYTICS_SHARE_TARGETS)[number];

// --- entry points -----------------------------------------------------------

/** The denominator of almost every §16.1 rate. Fires once per session per world. */
export const emitHomeViewed = (worldId: string): void =>
  emitAnalyticsEvent('home_viewed', { worldId });

/** FR-H002's 三分鐘前情提要 was expanded. §16.1 target ≥ 20%. */
export const emitCurrentSituationExpanded = (worldId: string): void =>
  emitAnalyticsEvent('current_situation_expanded', { worldId });

/**
 * FR-H003's recommended entry point was clicked. §16.1 target ≥ 20%.
 *
 * `entryRank` is carried so the rate can be read by position — a recommendation list whose only
 * clicked entry is the first one is a different finding from one clicked evenly, and the PRD
 * target alone cannot tell them apart. It is not part of the subject: clicking rank 2 after
 * rank 1 in one session is one viewer who used the recommendations.
 */
export const emitRecommendedEpisodeOpened = (
  worldId: string, worldDay: number, entryRank: number,
): void => emitAnalyticsEvent('recommended_episode_opened', { worldId, worldDay, entryRank });

// --- episodes ---------------------------------------------------------------

/** The numerator of §16.1's first-session Episode open rate. Target ≥ 40%. */
export const emitEpisodeViewed = (worldId: string, worldDay: number): void =>
  emitAnalyticsEvent('episode_viewed', { worldId, worldDay });

export const emitEpisodeCompleted = (worldId: string, worldDay: number): void =>
  emitAnalyticsEvent('episode_completed', { worldId, worldDay });

// --- characters and arcs ----------------------------------------------------

export const emitCharacterViewed = (worldId: string, characterId: string): void =>
  emitAnalyticsEvent('character_viewed', { worldId, characterId });

/**
 * A follow control was used. §16.1's 追蹤角色或 Arc target ≥ 8%.
 *
 * `followed` is part of the SUBJECT, so following and then unfollowing the same character in one
 * session is two measurements rather than one — otherwise the second press would dedupe against
 * the first and the record would say the viewer still follows someone they do not.
 */
export const emitCharacterFollowed = (
  worldId: string, characterId: string, followed: boolean,
): void => emitAnalyticsEvent('character_followed', { worldId, characterId, followed });

export const emitStoryArcViewed = (worldId: string, arcId: string): void =>
  emitAnalyticsEvent('story_arc_viewed', { worldId, arcId });

export const emitStoryArcFollowed = (worldId: string, arcId: string, followed: boolean): void =>
  emitAnalyticsEvent('story_arc_followed', { worldId, arcId, followed });

// --- the remaining public surfaces ------------------------------------------

export const emitRelationshipGraphOpened = (worldId: string): void =>
  emitAnalyticsEvent('relationship_graph_opened', { worldId });

export const emitTimelineFiltered = (worldId: string, filterKind: AnalyticsFilterKind): void =>
  emitAnalyticsEvent('timeline_filtered', { worldId, filterKind });

export const emitVoteViewed = (worldId: string, worldDay: number): void =>
  emitAnalyticsEvent('vote_viewed', { worldId, worldDay });

/**
 * A ballot was cast. §16.1's 投票參與率 target ≥ 10%.
 *
 * The subject is `(worldId, worldDay)` and NOT the candidate, which is what makes a retried
 * submission — the vote hook retries, and a viewer who changes their mind presses again —
 * one participation rather than two. Which candidate won is the ballot's own record; a
 * participation rate that moved when someone changed their vote would be measuring the wrong
 * thing.
 */
export const emitVoteSubmitted = (worldId: string, worldDay: number): void =>
  emitAnalyticsEvent('vote_submitted', { worldId, worldDay });

export const emitReturnRecapViewed = (worldId: string): void =>
  emitAnalyticsEvent('return_recap_viewed', { worldId });

/** §15's own live event, distinct from §17's `live_scene_selected`. Both are declared. */
export const emitLiveSceneOpened = (worldId: string, sceneId: string): void =>
  emitAnalyticsEvent('live_scene_opened', { worldId, sceneId });

export const emitShareAction = (
  worldId: string, surface: AnalyticsSurface, shareTarget: AnalyticsShareTarget,
): void => emitAnalyticsEvent('share_action', { worldId, surface, shareTarget });
