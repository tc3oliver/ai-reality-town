/**
 * Pure camera model for the live map (ART-118 / FR-O005).
 *
 * Every decision the camera makes -- where it looks, how far it is zoomed, how
 * long the move takes -- is computed here as a total function over plain data.
 * No DOM, no React, no Pixi, no clock: the module is unit-testable in the plain
 * `unit` Jest project and, more importantly, it is the only place the "runaway
 * zoom" and "reduced motion" guarantees (AC#6) have to hold.
 *
 * It is deliberately part of `src/components/world/`, the read-only renderer
 * module, because it produces nothing but view state. The affordances that let
 * a viewer *choose* a camera are DOM buttons in `src/components/live/`; putting
 * them here would mean re-introducing handlers into a module whose whole point
 * is that it has none (see `readOnlyWorldSurface.test.ts`).
 */

import type { MistwoodLocationFootprint } from '../../../data/mistwood';
import { latestMotionPerCharacter, motionProgress } from './worldViewModel';
import type { PublicCharacterMotion } from './worldViewModel';

/** Absolute floor, so a degenerate viewport can never produce a zero or negative scale. */
export const MIN_CAMERA_SCALE = 0.05;
/** Matches the viewport's `clampZoom` ceiling; a pixel-art tile is unreadable beyond it. */
export const MAX_CAMERA_SCALE = 3;
/** How much closer than "whole town" a focused target sits. */
export const FOCUS_ZOOM_MULTIPLIER = 2.5;
/** One press of zoom in / zoom out. */
export const ZOOM_STEP_FACTOR = 1.5;
export const MIN_ZOOM_STEP = -2;
export const MAX_ZOOM_STEP = 6;

export const CAMERA_MIN_TRANSITION_MS = 180;
export const CAMERA_MAX_TRANSITION_MS = 600;
const CAMERA_MS_PER_PIXEL = 0.35;

/** Screen and world size in pixels. */
export interface CameraViewport {
  screenWidth: number;
  screenHeight: number;
  worldWidth: number;
  worldHeight: number;
}

/** Where the camera looks. `transitionMs` of 0 means "snap", never "animate instantly". */
export interface CameraView {
  centerX: number;
  centerY: number;
  scale: number;
  transitionMs: number;
}

export type FocusTargetKind = 'town' | 'character' | 'location' | 'scene';

/**
 * The published active scene, as the camera reads it (FR-O003 / ART-122).
 *
 * Every field is optional because the payload's are: a projection persisted before ART-122,
 * or a scene whose events named no location, carries no `locationId`, and the camera's job
 * is to skip that scene rather than to point somewhere.
 */
export interface SceneFocusInput {
  sceneId?: string;
  locationId?: string;
  title?: string;
  status?: 'active' | 'ended';
}

export interface FocusTarget {
  kind: FocusTargetKind;
  /** Namespaced so a character and a location can share a bare id without colliding. */
  id: string;
  label: string;
  /** World pixel the camera centres on. */
  point: { x: number; y: number };
}

/**
 * The viewer's camera intent. Pure data: it is React state in
 * `components/live/LiveMapView.tsx` and travels no further than the browser.
 */
export interface CameraMode {
  /** AC#5: auto-follow of the primary scene, and the ability to turn it off. */
  follow: boolean;
  /** An explicit focus choice always beats auto-follow. `null` means "no explicit choice". */
  focusId: string | null;
  zoomStep: number;
}

/**
 * The focus-target namespace moved to `components/live/liveMapRoute.ts` with ART-130 (FR-P002)
 * and is re-exported here so every existing importer is unchanged.
 *
 * It had to move because `components/public` now builds `?focus=` links out of these ids, and
 * `clientPublic` may not depend on `clientWorldReadOnly` — the boundary check refused it, which
 * is the check doing its job. `clientLiveRoute` is the one module all three sides may depend on,
 * because it depends on nothing itself.
 */
export {
  TOWN_TARGET_ID,
  characterIdFromFocusTargetId,
  characterTargetId,
  locationTargetId,
  sceneTargetId,
} from '../live/liveMapRoute';
import {
  TOWN_TARGET_ID,
  characterTargetId,
  locationTargetId,
  sceneTargetId,
} from '../live/liveMapRoute';

export const TOWN_TARGET_LABEL = '全鎮視角';

/** The default camera: whole town, following the primary scene, no zoom offset. */
export const INITIAL_CAMERA_MODE: CameraMode = { follow: true, focusId: null, zoomStep: 0 };

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * The scale at which the whole world fits on screen. This is also the camera's
 * minimum scale: zooming out further would only add empty margin, and letting it
 * happen is how the inherited `setZoom(-10)` produced a mirrored, unusable frame.
 */
export function fitScale(viewport: CameraViewport): number {
  const { screenWidth, screenHeight, worldWidth, worldHeight } = viewport;
  const byWidth = finitePositive(screenWidth) && finitePositive(worldWidth)
    ? screenWidth / worldWidth
    : Number.POSITIVE_INFINITY;
  const byHeight = finitePositive(screenHeight) && finitePositive(worldHeight)
    ? screenHeight / worldHeight
    : Number.POSITIVE_INFINITY;
  const fit = Math.min(byWidth, byHeight);
  return finitePositive(fit) ? fit : MIN_CAMERA_SCALE;
}

/**
 * Total clamp (AC#6). NaN resolves to the lower bound, ±Infinity to the bound it
 * runs into, and an inverted or non-finite pair of bounds falls back to the
 * module constants rather than propagating garbage into `viewport.setZoom`.
 */
export function clampScale(value: number, min: number, max: number): number {
  const lower = finitePositive(min) ? min : MIN_CAMERA_SCALE;
  const upper = Number.isFinite(max) && max >= lower ? max : Math.max(lower, MAX_CAMERA_SCALE);
  if (Number.isNaN(value)) return lower;
  return Math.min(Math.max(value, lower), upper);
}

/** Keeps repeated presses of zoom in / zoom out from accumulating without effect. */
export function clampZoomStep(step: number): number {
  if (Number.isNaN(step)) return 0;
  return Math.min(Math.max(Math.round(step), MIN_ZOOM_STEP), MAX_ZOOM_STEP);
}

export function nextZoomStep(step: number, delta: number): number {
  return clampZoomStep(clampZoomStep(step) + delta);
}

/**
 * How long a camera move takes (AC#6).
 *
 * Reduced Motion returns 0, which the controller reads as "snap": no animation
 * is started at all, rather than one that runs very fast. A move of zero
 * distance also snaps, so a pure zoom change does not schedule a tween.
 */
export function cameraTransitionMs({
  reducedMotion,
  distancePx,
}: {
  reducedMotion: boolean;
  distancePx: number;
}): number {
  if (reducedMotion) return 0;
  if (Number.isNaN(distancePx) || distancePx <= 0) return 0;
  const ms = CAMERA_MIN_TRANSITION_MS + distancePx * CAMERA_MS_PER_PIXEL;
  return Math.min(Math.max(ms, CAMERA_MIN_TRANSITION_MS), CAMERA_MAX_TRANSITION_MS);
}

export function townView(viewport: CameraViewport): CameraView {
  return {
    centerX: viewport.worldWidth / 2,
    centerY: viewport.worldHeight / 2,
    scale: fitScale(viewport),
    transitionMs: 0,
  };
}

/** Tile rectangle -> the world pixel at its centre. */
function rectCenter(
  rect: { x: number; y: number; width: number; height: number },
  tileDim: number,
): { x: number; y: number } {
  return {
    x: (rect.x + rect.width / 2) * tileDim,
    y: (rect.y + rect.height / 2) * tileDim,
  };
}

/**
 * Every place the camera can be pointed at: the town, each Mistwood location,
 * each published character, and each published active scene.
 *
 * Characters are keyed by their latest motion, so a projection carrying an
 * in-flight walk plus the idle that follows it yields one target, not two.
 *
 * A scene resolves to the centre of its location's footprint -- the same point a
 * location target uses, because a scene *is* somewhere rather than being its own
 * geometry. A scene whose `locationId` matches no authored footprint is skipped
 * in silence: a target is a promise that pressing it shows you something, and
 * the alternative (centring at the origin) points the camera at the map's corner.
 */
export function focusTargetsFrom({
  motions,
  footprints,
  map,
  nowMs,
  scenes = [],
}: {
  motions: readonly PublicCharacterMotion[];
  footprints: readonly MistwoodLocationFootprint[];
  map: { width: number; height: number; tileDim: number };
  nowMs: number;
  scenes?: readonly SceneFocusInput[];
}): FocusTarget[] {
  const worldWidth = map.width * map.tileDim;
  const worldHeight = map.height * map.tileDim;
  const town: FocusTarget = {
    kind: 'town',
    id: TOWN_TARGET_ID,
    label: TOWN_TARGET_LABEL,
    point: { x: worldWidth / 2, y: worldHeight / 2 },
  };

  const locations = footprints.map<FocusTarget>((footprint) => ({
    kind: 'location',
    id: locationTargetId(footprint.id),
    label: footprint.name,
    point: rectCenter(footprint.rect, map.tileDim),
  }));

  const characters = latestMotionPerCharacter(motions)
    .map<FocusTarget>((motion) => {
      const progress = motionProgress(motion, nowMs);
      return {
        kind: 'character',
        id: characterTargetId(motion.characterId),
        label: motion.characterId,
        point: {
          x: (motion.from.x + (motion.to.x - motion.from.x) * progress) * map.tileDim,
          y: (motion.from.y + (motion.to.y - motion.from.y) * progress) * map.tileDim,
        },
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const footprintById = new Map(footprints.map((footprint) => [footprint.id, footprint]));
  const sceneTargets = scenes.flatMap<FocusTarget>((scene) => {
    if (scene.sceneId === undefined || scene.locationId === undefined) return [];
    const footprint = footprintById.get(scene.locationId);
    if (footprint === undefined) return [];
    return [{
      kind: 'scene',
      id: sceneTargetId(scene.sceneId),
      label: scene.title && scene.title.length > 0 ? scene.title : footprint.name,
      point: rectCenter(footprint.rect, map.tileDim),
    }];
  });

  return [town, ...locations, ...characters, ...sceneTargets];
}

/**
 * Where the published active scene is (FR-O003 / ART-122) -- what auto-follow
 * should actually point at.
 *
 * An `active` scene wins over an `ended` one, and the payload's own order decides
 * between two active scenes (the producer sorts them by descending latest Canon
 * sequence, so the first is the most recent activity). Returns null when no scene
 * resolves to a location, which is the caller's cue to fall back to
 * {@link primaryLocationId}.
 */
export function primarySceneLocationId(scenes: readonly SceneFocusInput[]): string | null {
  const placed = scenes.filter((scene) => scene.locationId !== undefined);
  const active = placed.find((scene) => scene.status === 'active');
  return (active ?? placed[0])?.locationId ?? null;
}

/**
 * The location the world's attention is on, inferred from where the characters
 * are: the location holding the most of them, ties broken by ascending
 * `locationId` so the result is deterministic.
 *
 * This was the stand-in for "the active scene" before FR-O003 published one, and
 * it remains the documented FALLBACK rather than dead code, because two real
 * cases still reach it: a world whose events name no location (so no scene is
 * placeable at all), and a last-known-good payload persisted before ART-122,
 * which carries scenes with no `locationId`. In both, guessing from character
 * density is better than pointing the camera at nothing. See
 * {@link primarySceneLocationId} for the preferred source.
 */
export function primaryLocationId(motions: readonly PublicCharacterMotion[]): string | null {
  const counts = new Map<string, number>();
  for (const motion of latestMotionPerCharacter(motions)) {
    counts.set(motion.semanticLocationId, (counts.get(motion.semanticLocationId) ?? 0) + 1);
  }
  let winner: string | null = null;
  let best = 0;
  for (const [locationId, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count > best) {
      winner = locationId;
      best = count;
    }
  }
  return winner;
}

/**
 * Which target the camera is pointed at, or `null` for the town view.
 *
 * An explicit focus wins over auto-follow, and a focus id that no longer
 * resolves (the character left the projection) degrades to the town view rather
 * than freezing the camera on a stale point.
 */
export function resolveFocusTarget({
  mode,
  targets,
  primaryLocationId: primary,
}: {
  mode: CameraMode;
  targets: readonly FocusTarget[];
  primaryLocationId: string | null;
}): FocusTarget | null {
  if (mode.focusId !== null) {
    return targets.find((target) => target.id === mode.focusId) ?? null;
  }
  if (mode.follow && primary !== null) {
    return targets.find((target) => target.id === locationTargetId(primary)) ?? null;
  }
  return null;
}

/**
 * The camera view a mode resolves to. Pure: the same inputs always yield the
 * same frame, which is what makes "auto-follow off ignores the primary scene"
 * (AC#5) and "transitions respect Reduced Motion" (AC#6) testable without a
 * browser.
 */
export function nextCamera({
  mode,
  targets,
  primaryLocationId: primary,
  viewport,
  reducedMotion,
  previous,
}: {
  mode: CameraMode;
  targets: readonly FocusTarget[];
  primaryLocationId: string | null;
  viewport: CameraViewport;
  reducedMotion: boolean;
  /** The frame currently on screen, or `null` for the first frame (which snaps). */
  previous: CameraView | null;
}): CameraView {
  const target = resolveFocusTarget({ mode, targets, primaryLocationId: primary });
  const fit = fitScale(viewport);
  const base = target === null ? fit : fit * FOCUS_ZOOM_MULTIPLIER;
  const scale = clampScale(base * ZOOM_STEP_FACTOR ** clampZoomStep(mode.zoomStep), fit, MAX_CAMERA_SCALE);
  const centerX = target === null ? viewport.worldWidth / 2 : target.point.x;
  const centerY = target === null ? viewport.worldHeight / 2 : target.point.y;
  const distancePx =
    previous === null ? 0 : Math.hypot(centerX - previous.centerX, centerY - previous.centerY);

  return { centerX, centerY, scale, transitionMs: cameraTransitionMs({ reducedMotion, distancePx }) };
}
