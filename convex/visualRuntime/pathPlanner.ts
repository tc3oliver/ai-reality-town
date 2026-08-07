/**
 * Deterministic tile pathfinding for the Visual Runtime (FR-N010 / ART-114).
 *
 * A* over a 4-connected grid with a Manhattan heuristic, which is admissible and consistent
 * for unit step costs, so the first path found is optimal.
 *
 * Determinism is the hard requirement, not speed. Two A* runs over the same grid must produce
 * byte-identical paths or a re-derivation on another machine would move characters, so:
 *
 * - the open set is ordered by a *total* key — `f`, then `h`, then `y`, then `x` — and no two
 *   distinct tiles can tie on all four, which removes the usual "whichever equal node the heap
 *   happened to surface" nondeterminism;
 * - neighbours are expanded in a fixed order;
 * - the heap is written out here instead of imported. `convex/util/*` is not owned by any
 *   declared module, so the boundary checker cannot see an import into it; the only reliable
 *   way to keep this module's dependency surface honest is to have no such import at all.
 */

import type { TilePoint } from './motion';
import { isWalkableTile, type WalkableGrid } from './walkableGrid';

export type PathResult = {
  readonly found: boolean;
  /** Tile coordinates from start to goal inclusive. Empty when no route exists. */
  readonly tiles: readonly TilePoint[];
  /** How many nodes A* settled; exposed so a test can pin the budget behaviour. */
  readonly expandedNodes: number;
};

/** Fixed expansion order: east, west, south, north. */
const NEIGHBOUR_OFFSETS: readonly TilePoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function manhattanDistance(from: TilePoint, to: TilePoint): number {
  return Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
}

type OpenNode = {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly f: number;
  readonly h: number;
};

/** Lower sorts first on every component, so the comparison is a strict total order. */
function isBefore(left: OpenNode, right: OpenNode): boolean {
  if (left.f !== right.f) return left.f < right.f;
  if (left.h !== right.h) return left.h < right.h;
  if (left.y !== right.y) return left.y < right.y;
  return left.x < right.x;
}

class OpenSet {
  private readonly nodes: OpenNode[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: OpenNode): void {
    this.nodes.push(node);
    let child = this.nodes.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (!isBefore(this.nodes[child], this.nodes[parent])) break;
      this.swap(child, parent);
      child = parent;
    }
  }

  pop(): OpenNode {
    const top = this.nodes[0];
    const last = this.nodes.pop() as OpenNode;
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.nodes.length && isBefore(this.nodes[left], this.nodes[smallest])) smallest = left;
        if (right < this.nodes.length && isBefore(this.nodes[right], this.nodes[smallest])) smallest = right;
        if (smallest === parent) break;
        this.swap(parent, smallest);
        parent = smallest;
      }
    }
    return top;
  }

  private swap(first: number, second: number): void {
    const held = this.nodes[first];
    this.nodes[first] = this.nodes[second];
    this.nodes[second] = held;
  }
}

/**
 * A blocked start or goal returns "no route" rather than pathing out of a wall. Every anchor
 * the planner asks about is a walkable tile by binding construction, so reaching this branch
 * means the map and the bindings have diverged and the caller should degrade, not improvise.
 */
export function planTilePath(grid: WalkableGrid, start: TilePoint, goal: TilePoint): PathResult {
  if (!isWalkableTile(grid, start.x, start.y) || !isWalkableTile(grid, goal.x, goal.y)) {
    return { found: false, tiles: [], expandedNodes: 0 };
  }
  if (start.x === goal.x && start.y === goal.y) {
    return { found: true, tiles: [{ x: start.x, y: start.y }], expandedNodes: 0 };
  }

  const { width, height } = grid;
  const cellCount = width * height;
  const indexOf = (x: number, y: number): number => x * height + y;
  const gScore = new Float64Array(cellCount).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(cellCount).fill(-1);
  const settled = new Uint8Array(cellCount);

  const startIndex = indexOf(start.x, start.y);
  const goalIndex = indexOf(goal.x, goal.y);
  gScore[startIndex] = 0;

  const open = new OpenSet();
  open.push({
    index: startIndex,
    x: start.x,
    y: start.y,
    f: manhattanDistance(start, goal),
    h: manhattanDistance(start, goal),
  });

  // Every tile can be settled at most once, so this bound is reached only if the goal is
  // genuinely unreachable; it exists so a malformed grid cannot spin forever.
  const nodeBudget = cellCount;
  let expandedNodes = 0;

  while (open.size > 0 && expandedNodes < nodeBudget) {
    const current = open.pop();
    if (settled[current.index] === 1) continue;
    settled[current.index] = 1;
    expandedNodes++;

    if (current.index === goalIndex) {
      return { found: true, tiles: reconstruct(cameFrom, goalIndex, height), expandedNodes };
    }

    for (const offset of NEIGHBOUR_OFFSETS) {
      const x = current.x + offset.x;
      const y = current.y + offset.y;
      if (!isWalkableTile(grid, x, y)) continue;
      const neighbourIndex = indexOf(x, y);
      if (settled[neighbourIndex] === 1) continue;
      const tentative = gScore[current.index] + 1;
      if (tentative >= gScore[neighbourIndex]) continue;
      gScore[neighbourIndex] = tentative;
      cameFrom[neighbourIndex] = current.index;
      const h = Math.abs(goal.x - x) + Math.abs(goal.y - y);
      open.push({ index: neighbourIndex, x, y, f: tentative + h, h });
    }
  }

  return { found: false, tiles: [], expandedNodes };
}

function reconstruct(cameFrom: Int32Array, goalIndex: number, height: number): readonly TilePoint[] {
  const reversed: TilePoint[] = [];
  let index = goalIndex;
  while (index >= 0) {
    reversed.push({ x: Math.floor(index / height), y: index % height });
    index = cameFrom[index];
  }
  return reversed.reverse();
}

/**
 * Drops interior points of a straight run. A 4-connected path is mostly long axis-aligned
 * stretches, and the client interpolates between waypoints anyway, so publishing every tile
 * would be payload with no visual difference.
 */
export function compressCollinear(tiles: readonly TilePoint[]): readonly TilePoint[] {
  if (tiles.length <= 2) return tiles.map((tile) => ({ x: tile.x, y: tile.y }));
  const compressed: TilePoint[] = [{ x: tiles[0].x, y: tiles[0].y }];
  for (let index = 1; index < tiles.length - 1; index++) {
    const previous = tiles[index - 1];
    const current = tiles[index];
    const next = tiles[index + 1];
    const turned =
      (current.x - previous.x) * (next.y - current.y) !== (current.y - previous.y) * (next.x - current.x);
    if (turned) compressed.push({ x: current.x, y: current.y });
  }
  const last = tiles[tiles.length - 1];
  compressed.push({ x: last.x, y: last.y });
  return compressed;
}

/** Manhattan length along the route; the same metric the step cost and heuristic use. */
export function pathLengthTiles(points: readonly TilePoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    total += manhattanDistance(points[index - 1], points[index]);
  }
  return total;
}
