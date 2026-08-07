/**
 * Where a character can stand inside each Mistwood zone (FR-N005 / ART-110, moved here by
 * FR-O011 / ART-120).
 *
 * This is pure geometry over `data/mistwood.ts`: a footprint rectangle, the collision layer,
 * and a breadth-first walk. It knows nothing about Canon, and it is the reason ambient drift
 * can be re-derived in the browser at all.
 *
 * The derivation used to live in `convex/visual/mistwoodLocationBindings.ts`, which also
 * imports `convex/canon/mistwoodSeed.ts` for the public location labels — and that seed
 * carries every resident's `privateProfile`, `privateGoal`, `fear` and secrets. A client that
 * needed the anchors would have dragged all of it one bundler decision away from the browser.
 * Moving the geometry (and only the geometry) into `data/`, which both sides already share,
 * removes the temptation entirely: the labels stay in `convex/visual/`, which imports these
 * anchors back, so there is still exactly one source of truth for them.
 *
 * `data/dataBoundary.test.ts` enforces that nothing here reaches a backend module, and
 * `convex/visual/mistwoodLocationBindings.test.ts` pins the eight zones' anchors byte for byte
 * against the values this module produced on the day it was extracted.
 */

import { mistwoodCollision, mistwoodLocationFootprints, type MistwoodRect } from './mistwood';

/**
 * A point in map tile coordinates. Structurally identical to `ZonePoint` in
 * `convex/visual/locationVisualBinding.ts`, and declared separately rather than imported
 * because a shared file may not reach into `convex/` at all — see the module note above.
 */
export interface AmbientAnchorPoint {
  readonly x: number;
  readonly y: number;
}

/** Enough spread for ambient wandering without turning every walkable tile into an anchor. */
export const AMBIENT_ANCHORS_PER_ZONE = 5;

type Tile = { readonly x: number; readonly y: number };

const NEIGHBOUR_OFFSETS: readonly Tile[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Where a character standing on a tile actually stands. */
function tileCentre(tile: Tile): AmbientAnchorPoint {
  return { x: tile.x + 0.5, y: tile.y + 0.5 };
}

function isWalkable(x: number, y: number): boolean {
  return mistwoodCollision[x]?.[y] === 0;
}

function isInsideRect(rect: MistwoodRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/** Row-major, so every derivation below is deterministic across imports and platforms. */
function walkableTilesIn(rect: MistwoodRect): readonly Tile[] {
  const tiles: Tile[] = [];
  for (let x = rect.x; x < rect.x + rect.width; x++) {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      if (isWalkable(x, y)) tiles.push({ x, y });
    }
  }
  return tiles;
}

function squaredDistance(first: AmbientAnchorPoint, second: AmbientAnchorPoint): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function tileKey(tile: Tile): string {
  return `${tile.x},${tile.y}`;
}

/** In-zone walkable tiles that touch a walkable tile outside the zone: the mouths of its roads. */
export function entryTilesFor(rect: MistwoodRect): readonly Tile[] {
  return walkableTilesIn(rect).filter((tile) =>
    NEIGHBOUR_OFFSETS.some((offset) => {
      const x = tile.x + offset.x;
      const y = tile.y + offset.y;
      return !isInsideRect(rect, x, y) && isWalkable(x, y);
    }),
  );
}

/**
 * Walkable does not mean reachable: the Northwater channel cuts the mill zone's far bank off
 * from its floor, and the orchard packing shed leaves a two-tile pocket behind blocked crates.
 * Ambient anchors are therefore taken only from the tiles a character can walk to from an entry
 * anchor without leaving the zone.
 */
export function reachableTilesFrom(rect: MistwoodRect, seeds: readonly Tile[]): readonly Tile[] {
  const walkable = walkableTilesIn(rect);
  const inZone = new Set(walkable.map(tileKey));
  const reached = new Set<string>();
  const queue: Tile[] = [];
  for (const seed of seeds) {
    if (inZone.has(tileKey(seed)) && !reached.has(tileKey(seed))) {
      reached.add(tileKey(seed));
      queue.push(seed);
    }
  }
  while (queue.length > 0) {
    const tile = queue.shift() as Tile;
    for (const offset of NEIGHBOUR_OFFSETS) {
      const next = { x: tile.x + offset.x, y: tile.y + offset.y };
      if (!inZone.has(tileKey(next)) || reached.has(tileKey(next))) continue;
      reached.add(tileKey(next));
      queue.push(next);
    }
  }
  return walkable.filter((tile) => reached.has(tileKey(tile)));
}

/**
 * Farthest-point spread: start from the reachable tile nearest the zone centre, then repeatedly
 * take the reachable tile furthest from everything already chosen. Ties resolve to the earlier
 * tile in row-major order, so the result is stable.
 */
export function ambientAnchorsFor(
  rect: MistwoodRect,
  candidates: readonly Tile[],
  count: number,
): readonly AmbientAnchorPoint[] {
  if (candidates.length <= count) return candidates.map(tileCentre);

  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const chosen: Tile[] = [
    candidates.reduce((best, tile) =>
      squaredDistance(centre, tileCentre(tile)) < squaredDistance(centre, tileCentre(best))
        ? tile
        : best,
    ),
  ];
  while (chosen.length < count) {
    let bestTile = candidates[0];
    let bestDistance = -1;
    for (const tile of candidates) {
      if (chosen.includes(tile)) continue;
      const distance = Math.min(
        ...chosen.map((selected) => squaredDistance(tileCentre(selected), tileCentre(tile))),
      );
      if (distance > bestDistance) {
        bestDistance = distance;
        bestTile = tile;
      }
    }
    chosen.push(bestTile);
  }
  return chosen.map(tileCentre);
}

function buildAnchorTables(): {
  entry: Record<string, readonly AmbientAnchorPoint[]>;
  ambient: Record<string, readonly AmbientAnchorPoint[]>;
} {
  const entry: Record<string, readonly AmbientAnchorPoint[]> = {};
  const ambient: Record<string, readonly AmbientAnchorPoint[]> = {};
  for (const footprint of mistwoodLocationFootprints) {
    const entryTiles = entryTilesFor(footprint.rect);
    entry[footprint.id] = entryTiles.map(tileCentre);
    ambient[footprint.id] = ambientAnchorsFor(
      footprint.rect,
      reachableTilesFrom(footprint.rect, entryTiles),
      AMBIENT_ANCHORS_PER_ZONE,
    );
  }
  return { entry, ambient };
}

const tables = buildAnchorTables();

/** Road mouths per Canon location id. */
export const mistwoodEntryAnchorsByLocationId: Readonly<
  Record<string, readonly AmbientAnchorPoint[]>
> = tables.entry;

/**
 * Standing positions per Canon location id (PRD 2.0 §9.1.2).
 *
 * Every anchor is inside its own zone rectangle, and a rectangle is convex, so the straight
 * line between any two anchors of one zone is inside that zone as well. That is the whole
 * proof of FR-O011 AC#1 — ambient drift never leaves the zone — and it needs no pathfinding.
 */
export const mistwoodAmbientAnchorsByLocationId: Readonly<
  Record<string, readonly AmbientAnchorPoint[]>
> = tables.ambient;
