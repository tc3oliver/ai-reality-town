// Mistwood tilemap (FR-N009 / ART-109).
//
// Built entirely from the existing approved tileset `public/assets/gentle-obj.png`
// (the same one `data/gentle.js` uses); no new art asset is introduced. The tile
// indices below are positions in that tileset, `index = tileX + tileY * 45`.
//
// The inherited a16z map is a generic forest demo with no relationship to the
// eight canonical Mistwood locations in `convex/canon/mistwoodSeed.ts`, so this
// module reassembles the same tiles into a Mistwood-specific town: each location
// gets its own ground material and prop vocabulary, and the roads between them
// reproduce the seed's `connectedLocationIds` graph.
//
// Layers are `layer[x][y]`, `-1` meaning "no tile here", matching the
// `SerializedWorldMap` contract consumed by `src/components/world/PixiStaticMap.tsx`.

import type { AnimatedSprite, SerializedWorldMap } from '../convex/aiTown/worldMap';

export const MISTWOOD_TILE_DIM = 32;
export const MISTWOOD_TILESET_URL = '/ai-town/assets/gentle-obj.png';
export const MISTWOOD_TILESET_DIM_X = 1440;
export const MISTWOOD_TILESET_DIM_Y = 1024;
export const MISTWOOD_MAP_WIDTH = 48;
export const MISTWOOD_MAP_HEIGHT = 36;

const TILESET_COLUMNS = MISTWOOD_TILESET_DIM_X / MISTWOOD_TILE_DIM;
const TILESET_ROWS = MISTWOOD_TILESET_DIM_Y / MISTWOOD_TILE_DIM;
export const MISTWOOD_TILE_COUNT = TILESET_COLUMNS * TILESET_ROWS;

export const EMPTY_TILE = -1;

/** Ground materials. Nine-slice blocks are listed row-major from the top-left. */
const GRASS = [745, 746, 790, 791, 835, 836];
const FOREST = [727, 728, 772, 773, 817, 818, 862, 863, 907, 908];
const SAND = [1063];
const SAND_BLOCK = [1017, 1018, 1019, 1062, 1063, 1064, 1107, 1108, 1109];
const WOOD_BLOCK = [1023, 1024, 1025, 1068, 1069, 1070, 1113, 1114, 1115];
const MILLSTONE = [974, 975];
/** Water four-slice: bank / water / water / bank, read left to right, top to bottom. */
const CHANNEL_HEAD = [360, 361, 362, 363];
const CHANNEL_BODY = [450, 451, 452, 453];
const CHANNEL_FOOT = [495, 496, 497, 498];

/** Props. Multi-tile props are listed row-major from the top-left. */
const TENT = [751, 752, 753, 796, 797, 798, 841, 842, 843];
const ORCHARD_TREES = [1072, 1073, 1074, 1117, 1118, 1119, 1162, 1163, 1164];
const CRATE_STACK = [763, 764, 808, 809];
const TABLE = [942, 943, 987, 988];
const CRATE_BRACED = [760, 805];
const POST = [944, 989];
const CRATE_LIGHT = 851;
const CRATE_DARK = 852;
const SACK_PAIR = 758;
const SACK_STACK = 804;
const SACK_OPEN = 803;
const POT = 761;
const JAR = 762;
const BARREL = 806;
const HAY = 941;
const SIGNBOARD = 844;
const NOTICE = 985;
const BASKET = 925;
const BASKET_APPLES = 926;
const CLOTH_BALES = [931, 932, 933];
const DISPENSARY = [883, 884, 885, 886, 887, 888];
const HERBS = [890, 891, 892];
const PINE = 894;
const BUSH = 895;
const ROCKS = 896;
const STUMP = 893;
const LOG = 938;
const FIREWOOD = 848;
const FOXGLOVE = 845;
const WHEAT = 846;
const WHITE_FLOWERS = 935;
const YELLOW_FLOWERS = 937;

export interface MistwoodRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MistwoodLocationFootprint {
  /** Canonical location id from `convex/canon/mistwoodSeed.ts`. */
  readonly id: string;
  readonly name: string;
  /** Tile rectangle this location occupies on the map. */
  readonly rect: MistwoodRect;
  /** What the location is built from, so reviewers can check it reads correctly. */
  readonly vocabulary: string;
}

export const mistwoodLocationFootprints: readonly MistwoodLocationFootprint[] = [
  {
    id: 'mistwood-station',
    name: 'Mistwood Station',
    rect: { x: 3, y: 4, width: 10, height: 6 },
    vocabulary: 'disused timber platform on the old rail corridor, sealed lockers, encroaching scrub',
  },
  {
    id: 'mistwood-hall',
    name: 'Town Hall',
    rect: { x: 17, y: 4, width: 11, height: 7 },
    vocabulary: 'walled stone civic courtyard, notice board, records crates, council benches',
  },
  {
    id: 'mistwood-paper',
    name: 'Mistwood Chronicle',
    rect: { x: 32, y: 4, width: 13, height: 7 },
    vocabulary: 'print-shop floor beside the rail line, newsprint bales, ink barrels, posted notices',
  },
  {
    id: 'mistwood-square',
    name: 'Lantern Square',
    rect: { x: 3, y: 14, width: 12, height: 11 },
    vocabulary: 'paved market ground, stall canopies, produce baskets, lantern posts, notice board',
  },
  {
    id: 'mistwood-clinic',
    name: 'Juniper Clinic',
    rect: { x: 19, y: 15, width: 11, height: 9 },
    vocabulary: 'timber ward, rear dispensary shelves of bottles and flasks, juniper hedge, herb beds',
  },
  {
    id: 'mistwood-mill',
    name: 'Northwater Mill',
    rect: { x: 33, y: 13, width: 12, height: 13 },
    vocabulary: 'mill floor on the Northwater channel, turning wheel, grain sacks, millstones, barrels',
  },
  {
    id: 'mistwood-orchard',
    name: 'Bellweather Orchard',
    rect: { x: 26, y: 27, width: 14, height: 8 },
    vocabulary: 'planted tree rows either side of the disputed access road, packing shed, apple baskets',
  },
  {
    id: 'mistwood-inn',
    name: 'Foxglove Inn',
    rect: { x: 7, y: 28, width: 13, height: 7 },
    vocabulary: 'boarding-house yard, dining tables under canopy, foxglove beds, cellar pots',
  },
];

/**
 * Road corridors, one per undirected edge of the seed's `connectedLocationIds`
 * graph. Each entry is the walkable ground that joins exactly those two
 * locations without crossing a third.
 */
const ROADS: readonly { readonly between: readonly [string, string]; readonly rects: readonly MistwoodRect[] }[] = [
  {
    between: ['mistwood-station', 'mistwood-paper'],
    // The old rail corridor along the north edge; the Chronicle sits beside it.
    rects: [
      { x: 5, y: 3, width: 2, height: 1 },
      { x: 3, y: 1, width: 42, height: 2 },
      { x: 36, y: 3, width: 2, height: 1 },
    ],
  },
  {
    between: ['mistwood-station', 'mistwood-square'],
    rects: [{ x: 6, y: 10, width: 2, height: 4 }],
  },
  {
    between: ['mistwood-hall', 'mistwood-square'],
    rects: [
      { x: 17, y: 11, width: 2, height: 2 },
      { x: 13, y: 12, width: 6, height: 2 },
    ],
  },
  {
    between: ['mistwood-hall', 'mistwood-paper'],
    rects: [{ x: 28, y: 6, width: 4, height: 2 }],
  },
  {
    between: ['mistwood-paper', 'mistwood-mill'],
    rects: [{ x: 36, y: 11, width: 2, height: 2 }],
  },
  {
    between: ['mistwood-square', 'mistwood-clinic'],
    rects: [{ x: 15, y: 18, width: 4, height: 2 }],
  },
  {
    between: ['mistwood-clinic', 'mistwood-mill'],
    rects: [{ x: 30, y: 18, width: 3, height: 2 }],
  },
  {
    between: ['mistwood-square', 'mistwood-inn'],
    rects: [{ x: 9, y: 25, width: 2, height: 3 }],
  },
  {
    between: ['mistwood-inn', 'mistwood-orchard'],
    rects: [{ x: 20, y: 30, width: 6, height: 2 }],
  },
  {
    between: ['mistwood-orchard', 'mistwood-mill'],
    rects: [{ x: 36, y: 26, width: 2, height: 1 }],
  },
];

export const mistwoodRoadEdges: readonly (readonly [string, string])[] = ROADS.map((road) => road.between);

/** The Northwater channel that drives the mill, running north-south past it. */
const CHANNEL: MistwoodRect = { x: 40, y: 11, width: 4, height: 25 };
/** Where the animated mill wheel stands; no tile props go here. */
const MILL_WHEEL: MistwoodRect = { x: 34, y: 15, width: 4, height: 4 };

type MutableLayer = number[][];

function createLayer(fill: number): MutableLayer {
  return Array.from({ length: MISTWOOD_MAP_WIDTH }, () =>
    Array.from({ length: MISTWOOD_MAP_HEIGHT }, () => fill),
  );
}

/** Deterministic so the exported map is identical on every import. */
function createShuffle(seed: number): (x: number, y: number, length: number) => number {
  return (x, y, length) => {
    const hash = Math.imul(x * 73856093 ^ y * 19349663 ^ seed, 2654435761) >>> 0;
    return hash % length;
  };
}

const pick = createShuffle(0x517cc1b7);

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MISTWOOD_MAP_WIDTH && y < MISTWOOD_MAP_HEIGHT;
}

function forEachTile(rect: MistwoodRect, visit: (x: number, y: number) => void): void {
  for (let x = rect.x; x < rect.x + rect.width; x++) {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      if (inBounds(x, y)) visit(x, y);
    }
  }
}

function fill(layer: MutableLayer, rect: MistwoodRect, tiles: readonly number[]): void {
  forEachTile(rect, (x, y) => {
    layer[x][y] = tiles[pick(x, y, tiles.length)];
  });
}

/** Paints a rectangle from a nine-slice block so the material gets proper edges. */
function fillBlock(layer: MutableLayer, rect: MistwoodRect, block: readonly number[]): void {
  forEachTile(rect, (x, y) => {
    const col = x === rect.x ? 0 : x === rect.x + rect.width - 1 ? 2 : 1;
    const row = y === rect.y ? 0 : y === rect.y + rect.height - 1 ? 2 : 1;
    layer[x][y] = block[row * 3 + col];
  });
}

/** Paints the four-tile-wide Northwater channel: bank, water, water, bank. */
function fillChannel(layer: MutableLayer, rect: MistwoodRect): void {
  forEachTile(rect, (x, y) => {
    const slice =
      y === rect.y ? CHANNEL_HEAD : y === rect.y + rect.height - 1 ? CHANNEL_FOOT : CHANNEL_BODY;
    layer[x][y] = slice[x - rect.x];
  });
}

/** Stamps a fixed `width`-wide prop whose tiles are listed row-major. */
function stamp(layer: MutableLayer, x: number, y: number, tiles: readonly number[], width: number): void {
  tiles.forEach((tile, index) => {
    const tx = x + (index % width);
    const ty = y + Math.floor(index / width);
    if (inBounds(tx, ty)) layer[tx][ty] = tile;
  });
}

const ground = createLayer(GRASS[0]);
const groundDetail = createLayer(EMPTY_TILE);
const structures = createLayer(EMPTY_TILE);
const props = createLayer(EMPTY_TILE);
const collision = createLayer(1);

const WHOLE_MAP: MistwoodRect = {
  x: 0,
  y: 0,
  width: MISTWOOD_MAP_WIDTH,
  height: MISTWOOD_MAP_HEIGHT,
};

function open(rect: MistwoodRect): void {
  forEachTile(rect, (x, y) => {
    collision[x][y] = 0;
  });
}

function block(x: number, y: number): void {
  if (inBounds(x, y)) collision[x][y] = 1;
}

function blockRect(rect: MistwoodRect): void {
  forEachTile(rect, (x, y) => block(x, y));
}

// --- 1. The wood the town is named for, everywhere nothing else is built. ----
fill(ground, WHOLE_MAP, GRASS);
fill(structures, WHOLE_MAP, FOREST);

// --- 2. Clear the eight locations and the roads between them. ---------------
for (const footprint of mistwoodLocationFootprints) {
  forEachTile(footprint.rect, (x, y) => {
    structures[x][y] = EMPTY_TILE;
  });
  open(footprint.rect);
}
for (const road of ROADS) {
  for (const rect of road.rects) {
    forEachTile(rect, (x, y) => {
      structures[x][y] = EMPTY_TILE;
    });
    fill(ground, rect, SAND);
    open(rect);
  }
}

// --- 3. Mistwood Station: a disused platform on the old rail corridor. ------
fill(ground, { x: 3, y: 4, width: 10, height: 6 }, SAND);
fillBlock(ground, { x: 4, y: 5, width: 8, height: 4 }, WOOD_BLOCK);
stamp(structures, 4, 5, CRATE_STACK, 2);
stamp(structures, 7, 5, CRATE_STACK, 2);
stamp(structures, 10, 5, CRATE_BRACED, 1);
props[6][8] = STUMP;
props[9][8] = WHEAT;
props[3][5] = SIGNBOARD;
blockRect({ x: 4, y: 5, width: 2, height: 2 });
blockRect({ x: 7, y: 5, width: 2, height: 2 });
blockRect({ x: 10, y: 5, width: 1, height: 2 });
block(3, 5);

// --- 4. Town Hall: a walled courtyard around the chamber and records office.
fillBlock(ground, { x: 17, y: 4, width: 11, height: 7 }, SAND_BLOCK);
fillBlock(ground, { x: 19, y: 6, width: 7, height: 4 }, WOOD_BLOCK);
// Perimeter wall, left open where the Square road and the Chronicle road meet it.
forEachTile({ x: 17, y: 4, width: 11, height: 7 }, (x, y) => {
  const onEdge =
    x === 17 || x === 27 || y === 4 || y === 10;
  const isSquareGate = y === 10 && (x === 17 || x === 18);
  const isChronicleGate = x === 27 && (y === 6 || y === 7);
  if (onEdge && !isSquareGate && !isChronicleGate) {
    structures[x][y] = ROCKS;
    block(x, y);
  }
});
props[20][5] = SIGNBOARD;
props[21][5] = NOTICE;
stamp(structures, 20, 7, CRATE_STACK, 2);
stamp(structures, 23, 7, CRATE_BRACED, 1);
structures[24][8] = BARREL;
blockRect({ x: 20, y: 7, width: 2, height: 2 });
blockRect({ x: 23, y: 7, width: 1, height: 2 });
block(24, 8);
block(20, 5);
block(21, 5);

// --- 5. Mistwood Chronicle: newsroom and print shop beside the rail line. ---
fill(ground, { x: 32, y: 4, width: 13, height: 7 }, SAND);
fillBlock(ground, { x: 34, y: 5, width: 8, height: 4 }, WOOD_BLOCK);
stamp(structures, 42, 5, TENT, 3);
CLOTH_BALES.forEach((bale, index) => {
  structures[35 + index * 2][6] = bale;
  block(35 + index * 2, 6);
});
stamp(structures, 35, 8, [BARREL, BARREL], 2);
props[34][5] = NOTICE;
props[40][8] = CRATE_LIGHT;
props[41][8] = CRATE_DARK;
blockRect({ x: 42, y: 5, width: 3, height: 3 });
blockRect({ x: 35, y: 8, width: 2, height: 1 });
block(40, 8);
block(41, 8);

// --- 6. Lantern Square: the paved civic square and market ground. -----------
fillBlock(ground, { x: 3, y: 14, width: 12, height: 11 }, SAND_BLOCK);
stamp(structures, 4, 15, TENT, 3);
stamp(structures, 9, 15, TENT, 3);
stamp(structures, 4, 21, TENT, 3);
blockRect({ x: 4, y: 15, width: 3, height: 3 });
blockRect({ x: 9, y: 15, width: 3, height: 3 });
blockRect({ x: 4, y: 21, width: 3, height: 3 });
props[7][16] = BASKET;
props[7][17] = BASKET_APPLES;
props[12][16] = POT;
props[12][17] = JAR;
props[8][22] = BASKET;
props[9][22] = POT;
props[11][21] = SIGNBOARD;
props[11][22] = NOTICE;
stamp(structures, 3, 19, POST, 1);
stamp(structures, 14, 19, POST, 1);
for (const [x, y] of [
  [7, 16],
  [7, 17],
  [12, 16],
  [12, 17],
  [8, 22],
  [9, 22],
  [11, 21],
  [11, 22],
] as const) {
  block(x, y);
}
blockRect({ x: 3, y: 19, width: 1, height: 2 });
blockRect({ x: 14, y: 19, width: 1, height: 2 });

// --- 7. Juniper Clinic: ward, rear dispensary and herb beds. ----------------
fillBlock(ground, { x: 21, y: 16, width: 7, height: 6 }, WOOD_BLOCK);
stamp(structures, 25, 17, TENT, 3);
blockRect({ x: 25, y: 17, width: 3, height: 3 });
DISPENSARY.forEach((bottle, index) => {
  structures[22 + index][17] = bottle;
  block(22 + index, 17);
});
props[22][20] = HERBS[0];
props[23][20] = HERBS[1];
props[24][20] = HERBS[2];
props[19][16] = BUSH;
props[19][18] = BUSH;
props[19][20] = BUSH;
props[29][16] = BUSH;
props[29][20] = BUSH;
props[21][22] = WHITE_FLOWERS;
props[23][22] = WHITE_FLOWERS;
props[25][22] = YELLOW_FLOWERS;
for (const [x, y] of [
  [19, 16],
  [19, 18],
  [19, 20],
  [29, 16],
  [29, 20],
] as const) {
  block(x, y);
}

// --- 8. Northwater Mill: the channel, the wheel and the grain floor. --------
fill(ground, { x: 33, y: 13, width: 12, height: 13 }, GRASS);
fillBlock(ground, { x: 34, y: 15, width: 6, height: 8 }, WOOD_BLOCK);
fill(groundDetail, { x: 35, y: 21, width: 3, height: 2 }, MILLSTONE);
fillChannel(ground, CHANNEL);
blockRect(CHANNEL);
// Kept clear for the wheel sprite below.
blockRect(MILL_WHEEL);
stamp(structures, 38, 15, [SACK_PAIR, SACK_STACK], 1);
stamp(structures, 38, 17, [SACK_OPEN, HAY], 1);
structures[34][20] = BARREL;
structures[35][20] = BARREL;
props[36][24] = CRATE_LIGHT;
props[37][24] = CRATE_DARK;
blockRect({ x: 38, y: 15, width: 1, height: 4 });
block(34, 20);
block(35, 20);
block(36, 24);
block(37, 24);

// --- 9. Bellweather Orchard: planted rows split by the access road. ---------
fill(ground, { x: 26, y: 27, width: 14, height: 8 }, GRASS);
fill(ground, { x: 26, y: 30, width: 14, height: 2 }, SAND);
for (const rowY of [27, 32]) {
  for (const treeX of [26, 29, 32]) {
    stamp(structures, treeX, rowY, ORCHARD_TREES, 3);
    blockRect({ x: treeX, y: rowY, width: 3, height: 3 });
  }
}
fillBlock(ground, { x: 36, y: 32, width: 4, height: 3 }, WOOD_BLOCK);
stamp(structures, 36, 33, CRATE_STACK, 2);
props[38][33] = BASKET_APPLES;
props[39][33] = BASKET;
props[36][28] = BASKET_APPLES;
props[37][29] = HAY;
blockRect({ x: 36, y: 33, width: 2, height: 2 });
block(38, 33);
block(39, 33);
block(36, 28);
block(37, 29);

// --- 10. Foxglove Inn: the boarding house yard and dining room. -------------
fill(ground, { x: 7, y: 28, width: 13, height: 7 }, GRASS);
fillBlock(ground, { x: 9, y: 29, width: 8, height: 4 }, WOOD_BLOCK);
// The canopy sits south of the yard gate so it does not block the orchard road.
stamp(structures, 16, 32, TENT, 3);
blockRect({ x: 16, y: 32, width: 3, height: 3 });
// The dining tables sit on the yard, where they read against the grass rather
// than disappearing into the boarding house's own timber floor.
stamp(structures, 10, 33, TABLE, 2);
stamp(structures, 14, 33, TABLE, 2);
blockRect({ x: 10, y: 33, width: 2, height: 2 });
blockRect({ x: 14, y: 33, width: 2, height: 2 });
structures[8][29] = POT;
structures[8][31] = BARREL;
structures[12][30] = CRATE_LIGHT;
props[8][28] = FOXGLOVE;
props[10][28] = FOXGLOVE;
props[12][28] = FOXGLOVE;
props[14][28] = FOXGLOVE;
props[19][29] = SIGNBOARD;
for (const [x, y] of [
  [8, 29],
  [8, 31],
  [12, 30],
  [8, 28],
  [10, 28],
  [12, 28],
  [14, 28],
  [19, 29],
] as const) {
  block(x, y);
}

// --- 11. Woodland detail so the untouched wood does not read as flat canopy.
for (const [x, y, tile] of [
  [2, 12, PINE],
  [16, 27, PINE],
  [24, 12, PINE],
  [31, 22, PINE],
  [45, 20, PINE],
  [1, 26, LOG],
  [22, 33, FIREWOOD],
  [30, 24, ROCKS],
  [46, 8, BUSH],
] as const) {
  props[x][y] = tile;
}

export const mistwoodBgTiles: readonly (readonly (readonly number[])[])[] = [ground, groundDetail];
export const mistwoodObjectTiles: readonly (readonly (readonly number[])[])[] = [structures, props];
/** `1` blocks movement, `0` is walkable. Same `[x][y]` indexing as the tile layers. */
export const mistwoodCollision: readonly (readonly number[])[] = collision;

export const mistwoodAnimatedSprites: readonly AnimatedSprite[] = [
  // The mill wheel, sized down from the 208px source frames to its four tiles.
  {
    x: MILL_WHEEL.x * MISTWOOD_TILE_DIM,
    y: MILL_WHEEL.y * MISTWOOD_TILE_DIM,
    w: MILL_WHEEL.width * MISTWOOD_TILE_DIM,
    h: MILL_WHEEL.height * MISTWOOD_TILE_DIM,
    layer: 1,
    sheet: 'windmill.json',
    animation: 'pixels_large',
  },
  // Water breaking where the channel passes the mill floor.
  ...[16, 20, 24].map((tileY) => ({
    x: 41 * MISTWOOD_TILE_DIM,
    y: tileY * MISTWOOD_TILE_DIM,
    w: MISTWOOD_TILE_DIM,
    h: 2 * MISTWOOD_TILE_DIM,
    layer: 1,
    sheet: 'gentlesplash.json',
    animation: 'pixels_large',
  })),
];

export const mistwoodWorldMap: SerializedWorldMap = {
  width: MISTWOOD_MAP_WIDTH,
  height: MISTWOOD_MAP_HEIGHT,
  tileSetUrl: MISTWOOD_TILESET_URL,
  tileSetDimX: MISTWOOD_TILESET_DIM_X,
  tileSetDimY: MISTWOOD_TILESET_DIM_Y,
  tileDim: MISTWOOD_TILE_DIM,
  bgTiles: mistwoodBgTiles as number[][][],
  objectTiles: mistwoodObjectTiles as number[][][],
  animatedSprites: mistwoodAnimatedSprites as AnimatedSprite[],
};
