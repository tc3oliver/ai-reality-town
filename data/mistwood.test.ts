import { mistwoodWorldConfiguration } from '../convex/canon/mistwoodSeed';
import {
  EMPTY_TILE,
  MISTWOOD_MAP_HEIGHT,
  MISTWOOD_MAP_WIDTH,
  MISTWOOD_TILESET_DIM_X,
  MISTWOOD_TILESET_DIM_Y,
  MISTWOOD_TILESET_URL,
  MISTWOOD_TILE_COUNT,
  MISTWOOD_TILE_DIM,
  mistwoodAnimatedSprites,
  mistwoodBgTiles,
  mistwoodCollision,
  mistwoodLocationFootprints,
  mistwoodObjectTiles,
  mistwoodRoadEdges,
  mistwoodWorldMap,
  type MistwoodRect,
} from './mistwood';

const allLayers = [...mistwoodBgTiles, ...mistwoodObjectTiles];

/** The seed's `connectedLocationIds` graph, deduplicated to undirected edges. */
function seedEdges(): string[][] {
  const edges = new Set<string>();
  for (const location of mistwoodWorldConfiguration.locations) {
    for (const target of location.connectedLocationIds) {
      edges.add([location.id, target].sort().join('|'));
    }
  }
  return [...edges].map((edge) => edge.split('|'));
}

function tilesIn(rect: MistwoodRect, layer: readonly (readonly number[])[]): number[] {
  const tiles: number[] = [];
  for (let x = rect.x; x < rect.x + rect.width; x++) {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      tiles.push(layer[x][y]);
    }
  }
  return tiles;
}

/**
 * Walks the collision layer from one location to another. Every other
 * location's footprint is treated as impassable, so this only succeeds when a
 * road joins the two locations directly rather than via a third one.
 */
function hasDirectRoute(fromId: string, toId: string): boolean {
  const byId = new Map(mistwoodLocationFootprints.map((f) => [f.id, f]));
  const from = byId.get(fromId)!;
  const to = byId.get(toId)!;
  const blocked = (x: number, y: number) =>
    mistwoodLocationFootprints.some(
      (f) =>
        f.id !== fromId &&
        f.id !== toId &&
        x >= f.rect.x &&
        x < f.rect.x + f.rect.width &&
        y >= f.rect.y &&
        y < f.rect.y + f.rect.height,
    );
  const inRect = (rect: MistwoodRect, x: number, y: number) =>
    x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

  const seen = new Set<number>();
  const queue: [number, number][] = [];
  for (let x = from.rect.x; x < from.rect.x + from.rect.width; x++) {
    for (let y = from.rect.y; y < from.rect.y + from.rect.height; y++) {
      if (mistwoodCollision[x][y] === 0) {
        queue.push([x, y]);
        seen.add(x * MISTWOOD_MAP_HEIGHT + y);
      }
    }
  }
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    if (inRect(to.rect, x, y)) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MISTWOOD_MAP_WIDTH || ny >= MISTWOOD_MAP_HEIGHT) continue;
      const key = nx * MISTWOOD_MAP_HEIGHT + ny;
      if (seen.has(key)) continue;
      if (mistwoodCollision[nx][ny] !== 0) continue;
      if (blocked(nx, ny)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return false;
}

describe('Mistwood tilemap renderer compatibility (FR-N009)', () => {
  it('matches the tileset spec the renderer indexes against', () => {
    // PixiStaticMap slices the tileset into `tileSetDimX / tileDim` columns and
    // looks tiles up as `tileX + tileY * columns`, so both dimensions have to
    // divide exactly or every index would be off.
    expect(MISTWOOD_TILESET_DIM_X % MISTWOOD_TILE_DIM).toBe(0);
    expect(MISTWOOD_TILESET_DIM_Y % MISTWOOD_TILE_DIM).toBe(0);
    expect(MISTWOOD_TILE_COUNT).toBe(45 * 32);
    expect(mistwoodWorldMap.tileDim).toBe(MISTWOOD_TILE_DIM);
    expect(mistwoodWorldMap.tileSetDimX).toBe(MISTWOOD_TILESET_DIM_X);
    expect(mistwoodWorldMap.tileSetDimY).toBe(MISTWOOD_TILESET_DIM_Y);
  });

  it('reports the dimensions PixiStaticMap derives from the layer shape', () => {
    expect(mistwoodWorldMap.bgTiles[0].length).toBe(MISTWOOD_MAP_WIDTH);
    expect(mistwoodWorldMap.bgTiles[0][0].length).toBe(MISTWOOD_MAP_HEIGHT);
    expect(mistwoodWorldMap.width).toBe(MISTWOOD_MAP_WIDTH);
    expect(mistwoodWorldMap.height).toBe(MISTWOOD_MAP_HEIGHT);
  });

  it('has background, object and collision layers of identical shape', () => {
    expect(mistwoodBgTiles.length).toBeGreaterThanOrEqual(1);
    expect(mistwoodObjectTiles.length).toBeGreaterThanOrEqual(1);
    for (const layer of [...allLayers, mistwoodCollision]) {
      expect(layer.length).toBe(MISTWOOD_MAP_WIDTH);
      for (const column of layer) {
        expect(column.length).toBe(MISTWOOD_MAP_HEIGHT);
      }
    }
  });

  it('only uses tile indices that exist in the tileset', () => {
    for (const layer of allLayers) {
      for (const column of layer) {
        for (const tile of column) {
          expect(Number.isInteger(tile)).toBe(true);
          if (tile !== EMPTY_TILE) {
            expect(tile).toBeGreaterThanOrEqual(0);
            expect(tile).toBeLessThan(MISTWOOD_TILE_COUNT);
          }
        }
      }
    }
  });

  it('paints ground everywhere so no tile renders as a hole', () => {
    for (const column of mistwoodBgTiles[0]) {
      for (const tile of column) {
        expect(tile).not.toBe(EMPTY_TILE);
      }
    }
  });

  it('marks every tile walkable or blocked', () => {
    for (const column of mistwoodCollision) {
      for (const cell of column) {
        expect([0, 1]).toContain(cell);
      }
    }
  });

  it('places animated sprites on approved sheets inside the map', () => {
    expect(mistwoodAnimatedSprites.length).toBeGreaterThan(0);
    for (const sprite of mistwoodAnimatedSprites) {
      expect(['windmill.json', 'gentlesplash.json']).toContain(sprite.sheet);
      expect(sprite.animation).toBe('pixels_large');
      expect(sprite.x).toBeGreaterThanOrEqual(0);
      expect(sprite.y).toBeGreaterThanOrEqual(0);
      expect(sprite.x + sprite.w).toBeLessThanOrEqual(MISTWOOD_MAP_WIDTH * MISTWOOD_TILE_DIM);
      expect(sprite.y + sprite.h).toBeLessThanOrEqual(MISTWOOD_MAP_HEIGHT * MISTWOOD_TILE_DIM);
    }
  });
});

describe('Mistwood tilemap uses only the existing tileset (FR-N008)', () => {
  it('draws from the approved gentle-obj tileset and nothing else', () => {
    expect(MISTWOOD_TILESET_URL).toBe('/ai-town/assets/gentle-obj.png');
    expect(mistwoodWorldMap.tileSetUrl).toBe(MISTWOOD_TILESET_URL);
  });
});

describe('Mistwood tilemap represents the canonical town (FR-N009)', () => {
  const seedLocations = mistwoodWorldConfiguration.locations;

  it('covers exactly the eight canonical seed locations', () => {
    expect(mistwoodLocationFootprints.map((f) => f.id).sort()).toEqual(
      seedLocations.map((l) => l.id).sort(),
    );
    for (const footprint of mistwoodLocationFootprints) {
      const seed = seedLocations.find((l) => l.id === footprint.id)!;
      expect(footprint.name).toBe(seed.name);
    }
  });

  it('keeps every location inside the map and clear of the others', () => {
    for (const { rect } of mistwoodLocationFootprints) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(MISTWOOD_MAP_WIDTH);
      expect(rect.y + rect.height).toBeLessThanOrEqual(MISTWOOD_MAP_HEIGHT);
    }
    for (const a of mistwoodLocationFootprints) {
      for (const b of mistwoodLocationFootprints) {
        if (a.id >= b.id) continue;
        const overlaps =
          a.rect.x < b.rect.x + b.rect.width &&
          b.rect.x < a.rect.x + a.rect.width &&
          a.rect.y < b.rect.y + b.rect.height &&
          b.rect.y < a.rect.y + a.rect.height;
        expect(`${a.id}/${b.id} overlap: ${overlaps}`).toBe(`${a.id}/${b.id} overlap: false`);
      }
    }
  });

  it('builds every location, not just bare ground', () => {
    for (const { id, rect } of mistwoodLocationFootprints) {
      const structures = tilesIn(rect, mistwoodObjectTiles[0]).filter((t) => t !== EMPTY_TILE);
      const walkable = tilesIn(rect, mistwoodCollision).filter((c) => c === 0);
      expect(`${id} structures: ${structures.length > 0}`).toBe(`${id} structures: true`);
      expect(`${id} walkable: ${walkable.length > 0}`).toBe(`${id} walkable: true`);
    }
  });

  it('gives each location its own ground and prop vocabulary', () => {
    // This is what stops the map degenerating back into the generic a16z
    // layout, where several distinct locations would resolve to the same
    // anonymous patch of grass.
    const signatures = mistwoodLocationFootprints.map(({ id, rect }) => {
      const ground = new Set(tilesIn(rect, mistwoodBgTiles[0]));
      const structures = new Set(
        tilesIn(rect, mistwoodObjectTiles[0]).filter((t) => t !== EMPTY_TILE),
      );
      const props = new Set(tilesIn(rect, mistwoodObjectTiles[1]).filter((t) => t !== EMPTY_TILE));
      return { id, key: [...structures, ...props].sort((a, b) => a - b).join(','), ground };
    });
    for (const a of signatures) {
      for (const b of signatures) {
        if (a.id >= b.id) continue;
        expect(`${a.id}/${b.id} identical: ${a.key === b.key}`).toBe(
          `${a.id}/${b.id} identical: false`,
        );
      }
    }
  });
});

describe('Mistwood tilemap roads follow the seed graph (FR-N009)', () => {
  const edges = seedEdges();

  it('declares one road per connectedLocationIds edge', () => {
    const declared = mistwoodRoadEdges.map((edge) => [...edge].sort().join('|')).sort();
    expect(declared).toEqual(edges.map((edge) => edge.join('|')).sort());
  });

  it.each(edges)('joins %s to %s by a walkable route', (from, to) => {
    expect(`${from}->${to}: ${hasDirectRoute(from, to)}`).toBe(`${from}->${to}: true`);
    expect(`${to}->${from}: ${hasDirectRoute(to, from)}`).toBe(`${to}->${from}: true`);
  });
});
