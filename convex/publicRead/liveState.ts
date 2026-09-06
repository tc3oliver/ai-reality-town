/**
 * Public Live-state projection (FR-I002, PRD §13.1–13.4).
 *
 * Derives the Live projection — world time, locations, character positions,
 * recent events, active arcs, and the published episode's active scenes — from
 * accepted events, arc projections, and publication state. Pure module — no
 * Convex imports, no clock, no randomness, no Canon mutation.
 *
 * The projection is published via the public read-model infrastructure
 * ({@link ./readModel.ts}) as a `liveState` model, so public reads are
 * failure-isolated (AC#2) and the rebuild is an independent entry point that
 * does not depend on the post-commit orchestrator (AC#4).
 */

import type { AcceptedEvent, TimeSlot } from '../canon/model';
import { emptyLiveFold, foldLiveEvents, type LiveFoldState, type LiveLocation } from './liveFold';
import { toPublicActiveScene } from './publicDynamicProjection';
import type {
  PublicActiveSceneInput,
  PublicActiveScenePublicationStatus,
  PublicActiveSceneStatus,
  PublicDynamicProjection,
} from './publicDynamicProjection';

/**
 * Version 2 adds the nested `dynamic` field (FR-N003 / ART-115). It is nested rather than
 * merged into the root `characters` list because `LiveCharacter` is a different, semantic
 * shape — location ids and aliveness — and collapsing the two would force every existing
 * consumer to care about motion.
 *
 * Version 3 widens `activeScenes` with the spatial fields of FR-O003 / ART-122 and lets them
 * be supplied independently of the daily episode, so the Live view has scenes on every slot
 * rather than only after the day's episode is narrated.
 */
export const LIVE_PROJECTION_SCHEMA_VERSION = 3;
export const LIVE_MODEL_KIND = 'liveState' as const;
export const LIVE_RECENT_EVENT_DEFAULT = 20;

/** Arc statuses counted as "active" in the Live projection. */
export const ACTIVE_ARC_STATUSES = ['active', 'escalating', 'climax', 'resolving'] as const;

export type LiveWorldTime = { worldDay: number; timeSlot: TimeSlot };
/**
 * Re-exported, not re-declared: the fold that produces these lives one layer down and may not
 * import from here (see `liveFold.ts`). Every existing caller keeps naming it from this module.
 */
export type { LiveLocation } from './liveFold';
export type LiveCharacter = { characterId: string; locationId: string | null; alive: boolean };
export type LiveRecentEvent = { eventId: string; summary: string | null; worldDay: number; timeSlot: TimeSlot };
export type LiveActiveArc = { arcId: string; title: string; currentQuestion: string; status: string };
/**
 * The Live view's scene, the same shape the map's {@link PublicActiveScene} publishes and
 * for the same reason its spatial half is optional: a payload persisted before ART-122 must
 * still render rather than being rejected as a contract nobody understands.
 */
export type LiveScene = {
  title: string;
  summary: string;
  sourceEventIds: string[];
  sceneId?: string;
  locationId?: string;
  participantCharacterIds?: string[];
  arcIds?: string[];
  status?: PublicActiveSceneStatus;
  publicationStatus?: PublicActiveScenePublicationStatus;
  startedAt?: number;
  endedAt?: number;
};

export type LiveProjectionPayload = {
  schemaVersion: typeof LIVE_PROJECTION_SCHEMA_VERSION;
  worldId: string;
  worldTime: LiveWorldTime | null;
  locations: LiveLocation[];
  characters: LiveCharacter[];
  recentEvents: LiveRecentEvent[];
  activeArcs: LiveActiveArc[];
  activeScenes: LiveScene[];
  publishedEpisodeStatus: string;
  /** Null when the world has no Visual Runtime binding, so motion cannot be planned. */
  dynamic: PublicDynamicProjection | null;
};

export type LiveArcInput = { arcId: string; title: string; currentQuestion: string; status: string };
export type LivePublishedEpisodeInput = {
  status: string;
  keyScenes: ReadonlyArray<{ title: string; summary: string; sourceEventIds: readonly string[] }>;
};

export class LiveStateError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'LiveStateError';
  }
}

function isActiveArc(status: string): boolean {
  return (ACTIVE_ARC_STATUSES as readonly string[]).includes(status);
}

/**
 * Deterministically derive the Live projection from accepted events, active arc
 * inputs, and the published episode (AC#1). Pure: identical inputs yield an
 * identical payload, so rebuilds are idempotent and safe to retry (AC#2/#4).
 */
export function buildLiveProjection(input: {
  worldId: string;
  acceptedEvents: readonly AcceptedEvent[];
  arcs: readonly LiveArcInput[];
  publishedEpisode: LivePublishedEpisodeInput | null;
  /**
   * Scenes derived from accepted Canon (FR-O003 / ART-122). Supplied separately from
   * `publishedEpisode` rather than through it, because the two answer different questions:
   * `publishedEpisodeStatus` reports whether the day has been narrated, which stays true
   * even on the four slots out of five where no episode exists but scenes do. Omitted falls
   * back to the episode's key scenes, which is what every caller predating ART-122 relies on.
   */
  activeScenes?: readonly PublicActiveSceneInput[];
  recentEventCount?: number;
  dynamic?: PublicDynamicProjection | null;
  /**
   * A fold state covering every event BEFORE `acceptedEvents` (ART-100). Lets a caller that holds
   * a checkpoint pass only the tail. Omitted means "start from empty", i.e. the full-replay
   * behaviour every pre-ART-100 caller relies on.
   */
  priorFold?: LiveFoldState;
}): LiveProjectionPayload {
  if (input.worldId.trim().length === 0) {
    throw new LiveStateError('LIVE_STATE_INVALID', 'worldId must be non-empty');
  }
  const events = [...input.acceptedEvents].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  for (const event of events) {
    if (event.worldId !== input.worldId) {
      throw new LiveStateError('LIVE_STATE_INVALID', 'accepted event worldId mismatch');
    }
  }

  /**
   * ART-100: the location/character maps come from the shared fold in `liveFold.ts` rather than
   * from a loop here, so a checkpoint resumed from stored state and a replay from raw events
   * cannot come to disagree. `priorFold` is what a caller supplies when it has such a checkpoint;
   * omitted, this is byte-for-byte the full replay it always was.
   *
   * The worldId check above stays a separate pass. It is a validation of the INPUT, not part of
   * the fold, and a caller resuming from a checkpoint has no events to check for the prefix the
   * checkpoint covers — folding it in would make the check silently weaker in exactly that case.
   */
  const { locations, positionByCharacter, aliveByCharacter, knownCharacters } =
    foldLiveEvents(input.priorFold ?? emptyLiveFold(), events);

  const characters: LiveCharacter[] = [...knownCharacters].sort().map((characterId) => ({
    characterId,
    locationId: positionByCharacter.get(characterId) ?? null,
    alive: aliveByCharacter.get(characterId) ?? true,
  }));

  const latest = events[events.length - 1] ?? null;
  const worldTime: LiveWorldTime | null = latest ? { worldDay: latest.worldDay, timeSlot: latest.timeSlot } : null;

  const recentLimit = input.recentEventCount ?? LIVE_RECENT_EVENT_DEFAULT;
  const recentEvents: LiveRecentEvent[] = events
    .slice(-recentLimit)
    .reverse()
    .map((event) => ({
      eventId: event.eventId,
      summary: event.publicSummary ?? null,
      worldDay: event.worldDay,
      timeSlot: event.timeSlot,
    }));

  const activeArcs: LiveActiveArc[] = input.arcs
    .filter((arc) => isActiveArc(arc.status))
    .map((arc) => ({ arcId: arc.arcId, title: arc.title, currentQuestion: arc.currentQuestion, status: arc.status }))
    .sort((a, b) => a.arcId.localeCompare(b.arcId));

  const activeScenes: LiveScene[] = (input.activeScenes ?? input.publishedEpisode?.keyScenes ?? [])
    .map(toPublicActiveScene);

  return {
    schemaVersion: LIVE_PROJECTION_SCHEMA_VERSION,
    worldId: input.worldId,
    worldTime,
    locations: [...locations.values()].sort((a, b) => a.locationId.localeCompare(b.locationId)),
    characters,
    recentEvents,
    activeArcs,
    activeScenes,
    publishedEpisodeStatus: input.publishedEpisode?.status ?? 'none',
    dynamic: input.dynamic ?? null,
  };
}

/** Source-event provenance for the published Live model (recent event ids). */
export function liveSourceEventIds(payload: LiveProjectionPayload): string[] {
  return payload.recentEvents.map((event) => event.eventId);
}
