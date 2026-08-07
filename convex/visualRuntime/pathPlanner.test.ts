import {
  compressCollinear,
  manhattanDistance,
  pathLengthTiles,
  planTilePath,
} from './pathPlanner';
import { createCollisionGrid, isWalkableTile, type WalkableGrid } from './walkableGrid';

/** Builds a `[x][y]` collision layer from a row-major picture, `#` blocked and `.` walkable. */
function gridFrom(rows: readonly string[]): WalkableGrid {
  const height = rows.length;
  const width = rows[0].length;
  const collision = Array.from({ length: width }, (_column, x) =>
    Array.from({ length: height }, (_cell, y) => (rows[y][x] === '#' ? 1 : 0)),
  );
  return createCollisionGrid(collision);
}

const openField = gridFrom([
  '.....',
  '.....',
  '.....',
]);

const wallWithDoor = gridFrom([
  '..#..',
  '..#..',
  '.....',
  '..#..',
]);

const sealedRoom = gridFrom([
  '.....',
  '.###.',
  '.#.#.',
  '.###.',
]);

describe('FR-N010 deterministic path planning', () => {
  it('finds a shortest route across open ground', () => {
    const result = planTilePath(openField, { x: 0, y: 0 }, { x: 4, y: 2 });
    expect(result.found).toBe(true);
    expect(pathLengthTiles(result.tiles)).toBe(manhattanDistance({ x: 0, y: 0 }, { x: 4, y: 2 }));
    expect(result.tiles[0]).toEqual({ x: 0, y: 0 });
    expect(result.tiles[result.tiles.length - 1]).toEqual({ x: 4, y: 2 });
  });

  it('returns a single tile for a route that goes nowhere', () => {
    const result = planTilePath(openField, { x: 2, y: 1 }, { x: 2, y: 1 });
    expect(result).toEqual({ found: true, tiles: [{ x: 2, y: 1 }], expandedNodes: 0 });
  });

  it('detours around an obstacle through the only gap', () => {
    const result = planTilePath(wallWithDoor, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(result.found).toBe(true);
    expect(result.tiles).toContainEqual({ x: 2, y: 2 });
    expect(pathLengthTiles(result.tiles)).toBeGreaterThan(
      manhattanDistance({ x: 0, y: 0 }, { x: 4, y: 0 }),
    );
  });

  it('never steps on a blocked tile', () => {
    const result = planTilePath(wallWithDoor, { x: 0, y: 0 }, { x: 4, y: 3 });
    expect(result.found).toBe(true);
    for (const tile of result.tiles) expect(isWalkableTile(wallWithDoor, tile.x, tile.y)).toBe(true);
  });

  it('only ever takes single orthogonal steps', () => {
    const result = planTilePath(wallWithDoor, { x: 0, y: 0 }, { x: 4, y: 3 });
    for (let index = 1; index < result.tiles.length; index++) {
      expect(manhattanDistance(result.tiles[index - 1], result.tiles[index])).toBe(1);
    }
  });

  it('reports no route to a sealed area instead of walking through the wall', () => {
    const result = planTilePath(sealedRoom, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(result.found).toBe(false);
    expect(result.tiles).toEqual([]);
  });

  it('reports no route when either endpoint is itself blocked', () => {
    expect(planTilePath(wallWithDoor, { x: 2, y: 0 }, { x: 0, y: 0 }).found).toBe(false);
    expect(planTilePath(wallWithDoor, { x: 0, y: 0 }, { x: 2, y: 0 }).found).toBe(false);
    expect(planTilePath(openField, { x: 0, y: 0 }, { x: 99, y: 99 }).found).toBe(false);
  });

  it('settles no more nodes than the grid holds, even when the goal is unreachable', () => {
    const result = planTilePath(sealedRoom, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(result.expandedNodes).toBeLessThanOrEqual(sealedRoom.width * sealedRoom.height);
  });

  it('produces byte-identical paths across runs, which is what stops characters drifting', () => {
    const expected = JSON.stringify(planTilePath(wallWithDoor, { x: 0, y: 0 }, { x: 4, y: 3 }));
    for (let run = 0; run < 25; run++) {
      expect(JSON.stringify(planTilePath(wallWithDoor, { x: 0, y: 0 }, { x: 4, y: 3 }))).toBe(expected);
    }
  });

  it('breaks ties the same way regardless of which equal-cost route it met first', () => {
    // Two symmetric shortest routes exist across open ground; the total ordering must pick one.
    const first = planTilePath(openField, { x: 0, y: 0 }, { x: 2, y: 2 });
    const second = planTilePath(createCollisionGrid(openField.collision), { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(first.tiles).toEqual(second.tiles);
  });
});

describe('FR-N010 path compression', () => {
  it('keeps only the corners of a straight run', () => {
    expect(
      compressCollinear([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]);
  });

  it('is idempotent', () => {
    const path = planTilePath(wallWithDoor, { x: 0, y: 0 }, { x: 4, y: 3 }).tiles;
    const once = compressCollinear(path);
    expect(compressCollinear(once)).toEqual(once);
  });

  it('preserves the endpoints and the travelled distance', () => {
    const path = planTilePath(wallWithDoor, { x: 0, y: 0 }, { x: 4, y: 3 }).tiles;
    const compressed = compressCollinear(path);
    expect(compressed[0]).toEqual(path[0]);
    expect(compressed[compressed.length - 1]).toEqual(path[path.length - 1]);
    expect(pathLengthTiles(compressed)).toBe(pathLengthTiles(path));
  });

  it('leaves short paths alone', () => {
    expect(compressCollinear([])).toEqual([]);
    expect(compressCollinear([{ x: 3, y: 4 }])).toEqual([{ x: 3, y: 4 }]);
  });
});
