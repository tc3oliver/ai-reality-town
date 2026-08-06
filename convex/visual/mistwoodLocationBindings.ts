/**
 * Location Visual Bindings for the eight canonical Mistwood locations (FR-N005 / ART-110).
 *
 * Nothing here invents geometry. `data/mistwood.ts` (FR-N009 / ART-109) already decided where
 * every location sits and which tiles are walkable, so this module derives each zone from that
 * map and each label from the Canon world configuration:
 *
 * - `zonePolygon` is the location's footprint rectangle from `mistwoodLocationFootprints`.
 * - `entryAnchors` are the in-zone walkable tiles that touch a walkable tile outside the zone.
 *   Everything outside a location or a road is blocked woodland, so those tiles are exactly the
 *   mouths of the roads ART-109 built from the seed's `connectedLocationIds` graph.
 * - `ambientAnchors` are walkable in-zone tiles spread across the part of the zone a character can
 *   actually reach from an entry anchor, so ambient movement never targets a walkable island cut
 *   off by props, the Northwater channel or the mill wheel.
 * - `publicLabel` is the Canon location name, which is already public text.
 *
 * Because everything is derived, an edit to the map or the seed that would strand a location
 * fails this module's import-time validation instead of silently publishing a broken zone.
 */

import { mistwoodCollision, mistwoodLocationFootprints, type MistwoodRect } from '../../data/mistwood';
import { MISTWOOD_PUBLIC_WORLD_ID, mistwoodWorldConfiguration } from '../canon/mistwoodSeed';
import {
  LocationVisualBindingError,
  validateLocationVisualBindings,
  type LocationVisualBinding,
  type ZonePoint,
} from './locationVisualBinding';

/** Identifies the map these zones are measured against; geometry does not survive a new map. */
export const MISTWOOD_MAP_ID = 'mistwood-v1';

/** Bumped whenever an authored binding changes, so a published position stays auditable. */
export const MISTWOOD_LOCATION_BINDING_VERSION = 1;

/** Enough spread for ambient wandering without turning every walkable tile into an anchor. */
const AMBIENT_ANCHORS_PER_ZONE = 5;

type Tile = { readonly x: number; readonly y: number };

const NEIGHBOUR_OFFSETS: readonly Tile[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Tile `(x, y)` covers the unit square `(x, y)`–`(x + 1, y + 1)`, so its ring is the corners. */
function zonePolygonForRect(rect: MistwoodRect): readonly ZonePoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

/** Where a character standing on a tile actually stands. */
function tileCentre(tile: Tile): ZonePoint {
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

function squaredDistance(first: ZonePoint, second: ZonePoint): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function tileKey(tile: Tile): string {
  return `${tile.x},${tile.y}`;
}

function entryTilesFor(rect: MistwoodRect): readonly Tile[] {
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
function reachableTilesFrom(rect: MistwoodRect, seeds: readonly Tile[]): readonly Tile[] {
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
function ambientAnchorsFor(
  rect: MistwoodRect,
  candidates: readonly Tile[],
  count: number,
): readonly ZonePoint[] {
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

const footprintsByLocationId = new Map(
  mistwoodLocationFootprints.map((footprint) => [footprint.id, footprint]),
);

const canonLocations = mistwoodWorldConfiguration.locations.filter((location) => location.active);

function buildBinding(locationId: string, publicLabel: string): LocationVisualBinding {
  const footprint = footprintsByLocationId.get(locationId);
  if (!footprint) {
    throw new LocationVisualBindingError(
      'LOCATION_BINDING_MISSING_LOCATION',
      'has no footprint on the Mistwood map',
      'mistwoodLocationFootprints',
      { locationId },
    );
  }
  const rect = footprint.rect;
  const entryTiles = entryTilesFor(rect);
  return {
    id: `location-binding-${locationId}`,
    worldId: MISTWOOD_PUBLIC_WORLD_ID,
    mapId: MISTWOOD_MAP_ID,
    locationId,
    zoneType: 'canon-location',
    zonePolygon: zonePolygonForRect(rect),
    entryAnchors: entryTiles.map(tileCentre),
    ambientAnchors: ambientAnchorsFor(
      rect,
      reachableTilesFrom(rect, entryTiles),
      AMBIENT_ANCHORS_PER_ZONE,
    ),
    sceneFocusPoint: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    publicLabel,
    status: 'active',
    version: MISTWOOD_LOCATION_BINDING_VERSION,
  };
}

/**
 * Validated at import time: an unknown or unbound Canon location, a degenerate zone, anchors
 * outside their own zone or unreasonably overlapping zones all throw here rather than reaching
 * the Visual Runtime.
 */
export const mistwoodLocationVisualBindings: readonly LocationVisualBinding[] =
  validateLocationVisualBindings(
    canonLocations.map((location) => buildBinding(location.id, location.name)),
    {
      knownLocationIds: mistwoodWorldConfiguration.locations.map((location) => location.id),
      requiredLocationIds: canonLocations.map((location) => location.id),
    },
  );
