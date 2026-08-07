/**
 * The walkable surface the Visual Runtime plans over (FR-N010 / ART-114).
 *
 * The grid is a plain snapshot of a collision layer rather than a live view of the map module,
 * so the planner has no dependency on any particular map and a test can hand it a five-tile
 * corridor. `data/mistwood.ts` is bound to it in `mistwoodRuntime.ts`, nowhere else.
 */

import type { TilePoint } from './motion';

export type WalkableGrid = {
  readonly width: number;
  readonly height: number;
  /** `[x][y]`, `1` blocks movement and `0` is walkable — the layout `data/mistwood.ts` exports. */
  readonly collision: readonly (readonly number[])[];
};

/**
 * Width and height are read off the array rather than passed in, so a grid can never claim a
 * size its data does not have.
 */
export function createCollisionGrid(collision: readonly (readonly number[])[]): WalkableGrid {
  const width = collision.length;
  const height = width === 0 ? 0 : collision[0].length;
  return { width, height, collision };
}

/** Out of bounds is blocked, not an error: the planner treats the map edge as a wall. */
export function isWalkableTile(grid: WalkableGrid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return false;
  return grid.collision[x][y] === 0;
}

/** Where a character standing on a tile actually stands. */
export function tileCentre(tile: TilePoint): TilePoint {
  return { x: tile.x + 0.5, y: tile.y + 0.5 };
}

/** The tile a continuous point falls in. Anchors are tile centres, so this round-trips. */
export function tileOfPoint(point: TilePoint): TilePoint {
  return { x: Math.floor(point.x), y: Math.floor(point.y) };
}

export function isSameTile(first: TilePoint, second: TilePoint): boolean {
  return first.x === second.x && first.y === second.y;
}
