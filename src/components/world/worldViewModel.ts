/**
 * Read-only world view model (ART-113 / FR-N002).
 *
 * Everything the Pixi shell needs to draw a frame is computed here, as pure
 * functions over data the public read model already publishes. The renderer
 * itself owns no state, issues no query and can reach no write API, so the
 * whole "what does the world look like right now" decision is unit-testable
 * without a DOM, a Pixi application or a Convex client.
 *
 * The character input is shaped as PRD 2.0 §10.4 `PublicCharacterMotion`, the
 * unit that FR-N003 (ART-115) will publish. Producing that motion data is
 * explicitly *not* this task -- this module only consumes it, which is the
 * split PRD 2.0 §10.4 describes: "前端依 `startedAt`、`arriveAt` 與
 * `motionSequence` 進行插值及動畫播放". Until FR-N003 lands, callers pass an
 * empty motion list and the shell renders the map alone.
 */

// Type-only imports: erased at compile time, so this module pulls in neither
// pixi.js nor the DOM and stays runnable in the plain-Node unit test project.
import type { ISpritesheetData } from 'pixi.js';

import type { SerializedWorldMap } from '../../../convex/aiTown/worldMap';

// Re-exported from the producer rather than redeclared, so consumer and publisher cannot
// drift apart. FR-N003 (ART-115) publishes exactly these types.
export type {
  PublicAnimationState,
  PublicCharacterMotion,
  PublicDirection,
  PublicMotionType,
  PublicPoint,
} from '../../../convex/publicRead/publicDynamicProjection';

import type {
  PublicAnimationState,
  PublicCharacterMotion,
  PublicDirection,
  PublicMotionType,
  PublicPoint,
} from '../../../convex/publicRead/publicDynamicProjection';

/**
 * The sprite sheet a character draws with. Resolved by the caller from the
 * FR-N004 character visual binding (ART-111) so the renderer stays a pure
 * consumer of already-bound assets.
 */
export interface ReadOnlySpriteAsset {
  textureUrl: string;
  spritesheetData: ISpritesheetData;
}

/** One character, already resolved to the pixel pose the renderer draws. */
export interface ReadOnlyWorldCharacter {
  characterId: string;
  spriteKey: string;
  /**
   * Where the character *is*, as Canon sees it.
   *
   * Carried through unchanged from the projection and never derived from
   * `nowMs`, which is what makes FR-O002 AC#7 hold: the animation clock can tick
   * at 60Hz or at 1Hz and this field is the same either way. Only `x`/`y` are
   * clock-derived.
   */
  semanticLocationId: string;
  /** Pixel position on the map canvas. */
  x: number;
  y: number;
  /** Degrees, in the `right/down/left/up` order the sprite sheets are packed in. */
  orientation: number;
  /**
   * The published state, forwarded rather than flattened into booleans.
   *
   * Two of the five are produced today (`idle` and `walking`, the only values
   * `convex/visualRuntime/motion.ts` can emit); `speaking`, `thinking` and
   * `activity` render but stay dormant until FR-O004 (ART-123) produces them.
   * Keeping the union means the renderer's mapping is total by construction.
   */
  animationState: PublicAnimationState;
  /**
   * Why the character is where it is. `ambient` (FR-O011) and `replay` (FR-O013)
   * are forwarded but not yet produced, and this task renders them identically
   * to `canon` on purpose.
   */
  motionType: PublicMotionType;
  /** Walking *and* still under way, so an arrived walk stops its animation. */
  isMoving: boolean;
}

export interface ReadOnlyWorldViewModel {
  map: SerializedWorldMap;
  /** Map size in pixels, for viewport clamping. */
  worldWidth: number;
  worldHeight: number;
  characters: ReadOnlyWorldCharacter[];
}

/** `Character` reads `['right', 'down', 'left', 'up'][orientation / 90]`. */
const ORIENTATION_DEGREES: Record<PublicDirection, number> = {
  right: 0,
  down: 90,
  left: 180,
  up: 270,
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Fraction of the way from `from` to `to` at `nowMs`.
 *
 * A motion whose window has not opened yet sits at its origin, a finished or
 * zero-length motion sits at its destination, and anything in between is
 * linear. Never extrapolates past either end, so a stale projection can only
 * ever park a character at a published position -- it cannot walk one off the
 * map while the backend is down.
 */
export function motionProgress(motion: PublicCharacterMotion, nowMs: number): number {
  if (motion.arriveAt <= motion.startedAt) return 1;
  return clamp((nowMs - motion.startedAt) / (motion.arriveAt - motion.startedAt), 0, 1);
}

/**
 * Where a motion has the character standing at `nowMs`, in tile coordinates.
 *
 * Tile coordinates, not pixels: an anchor is a tile *centre* (`tile + 0.5`, see
 * `convex/visualRuntime/motion.ts`), and rounding that to pixels is the
 * renderer's job, not the interpolator's.
 *
 * A straight line between `from` and `to`. The planner's collision-aware route
 * is deliberately not published — `waypoints` would leak the shape of the
 * collision layer — so the client walks the chord of a path whose *duration* was
 * computed from the real route. See `docs/character-motion-rendering.md`.
 */
export function interpolatedTile(motion: PublicCharacterMotion, nowMs: number): PublicPoint {
  const progress = motionProgress(motion, nowMs);
  return {
    x: motion.from.x + (motion.to.x - motion.from.x) * progress,
    y: motion.from.y + (motion.to.y - motion.from.y) * progress,
  };
}

/** Tolerance for "on the segment", in tiles. Well under a pixel at 32px tiles. */
const SEGMENT_EPSILON = 1e-9;

/**
 * Whether `point` lies on the closed segment from `motion.from` to `motion.to`.
 *
 * The predicate behind AC#6 ("characters never teleport"): a sampled position
 * that satisfies this at every tick cannot have jumped off the published route,
 * whatever rate the clock ran at. A zero-length motion degenerates to "is this
 * the one legal point", which is the correct answer for a standing character.
 */
export function isWithinSegment(motion: PublicCharacterMotion, point: PublicPoint): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const dx = motion.to.x - motion.from.x;
  const dy = motion.to.y - motion.from.y;
  const px = point.x - motion.from.x;
  const py = point.y - motion.from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.abs(px) <= SEGMENT_EPSILON && Math.abs(py) <= SEGMENT_EPSILON;
  }
  // Off-axis distance first, then the parameter along the segment: a point can
  // be the right distance along and still be beside the line.
  const cross = px * dy - py * dx;
  if (Math.abs(cross) > SEGMENT_EPSILON * Math.sqrt(lengthSquared)) return false;
  const along = (px * dx + py * dy) / lengthSquared;
  return along >= -SEGMENT_EPSILON && along <= 1 + SEGMENT_EPSILON;
}

/**
 * Latest motion per character. A projection may carry several units for one
 * character (for example an in-flight walk plus the idle that follows it); the
 * highest `motionSequence` wins so the render order cannot depend on array
 * order. Ties keep the first entry, which keeps the function total.
 */
export function latestMotionPerCharacter(
  motions: readonly PublicCharacterMotion[],
): PublicCharacterMotion[] {
  const latest = new Map<string, PublicCharacterMotion>();
  for (const motion of motions) {
    const previous = latest.get(motion.characterId);
    if (previous === undefined || motion.motionSequence > previous.motionSequence) {
      latest.set(motion.characterId, motion);
    }
  }
  return [...latest.values()];
}

export function composeReadOnlyWorldViewModel({
  map,
  motions,
  spriteKeys,
  nowMs,
}: {
  map: SerializedWorldMap;
  /** Published motion units. Empty until FR-N003 publishes them. */
  motions: readonly PublicCharacterMotion[];
  /** `characterId -> spriteKey`, from the FR-N004 visual binding. */
  spriteKeys: Readonly<Record<string, string>>;
  nowMs: number;
}): ReadOnlyWorldViewModel {
  const characters = latestMotionPerCharacter(motions)
    // A character with no visual binding is dropped rather than drawn with a
    // guessed sprite: FR-N004 AC#6 wants unbound characters rejected, not
    // silently reskinned.
    .filter((motion) => spriteKeys[motion.characterId] !== undefined)
    .map((motion) => {
      const tile = interpolatedTile(motion, nowMs);
      // Bound by the map's tile *count*, not by its last tile index: a character
      // stands at a tile centre, so the rightmost legal anchor on a 48-wide map
      // is 47.5. Clamping to 47 silently shoved every character on the last
      // column half a tile inwards.
      const tileX = clamp(tile.x, 0, Math.max(map.width, 0));
      const tileY = clamp(tile.y, 0, Math.max(map.height, 0));
      return {
        characterId: motion.characterId,
        spriteKey: spriteKeys[motion.characterId],
        semanticLocationId: motion.semanticLocationId,
        x: tileX * map.tileDim,
        y: tileY * map.tileDim,
        orientation: ORIENTATION_DEGREES[motion.direction],
        animationState: motion.animationState,
        motionType: motion.motionType,
        isMoving: motion.animationState === 'walking' && motionProgress(motion, nowMs) < 1,
      };
    })
    // Painter's order: lower on the map draws in front. `characterId` breaks
    // ties so two characters standing on the same row never flicker between
    // frames.
    .sort((a, b) => a.y - b.y || a.characterId.localeCompare(b.characterId));

  return {
    map,
    worldWidth: map.width * map.tileDim,
    worldHeight: map.height * map.tileDim,
    characters,
  };
}
