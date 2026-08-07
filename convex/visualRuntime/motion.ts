/**
 * Visual Runtime motion contract (FR-N010 / ART-114).
 *
 * Canon says *where* a character is in semantic terms; this module's types say what the
 * viewer draws for that fact. Everything here is plain data with no Convex, clock or
 * randomness dependency, so a trajectory can be recomputed from the same inputs on any
 * machine and produce the same bytes.
 *
 * Coordinates are map tile coordinates, the same space as `convex/visual/locationVisualBinding.ts`
 * and `data/mistwood.ts`: tile `(tx, ty)` covers `(tx, ty)`–`(tx + 1, ty + 1)`, and a character
 * standing on it sits at its centre `(tx + 0.5, ty + 0.5)`. Pixels belong to the renderer.
 */

export type TilePoint = {
  readonly x: number;
  readonly y: number;
};

/**
 * Why a trajectory exists at all. `bootstrap` is a seeded character that has no accepted
 * event yet; `canon` is a `character_location_changed` fact still under way; `ambient`
 * (FR-O011 / ART-120) is a character that has arrived and is therefore eligible for in-zone
 * drift; `replay` is historical playback (ART-121), declared but not yet produced so that
 * task widens the consumer contract rather than redefining it.
 */
export type MotionType = 'bootstrap' | 'canon' | 'ambient' | 'replay';

export type AnimationState = 'idle' | 'walking';

/** Where the character is in the life of its current motion, as of the planning instant. */
export type MovementPhase = 'bootstrap' | 'in-transit' | 'arrived';

export type Direction =
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'
  | 'north-west';

/**
 * A point on the planned route with the instant the character reaches it. The client
 * interpolates between waypoints (FR-O002); it never asks the backend for a per-frame
 * position, which is what keeps coordinates out of the write path entirely.
 */
export type TrajectoryWaypoint = {
  readonly point: TilePoint;
  readonly arriveAt: number;
};

/**
 * Tiles per second. Slow on purpose: a Mistwood cross-town walk should read as a journey
 * the viewer can follow, not a teleport, and the whole map is only 48x36 tiles.
 */
export const MOVEMENT_SPEED_TILES_PER_SECOND = 0.75;

/**
 * Tiles per second for in-zone ambient drift (FR-O011 / ART-120).
 *
 * Slower than {@link MOVEMENT_SPEED_TILES_PER_SECOND} on purpose, and that gap is one of the
 * four signals AC#6 rests on: a character crossing town on an accepted Canon fact is going
 * somewhere, and a character pottering about inside its own zone is not. Nothing published
 * distinguishes the two at a glance, so the difference has to be legible in the motion
 * itself. Kept as a plain constant rather than a ratio of the Canon speed so a future tuning
 * pass can move either one without silently dragging the other with it.
 */
export const AMBIENT_SPEED_TILES_PER_SECOND = 0.4;

/**
 * Exactly one of these is published per living character per planning pass. Two units for
 * one character would let the viewer see the same person in two places, so the planner
 * treats "one trajectory per character" as an invariant rather than a convention.
 */
export type MovementTrajectory = {
  readonly characterId: string;
  /** Geometry is meaningless across map versions, so the map is part of the payload. */
  readonly mapId: string;
  readonly motionType: MotionType;
  readonly movementPhase: MovementPhase;
  readonly from: TilePoint;
  readonly to: TilePoint;
  readonly startedAt: number;
  readonly arriveAt: number;
  readonly direction: Direction;
  readonly animationState: AnimationState;
  /**
   * Monotonic per character. Derived from the source event's sequence number rather than a
   * counter, so re-deriving an older prefix of history can never hand a client a higher
   * sequence than the one it already holds.
   */
  readonly motionSequence: number;
  /** The Canon location this motion ends at. */
  readonly semanticLocationId: string;
  /** The Canon location it started from, or `null` for a bootstrap position. */
  readonly originLocationId: string | null;
  readonly waypoints: readonly TrajectoryWaypoint[];
  /** The accepted Canon events this motion was derived from; empty for a bootstrap. */
  readonly sourceEventIds: readonly string[];
};

/**
 * Every way the runtime can fail to draw something, as a value rather than a bare type
 * union. Downstream modules that persist or aggregate these (ART-133's metric registry)
 * build their own contracts from this array, so adding a code here propagates instead of
 * being silently ignored by a hand-copied list.
 *
 * - `VISUAL_RUNTIME_UNBOUND_LOCATION` — a Canon location with no active Location Visual
 *   Binding cannot be drawn at all.
 * - `VISUAL_RUNTIME_NO_PATH` — the collision layer offers no walkable route, so the walk
 *   was degraded, not faked.
 * - `VISUAL_RUNTIME_UNBOUND_CHARACTER` — the character has a position but no sprite, so
 *   the renderer has nothing to put there. Detected separately from planning; see
 *   `./characterBindings.ts`.
 */
export const VISUAL_RUNTIME_PROBLEM_CODES = [
  'VISUAL_RUNTIME_UNBOUND_LOCATION',
  'VISUAL_RUNTIME_NO_PATH',
  'VISUAL_RUNTIME_UNBOUND_CHARACTER',
] as const;

export type VisualRuntimeProblemCode = (typeof VISUAL_RUNTIME_PROBLEM_CODES)[number];

export type VisualRuntimeProblem = {
  readonly code: VisualRuntimeProblemCode;
  readonly characterId: string;
  readonly locationId: string;
  readonly message: string;
};

/**
 * The complete result of one planning pass. Problems are returned rather than thrown: one
 * unbound location must not stop the other eleven residents from being drawn.
 */
export type VisualRuntimeSnapshot = {
  readonly mapId: string;
  readonly generatedAtMs: number;
  readonly trajectories: readonly MovementTrajectory[];
  readonly problems: readonly VisualRuntimeProblem[];
};

/** A character standing still faces the camera; there is no "no direction" sprite. */
export const IDLE_DIRECTION: Direction = 'south';

/**
 * tan(22.5°). Splitting the compass into eight equal 45° sectors puts the boundary between
 * "east" and "north-east" here. Comparing against a multiplication rather than calling
 * `Math.atan2` keeps the result bit-identical across JS engines, which `atan2` does not
 * guarantee.
 */
const OCTANT_TANGENT = 0.41421356237309503;

/** `y` grows downwards, the same as the tile layers, so a positive `dy` faces south. */
export function deriveDirection(from: TilePoint, to: TilePoint): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return IDLE_DIRECTION;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay <= ax * OCTANT_TANGENT) return dx > 0 ? 'east' : 'west';
  if (ax <= ay * OCTANT_TANGENT) return dy > 0 ? 'south' : 'north';
  if (dx > 0) return dy > 0 ? 'south-east' : 'north-east';
  return dy > 0 ? 'south-west' : 'north-west';
}

/** Rounded to whole milliseconds so a duration never depends on float formatting. */
export function travelDurationMs(distanceTiles: number): number {
  if (!(distanceTiles > 0)) return 0;
  return Math.round((distanceTiles / MOVEMENT_SPEED_TILES_PER_SECOND) * 1000);
}
