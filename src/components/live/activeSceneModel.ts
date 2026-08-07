/**
 * Pure display model for the active scene panel (FR-O003 / ART-122).
 *
 * Mirrors the split the rest of this feature uses: {@link ./ActiveScenePanel} is a thin
 * render layer, and every decision worth testing -- which scene is focusable, what a scene
 * is called when nothing named it, where an ended scene sends the viewer -- lives here as a
 * pure function with no React, no DOM, no Convex and no clock.
 *
 * The panel exists as its own surface rather than as another chip list in
 * {@link ./CameraControls} because AC#2 asks for a title, a multi-sentence summary, a
 * participant list and an arc list per scene. A chip carries a label; this does not fit in
 * one. Focus still travels through the same {@link FocusTarget} mechanism the camera chrome
 * uses, so pressing a scene here and pressing it there do exactly the same thing.
 */

import type { MistwoodLocationFootprint } from '../../../data/mistwood';
import { sceneTargetId } from '../world/cameraModel';

/** One published scene, as this module reads it. Every ART-122 field is optional. */
export interface ActiveSceneInput {
  title: string;
  summary: string;
  sceneId?: string;
  locationId?: string;
  participantCharacterIds?: string[];
  arcIds?: string[];
  status?: 'active' | 'ended';
  startedAt?: number;
  endedAt?: number;
}

export interface ActiveScenePanelItem {
  /** Stable across rebuilds, so React reconciliation does not remount an unchanged scene. */
  key: string;
  title: string;
  summary: string;
  /** The location's authored name when the map knows it, else the raw id, else null. */
  locationLabel: string | null;
  participantCharacterIds: string[];
  arcIds: string[];
  ended: boolean;
  /**
   * The camera target to focus, or null when the scene has no id or no placeable location.
   * Null is what the panel renders as "not focusable" rather than as a button that would
   * resolve to nothing.
   */
  focusTargetId: string | null;
  /**
   * Where an ended scene continues (AC#5): the Episode for its world day, using the
   * `#episode/<worldId>/<worldDay>` shape the Episode list, arc and character pages already
   * link to. Null for an active scene -- the day it belongs to has not been narrated yet, so
   * the link would 404 into an empty Episode.
   */
  episodeHref: string | null;
}

export interface ActiveScenePanelModel {
  hasScenes: boolean;
  scenes: ActiveScenePanelItem[];
}

/**
 * The world day a scene belongs to, recovered from its `sceneId`.
 *
 * `sceneId` is `${worldDay}:${timeSlot}:${locationId}` by construction (see
 * `convex/publicRead/activeScenePresentation.ts`), so the day is already in the payload and
 * does not need its own field. Anything that does not parse as a leading non-negative
 * integer yields null, which costs the scene its Episode link and nothing else.
 */
export function sceneWorldDay(sceneId: string | undefined): number | null {
  if (sceneId === undefined) return null;
  const [day] = sceneId.split(':');
  const parsed = Number(day);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Compose the panel's display data.
 *
 * `worldId` is needed because the Episode deep link is world-scoped, and `footprints`
 * because a raw `locationId` is a slug -- showing "mistwood-hall" where the map says
 * "Town Hall" would make the panel and the map disagree about the same place.
 */
export function composeActiveScenePanel(input: {
  scenes: readonly ActiveSceneInput[];
  footprints: readonly MistwoodLocationFootprint[];
  worldId: string;
}): ActiveScenePanelModel {
  const nameById = new Map(input.footprints.map((footprint) => [footprint.id, footprint.name]));

  const scenes = input.scenes.map((scene, index) => {
    const ended = scene.status === 'ended';
    const worldDay = sceneWorldDay(scene.sceneId);
    const focusable = scene.sceneId !== undefined
      && scene.locationId !== undefined
      && nameById.has(scene.locationId);

    return {
      key: scene.sceneId ?? `scene-${index}`,
      title: scene.title,
      summary: scene.summary,
      locationLabel: scene.locationId === undefined
        ? null
        : (nameById.get(scene.locationId) ?? scene.locationId),
      participantCharacterIds: [...(scene.participantCharacterIds ?? [])],
      arcIds: [...(scene.arcIds ?? [])],
      ended,
      focusTargetId: focusable ? sceneTargetId(scene.sceneId as string) : null,
      episodeHref: ended && worldDay !== null
        ? `#episode/${encodeURIComponent(input.worldId)}/${worldDay}`
        : null,
    };
  });

  return { hasScenes: scenes.length > 0, scenes };
}
