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
import type { PublicDynamicProjection } from './publicDynamicProjection';

/**
 * Version 2 adds the nested `dynamic` field (FR-N003 / ART-115). It is nested rather than
 * merged into the root `characters` list because `LiveCharacter` is a different, semantic
 * shape — location ids and aliveness — and collapsing the two would force every existing
 * consumer to care about motion.
 */
export const LIVE_PROJECTION_SCHEMA_VERSION = 2;
export const LIVE_MODEL_KIND = 'liveState' as const;
export const LIVE_RECENT_EVENT_DEFAULT = 20;

/** Arc statuses counted as "active" in the Live projection. */
export const ACTIVE_ARC_STATUSES = ['active', 'escalating', 'climax', 'resolving'] as const;

export type LiveWorldTime = { worldDay: number; timeSlot: TimeSlot };
export type LiveLocation = {
  locationId: string; name: string; description: string; locationType: string; active: boolean;
};
export type LiveCharacter = { characterId: string; locationId: string | null; alive: boolean };
export type LiveRecentEvent = { eventId: string; summary: string | null; worldDay: number; timeSlot: TimeSlot };
export type LiveActiveArc = { arcId: string; title: string; currentQuestion: string; status: string };
export type LiveScene = { title: string; summary: string; sourceEventIds: string[] };

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
  recentEventCount?: number;
  dynamic?: PublicDynamicProjection | null;
}): LiveProjectionPayload {
  if (input.worldId.trim().length === 0) {
    throw new LiveStateError('LIVE_STATE_INVALID', 'worldId must be non-empty');
  }
  const events = [...input.acceptedEvents].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const locations = new Map<string, LiveLocation>();
  const positionByCharacter = new Map<string, string>();
  const aliveByCharacter = new Map<string, boolean>();
  const knownCharacters = new Set<string>();

  for (const event of events) {
    if (event.worldId !== input.worldId) {
      throw new LiveStateError('LIVE_STATE_INVALID', 'accepted event worldId mismatch');
    }
    for (const change of event.stateChanges) {
      if (change.type === 'location_state_changed') {
        locations.set(change.locationId, {
          locationId: change.locationId, name: change.name, description: change.description,
          locationType: change.locationType, active: change.active,
        });
      } else if (change.type === 'character_location_changed') {
        knownCharacters.add(change.characterId);
        positionByCharacter.set(change.characterId, change.toLocationId);
      } else if (change.type === 'character_life_changed') {
        knownCharacters.add(change.characterId);
        aliveByCharacter.set(change.characterId, change.alive);
      }
    }
  }

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

  const activeScenes: LiveScene[] = input.publishedEpisode
    ? input.publishedEpisode.keyScenes.map((scene) => ({
        title: scene.title, summary: scene.summary, sourceEventIds: [...scene.sourceEventIds],
      }))
    : [];

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
