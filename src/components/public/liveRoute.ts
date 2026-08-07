/**
 * Pure, testable logic for the public live-world view (FR-I002, ART-68).
 *
 * Mirrors {@link ./homeRoute}: the React component is a thin render layer and
 * every correctness boundary lives here as a pure function, unit-tested without
 * a DOM (jest has no jsdom). One concern:
 *
 *   - {@link composeLiveViewModel}: normalises the published Live projection
 *     into a render model that satisfies FR-I002 — a text location list (AC#1,
 *     no game animation), scene summaries (AC#2), and graceful states so the
 *     page stays browsable from the last-known-good snapshot even when the
 *     simulation is paused or the model is missing (AC#4).
 *
 * Route resolution moved to `components/live/liveMapRoute.ts` with ART-118
 * (FR-O001 AC#8): the map and the text view are siblings under one path shape,
 * so one module owns both instead of each parsing its own hash.
 *
 * Pure module — no React, no Convex, no DOM, no clock, no randomness. Input
 * shapes mirror the published `liveState` projection payload.
 */

/** Published live-state projection (FR-I002) — fields the view reads. */
export type LiveProjection = {
  worldTime: { worldDay: number; timeSlot: string } | null;
  locations: Array<{
    locationId: string;
    name: string;
    description: string;
    locationType: string;
    active: boolean;
  }>;
  characters: Array<{ characterId: string; locationId: string | null; alive: boolean }>;
  recentEvents: Array<{
    eventId: string;
    summary: string | null;
    worldDay: number;
    timeSlot: string;
  }>;
  activeArcs: Array<{ arcId: string; title: string; currentQuestion: string; status: string }>;
  activeScenes: Array<LiveProjectionScene>;
  publishedEpisodeStatus: string;
};

/**
 * A published scene (FR-O003 / ART-122). Everything past `title` / `summary` is optional
 * because the payload's is: a `liveState` version persisted before ART-122 carries none of
 * it, and the text view has to keep rendering that rather than blanking.
 */
export type LiveProjectionScene = {
  title: string;
  summary: string;
  sceneId?: string;
  locationId?: string;
  participantCharacterIds?: string[];
  arcIds?: string[];
  status?: 'active' | 'ended';
};

const UNKNOWN_LOCATION = '未知位置';
const NO_SUMMARY = '(無摘要)';

/**
 * The world day a scene belongs to, read off its `sceneId`.
 *
 * `sceneId` is `${worldDay}:${timeSlot}:${locationId}` by construction (see
 * `convex/publicRead/activeScenePresentation.ts`), so the day is already in the payload.
 * Re-derived here rather than shared with the map's equivalent because the `clientPublic`
 * module may not depend on `clientLive`; three lines of duplication is the cheaper half of
 * that trade.
 */
function sceneWorldDay(sceneId: string | undefined): number | null {
  if (sceneId === undefined) return null;
  const parsed = Number(sceneId.split(':')[0]);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export type LiveViewModel = {
  /** True when any live content exists — the page is browsable even while false (AC#4). */
  hasContent: boolean;
  worldTime: { worldDay: number; timeSlot: string } | null;
  /** Text location list — no map/animation (AC#1). */
  locations: Array<{
    locationId: string;
    name: string;
    description: string;
    locationType: string;
    active: boolean;
  }>;
  /** Character positions with location resolved to a readable label (AC#1). */
  characterPositions: Array<{ characterId: string; locationLabel: string; alive: boolean }>;
  /**
   * Active scenes (FR-I002 AC#2, widened by FR-O003 AC#2/#5).
   *
   * The non-map equivalent required by NFR-009: the same title, summary, participants, story
   * arcs and Episode entry point the map's panel shows, as text. `locationLabel` is resolved
   * against the projection's own location list, so the reader sees the same name the map's
   * label does rather than a slug.
   */
  activeScenes: Array<{
    title: string;
    summary: string;
    locationLabel: string | null;
    participantCharacterIds: string[];
    arcIds: string[];
    ended: boolean;
    episodeHref: string | null;
  }>;
  /** Recent events (newest first), summaries only. */
  recentEvents: Array<{ eventId: string; summary: string; worldDay: number; timeSlot: string }>;
  activeArcs: Array<{ arcId: string; title: string; currentQuestion: string; status: string }>;
};

/**
 * Compose the live render model from the published projection, applying the
 * graceful-browsability rule (AC#4): every field degrades to an empty state
 * when the projection is null or empty, and the page still renders. Character
 * positions are joined to their location name so the list reads as text (AC#1).
 */
export function composeLiveViewModel(input: {
  live: LiveProjection | null;
  /** Needed only for the world-scoped Episode deep link; omitted yields no link. */
  worldId?: string;
}): LiveViewModel {
  const live = input.live;
  const locations = live?.locations ?? [];
  const locationNameById = new Map(locations.map((location) => [location.locationId, location.name]));

  return {
    hasContent: Boolean(
      live && (live.worldTime || locations.length > 0 || live.characters.length > 0
        || live.recentEvents.length > 0 || live.activeArcs.length > 0 || live.activeScenes.length > 0),
    ),
    worldTime: live?.worldTime ?? null,
    locations: locations.map((location) => ({
      locationId: location.locationId,
      name: location.name,
      description: location.description,
      locationType: location.locationType,
      active: location.active,
    })),
    characterPositions: (live?.characters ?? []).map((character) => ({
      characterId: character.characterId,
      locationLabel: character.locationId
        ? (locationNameById.get(character.locationId) ?? UNKNOWN_LOCATION)
        : UNKNOWN_LOCATION,
      alive: character.alive,
    })),
    activeScenes: (live?.activeScenes ?? []).map((scene) => {
      const worldDay = sceneWorldDay(scene.sceneId);
      return {
        title: scene.title,
        summary: scene.summary,
        locationLabel: scene.locationId
          ? (locationNameById.get(scene.locationId) ?? scene.locationId)
          : null,
        participantCharacterIds: [...(scene.participantCharacterIds ?? [])],
        arcIds: [...(scene.arcIds ?? [])],
        ended: scene.status === 'ended',
        // Only an ended scene links onward (FR-O003 AC#5): the day an active scene belongs
        // to has not been narrated yet, so the link would land on an empty Episode.
        episodeHref: scene.status === 'ended' && worldDay !== null && input.worldId
          ? `#episode/${encodeURIComponent(input.worldId)}/${worldDay}`
          : null,
      };
    }),
    recentEvents: (live?.recentEvents ?? []).map((event) => ({
      eventId: event.eventId,
      summary: event.summary ?? NO_SUMMARY,
      worldDay: event.worldDay,
      timeSlot: event.timeSlot,
    })),
    activeArcs: (live?.activeArcs ?? []).map((arc) => ({
      arcId: arc.arcId,
      title: arc.title,
      currentQuestion: arc.currentQuestion,
      status: arc.status,
    })),
  };
}
