/**
 * Client-derived in-zone ambient drift (ART-120 / FR-O011).
 *
 * ## Why this is on the client at all
 *
 * Everything else the live map draws comes from the published projection. Ambient drift
 * cannot, and the reason is structural rather than a preference. `getPublicDynamicProjection`
 * serves a *stored* payload that is rebuilt when Canon commits — five accepted events a day,
 * so roughly one rebuild every 4.8 hours — and `commitReadModelVersion` deduplicates on a
 * `contentHash`. A minute-cadence ambient coordinate baked into that payload would change the
 * hash on every rebuild by construction, appending a spurious read-model version row per
 * minute (~1440 a day) for motion that means nothing. So the backend publishes only
 * *eligibility* (`motionType: 'ambient'`, from `visualSyncPlanner.ts`) and the drift is
 * re-derived here.
 *
 * ## Why that is still deterministic
 *
 * The derivation imports the Visual Runtime's own seeded primitives rather than
 * re-implementing them: `seededRandom.ts` (the FNV-1a hash, the bucket grid, the phase
 * offset), `ambientAnchor.ts` (the per-bucket anchor draw) and `motion.ts` (the speed
 * constant and the compass). Two viewers on opposite sides of the world, at the same instant,
 * with the same projection, therefore compute the same pose — AC#4 and AC#5 — and neither of
 * them wrote a coordinate anywhere to agree on it.
 *
 * Those three files are the *only* thing this module may import from `convex/`;
 * `ambientMotion.boundary.test.ts` enforces it, because `convex/visualRuntime/
 * mistwoodRuntime.ts` reaches the Canon seed's private character data and a wider import
 * would put it in the browser bundle.
 *
 * ## Why the walk cannot leave the zone
 *
 * Every ambient anchor is asserted inside its own zone polygon
 * (`locationVisualBinding.ts`'s `assertPointInZone`), and every zone polygon is asserted
 * convex (`isConvexPolygon`). A convex set contains the segment between any two of its
 * points, so the straight-line interpolation below is inside the zone for every value of
 * `nowMs` — AC#1, proved by geometry rather than by pathfinding.
 *
 * Known limitation, documented rather than hidden: that segment can cross a *blocked prop
 * tile* inside the zone (a table, a crate), so a character may briefly clip one. Mistwood's
 * zones are small and mostly open, so v1 accepts it; the upgrade path is a precomputed
 * in-zone route per anchor pair, noted in `docs/ambient-and-environmental-animation.md`.
 */

import {
  selectAmbientAnchorForBucket,
  type ZonePointLike,
} from '../../../convex/visualRuntime/ambientAnchor';
import {
  AMBIENT_SPEED_TILES_PER_SECOND,
  deriveDirection,
  type Direction,
} from '../../../convex/visualRuntime/motion';
import {
  ambientPhaseOffsetMs,
  ambientSeedValue,
  AMBIENT_BUCKET_DURATION_MS,
} from '../../../convex/visualRuntime/seededRandom';
// Type-only, and taken from the producer rather than from `./worldViewModel`, which imports
// this module back. Erased at compile time, so nothing here reaches the bundle.
import type {
  PublicCharacterMotion,
  PublicDirection,
} from '../../../convex/publicRead/publicDynamicProjection';

/**
 * Which published motion types permit in-zone drift.
 *
 * A superset of what the planner marks `ambient`, on purpose. `idle` is a seeded character
 * that has never moved: the planner keeps it distinct so "no accepted history" stays a
 * legible state, but to a viewer it is the same situation — a person standing inside a Canon
 * zone — and freezing the twelve founding residents until Canon first moved them would leave
 * the map dead on day one.
 */
const AMBIENT_ELIGIBLE_MOTION_TYPES: ReadonlySet<string> = new Set(['ambient', 'idle']);

/**
 * How much of a bucket a character may spend walking.
 *
 * The rest is standing still, which is the point: PRD 2.0 §9.1.2 permits activity that keeps
 * the town alive, not a town of people pacing. At 0.4 tiles/s a Mistwood anchor hop is
 * 10–17 seconds, so the cap only binds on the widest zones.
 */
const MAX_TRAVEL_FRACTION_OF_BUCKET = 0.4;

export type AmbientPose = {
  /** Tile coordinates, the same space the published motion uses. */
  readonly x: number;
  readonly y: number;
  readonly direction: PublicDirection;
  readonly isMoving: boolean;
};

export type AmbientPoseInput = {
  readonly motion: PublicCharacterMotion;
  /** The zone's standing positions, from `data/mistwoodAmbientAnchors.ts`. */
  readonly anchors: readonly ZonePointLike[] | undefined;
  /** The Canon day of the last accepted event, or `undefined` for a world with no history. */
  readonly worldDay: number | undefined;
  readonly nowMs: number;
  readonly reducedMotion: boolean;
};

/**
 * Eight compass points onto the four sprite facings.
 *
 * Mirrors `publicDynamicProjection.ts`'s `DIRECTION_MAP` rather than importing it: that module
 * transitively pulls the whole trajectory planner, and this one is deliberately confined to
 * three leaf files. `ambientMotion.test.ts` pins the two tables against each other so the
 * mirror cannot drift.
 */
export const SPRITE_FACING: Record<Direction, PublicDirection> = {
  north: 'up',
  'north-east': 'right',
  east: 'right',
  'south-east': 'right',
  south: 'down',
  'south-west': 'left',
  west: 'left',
  'north-west': 'left',
};

/** A standing character faces the camera; there is no "no direction" sprite. */
const RESTING_FACING: PublicDirection = 'down';

/**
 * Where in-zone drift has a character standing at `nowMs`, or `null` for "do not drift".
 *
 * The decision order is the contract, and each `null` is a different promise:
 *
 * 1. **Reduced Motion** (AC#8). First, so no later branch can leak motion past it.
 * 2. **Not eligible.** A `canon` or `replay` unit is a published fact being animated;
 *    overlaying drift on it would make the map say something Canon did not.
 * 3. **Still under way.** Even an eligible unit is left alone until `arriveAt`, so a real
 *    walk is never interrupted by ambient wandering at its own destination.
 * 4. **Fewer than two anchors.** Nowhere to drift between; the character stands where the
 *    projection put it rather than being teleported onto the single anchor.
 *
 * Past those, the pose is a pure function of the character, the zone, the Canon day and the
 * instant — nothing else, and no state carried between calls.
 */
export function deriveAmbientPose({
  motion,
  anchors,
  worldDay,
  nowMs,
  reducedMotion,
}: AmbientPoseInput): AmbientPose | null {
  if (reducedMotion) return null;
  if (!AMBIENT_ELIGIBLE_MOTION_TYPES.has(motion.motionType)) return null;
  if (nowMs < motion.arriveAt) return null;
  if (anchors === undefined || anchors.length < 2) return null;
  if (!Number.isFinite(nowMs)) return null;

  const characterId = motion.characterId;
  const locationId = motion.semanticLocationId;
  // A world with no accepted history has no Canon day. `0` is the seed the whole town shares
  // until its first event, which is consistent across viewers and is all the seed has to be.
  const day = worldDay ?? 0;

  const shifted = nowMs + ambientPhaseOffsetMs(characterId, locationId);
  const timeBucket = Math.floor(shifted / AMBIENT_BUCKET_DURATION_MS);
  const elapsedInBucket = shifted - timeBucket * AMBIENT_BUCKET_DURATION_MS;

  const seed = { characterId, locationId, worldDay: day, timeBucket };
  const from = selectAmbientAnchorForBucket(anchors, { ...seed, timeBucket: timeBucket - 1 });
  const to = selectAmbientAnchorForBucket(anchors, seed);

  const travelMs = ambientTravelMs(from, to);
  // When the character sets off inside its bucket. Hashed from all four seed components, so
  // it varies per bucket without disturbing the anchor order, and two residents sharing a
  // zone do not step off together.
  const startDelayMs = ambientSeedValue(seed) % Math.max(1, AMBIENT_BUCKET_DURATION_MS - travelMs);

  const progress = travelProgress(elapsedInBucket - startDelayMs, travelMs);
  const isMoving = progress > 0 && progress < 1;
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    direction: isMoving ? SPRITE_FACING[deriveDirection(from, to)] : RESTING_FACING,
    isMoving,
  };
}

/** Rounded to whole milliseconds so a duration never depends on float formatting. */
export function ambientTravelMs(from: ZonePointLike, to: ZonePointLike): number {
  const distanceTiles = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(distanceTiles > 0)) return 0;
  return Math.min(
    Math.round((distanceTiles / AMBIENT_SPEED_TILES_PER_SECOND) * 1000),
    Math.round(AMBIENT_BUCKET_DURATION_MS * MAX_TRAVEL_FRACTION_OF_BUCKET),
  );
}

/** Before the start delay the character waits at `from`; after the walk it waits at `to`. */
function travelProgress(elapsedMs: number, travelMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (travelMs <= 0 || elapsedMs >= travelMs) return 1;
  return elapsedMs / travelMs;
}
