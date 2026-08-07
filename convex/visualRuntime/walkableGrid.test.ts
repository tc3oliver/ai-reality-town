import { createCollisionGrid, isSameTile, isWalkableTile, tileCentre, tileOfPoint } from './walkableGrid';

/** `[x][y]`: three columns of two rows. Column 1 is a wall. */
const collision = [
  [0, 0],
  [1, 1],
  [0, 0],
];

describe('FR-N010 walkable grid', () => {
  it('reads its dimensions from the collision data itself', () => {
    const grid = createCollisionGrid(collision);
    expect(grid.width).toBe(3);
    expect(grid.height).toBe(2);
  });

  it('indexes [x][y], not [y][x]', () => {
    const grid = createCollisionGrid(collision);
    expect(isWalkableTile(grid, 0, 1)).toBe(true);
    expect(isWalkableTile(grid, 1, 0)).toBe(false);
  });

  it('treats everything outside the map as blocked', () => {
    const grid = createCollisionGrid(collision);
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [3, 0],
      [0, 2],
      [99, 99],
    ]) {
      expect(isWalkableTile(grid, x, y)).toBe(false);
    }
  });

  it('handles an empty grid without inventing a size', () => {
    const grid = createCollisionGrid([]);
    expect(grid).toMatchObject({ width: 0, height: 0 });
    expect(isWalkableTile(grid, 0, 0)).toBe(false);
  });

  it('places a character at the centre of the tile it stands on', () => {
    expect(tileCentre({ x: 4, y: 7 })).toEqual({ x: 4.5, y: 7.5 });
    expect(tileCentre({ x: 0, y: 0 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('round-trips a tile centre back to its tile', () => {
    for (const tile of [
      { x: 0, y: 0 },
      { x: 12, y: 30 },
      { x: 47, y: 35 },
    ]) {
      expect(tileOfPoint(tileCentre(tile))).toEqual(tile);
    }
  });

  it('resolves any point inside a tile to that tile', () => {
    expect(tileOfPoint({ x: 4.0, y: 7.99 })).toEqual({ x: 4, y: 7 });
    expect(tileOfPoint({ x: 4.99, y: 7.0 })).toEqual({ x: 4, y: 7 });
  });

  it('compares tiles by value', () => {
    expect(isSameTile({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(isSameTile({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(false);
  });
});
