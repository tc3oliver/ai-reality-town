/**
 * Pure, testable logic for the public live-world view (FR-I002, ART-68).
 *
 * Mirrors {@link ./homeRoute}: the React component is a thin render layer and
 * every correctness boundary lives here as a pure function, unit-tested without
 * a DOM (jest has no jsdom). Two concerns:
 *
 *   - {@link parseLiveRoute}: resolves the public world from `#live/<worldId>`.
 *   - {@link composeLiveViewModel}: normalises the published Live projection
 *     into a render model that satisfies FR-I002 — a text location list (AC#1,
 *     no game animation), scene summaries (AC#2), and graceful states so the
 *     page stays browsable from the last-known-good snapshot even when the
 *     simulation is paused or the model is missing (AC#4).
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
  activeScenes: Array<{ title: string; summary: string }>;
  publishedEpisodeStatus: string;
};

const UNKNOWN_LOCATION = '未知位置';
const NO_SUMMARY = '(無摘要)';

/**
 * Resolve the public world from the `#live/<worldId>` hash route. Returns null
 * for a bare/unknown route so the component can surface a format hint.
 */
export function parseLiveRoute(hash: string): { worldId: string } | null {
  const stripped = hash.replace(/^#/, '');
  const match = stripped.match(/^live\/([^/]+)$/);
  if (!match) return null;
  const worldId = decodeURIComponent(match[1]);
  return worldId.length > 0 ? { worldId } : null;
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
  /** Active scenes as summaries only (AC#2). */
  activeScenes: Array<{ title: string; summary: string }>;
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
export function composeLiveViewModel(input: { live: LiveProjection | null }): LiveViewModel {
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
    activeScenes: (live?.activeScenes ?? []).map((scene) => ({
      title: scene.title,
      summary: scene.summary,
    })),
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
