import {
  mistwoodCollision,
  mistwoodLocationFootprints,
  type MistwoodRect,
} from '../../data/mistwood';
import { MISTWOOD_PUBLIC_WORLD_ID, mistwoodWorldConfiguration } from '../canon/mistwoodSeed';
import {
  MIN_AMBIENT_ANCHORS,
  convexPolygonOverlapArea,
  hasArrivedAtLocation,
  isPointInZonePolygon,
  polygonArea,
  resolvePublishableLocationZone,
  type LocationVisualBinding,
  type ZonePoint,
} from './locationVisualBinding';
import {
  MISTWOOD_LOCATION_BINDING_VERSION,
  MISTWOOD_MAP_ID,
  mistwoodLocationVisualBindings,
} from './mistwoodLocationBindings';

const canonLocations = mistwoodWorldConfiguration.locations.filter((location) => location.active);

const footprintsById = new Map(
  mistwoodLocationFootprints.map((footprint) => [footprint.id, footprint.rect]),
);

function rectFor(binding: LocationVisualBinding): MistwoodRect {
  const rect = footprintsById.get(binding.locationId);
  if (!rect) throw new Error(`no footprint for ${binding.locationId}`);
  return rect;
}

function isWalkableAnchor(anchor: ZonePoint): boolean {
  return mistwoodCollision[Math.floor(anchor.x)]?.[Math.floor(anchor.y)] === 0;
}

function isInsideRect(rect: MistwoodRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/** Independent re-derivation of the road mouths, straight from the ART-109 collision layer. */
function expectedEntryTiles(rect: MistwoodRect): string[] {
  const tiles: string[] = [];
  for (let x = rect.x; x < rect.x + rect.width; x++) {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      if (mistwoodCollision[x][y] !== 0) continue;
      const touchesOutside = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(
        ([dx, dy]) =>
          !isInsideRect(rect, x + dx, y + dy) && mistwoodCollision[x + dx]?.[y + dy] === 0,
      );
      if (touchesOutside) tiles.push(`${x},${y}`);
    }
  }
  return tiles;
}

function anchorTile(anchor: ZonePoint): string {
  return `${Math.floor(anchor.x)},${Math.floor(anchor.y)}`;
}

/** Independent flood fill over in-zone walkable tiles, from the binding's own entry anchors. */
function reachableTiles(rect: MistwoodRect, seeds: readonly string[]): Set<string> {
  const reached = new Set<string>();
  const queue = seeds.filter((seed) => {
    const [x, y] = seed.split(',').map(Number);
    return isInsideRect(rect, x, y) && mistwoodCollision[x][y] === 0;
  });
  queue.forEach((seed) => reached.add(seed));
  while (queue.length > 0) {
    const [x, y] = (queue.shift() as string).split(',').map(Number);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const key = `${x + dx},${y + dy}`;
      if (!isInsideRect(rect, x + dx, y + dy)) continue;
      if (mistwoodCollision[x + dx][y + dy] !== 0 || reached.has(key)) continue;
      reached.add(key);
      queue.push(key);
    }
  }
  return reached;
}

function distance(first: ZonePoint, second: ZonePoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

describe('Mistwood Location Visual Bindings cover the canonical town (FR-N005 AC #1)', () => {
  it('binds every active Canon location exactly once, in seed order', () => {
    expect(mistwoodLocationVisualBindings).toHaveLength(8);
    expect(mistwoodLocationVisualBindings.map((binding) => binding.locationId)).toEqual(
      canonLocations.map((location) => location.id),
    );
  });

  it('records the world, map and version each zone was measured against (AC #6)', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      expect(binding.worldId).toBe(MISTWOOD_PUBLIC_WORLD_ID);
      expect(binding.mapId).toBe(MISTWOOD_MAP_ID);
      expect(binding.version).toBe(MISTWOOD_LOCATION_BINDING_VERSION);
      expect(binding.status).toBe('active');
      expect(binding.zoneType).toBe('canon-location');
      expect(binding.id).toBe(`location-binding-${binding.locationId}`);
    }
  });

  it('publishes the Canon location name as the public label and nothing more', () => {
    const namesById = new Map(canonLocations.map((location) => [location.id, location.name]));
    for (const binding of mistwoodLocationVisualBindings) {
      expect(binding.publicLabel).toBe(namesById.get(binding.locationId));
    }
    // Canon descriptions stay in Canon; a label must not carry them into the public surface.
    const labels = mistwoodLocationVisualBindings.map((binding) => binding.publicLabel).join('|');
    for (const location of canonLocations) {
      expect(labels).not.toContain(location.description);
    }
  });
});

describe('Mistwood zones reuse the ART-109 map geometry (FR-N005 AC #2)', () => {
  it('takes every zone polygon from the location footprint on the map', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      const rect = rectFor(binding);
      expect(binding.zonePolygon).toEqual([
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
        { x: rect.x, y: rect.y + rect.height },
      ]);
      expect(polygonArea(binding.zonePolygon)).toBe(rect.width * rect.height);
    }
  });

  it('keeps the eight zones completely disjoint', () => {
    for (let first = 0; first < mistwoodLocationVisualBindings.length; first++) {
      for (let second = first + 1; second < mistwoodLocationVisualBindings.length; second++) {
        expect(
          convexPolygonOverlapArea(
            mistwoodLocationVisualBindings[first].zonePolygon,
            mistwoodLocationVisualBindings[second].zonePolygon,
          ),
        ).toBe(0);
      }
    }
  });

  it('puts the scene focus point inside its own zone', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      expect(isPointInZonePolygon(binding.sceneFocusPoint, binding.zonePolygon)).toBe(true);
    }
  });
});

describe('Mistwood anchors stand on walkable ground (FR-N005 AC #5)', () => {
  it('derives entry anchors from the road mouths the map actually has', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      const expected = expectedEntryTiles(rectFor(binding));
      expect(expected.length).toBeGreaterThan(0);
      expect(binding.entryAnchors.map(anchorTile)).toEqual(expected);
    }
  });

  it('places every anchor on a walkable tile inside its own zone', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      for (const anchor of [...binding.entryAnchors, ...binding.ambientAnchors]) {
        expect(isWalkableAnchor(anchor)).toBe(true);
        expect(isPointInZonePolygon(anchor, binding.zonePolygon)).toBe(true);
        // Tile centres, so a character standing on the anchor is not clipping a zone edge.
        expect(anchor.x % 1).toBe(0.5);
        expect(anchor.y % 1).toBe(0.5);
      }
    }
  });

  it('keeps every ambient anchor reachable on foot from an entry anchor', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      const reachable = reachableTiles(rectFor(binding), binding.entryAnchors.map(anchorTile));
      for (const anchor of binding.ambientAnchors) {
        expect(reachable.has(anchorTile(anchor))).toBe(true);
      }
    }
  });

  it('skips walkable ground the Northwater channel cuts off from the mill floor', () => {
    const mill = mistwoodLocationVisualBindings.find(
      (binding) => binding.locationId === 'mistwood-mill',
    )!;
    // (44, 13) is inside the mill zone and walkable, but it is the far bank of the channel.
    expect(mistwoodCollision[44][13]).toBe(0);
    expect(isPointInZonePolygon({ x: 44.5, y: 13.5 }, mill.zonePolygon)).toBe(true);
    expect(mill.ambientAnchors.map(anchorTile)).not.toContain('44,13');
  });

  it('gives every zone enough separated ambient anchors for in-zone activity', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      expect(binding.ambientAnchors.length).toBeGreaterThanOrEqual(MIN_AMBIENT_ANCHORS);
      const tiles = new Set(binding.ambientAnchors.map(anchorTile));
      expect(tiles.size).toBe(binding.ambientAnchors.length);
      for (let first = 0; first < binding.ambientAnchors.length; first++) {
        for (let second = first + 1; second < binding.ambientAnchors.length; second++) {
          expect(
            distance(binding.ambientAnchors[first], binding.ambientAnchors[second]),
          ).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
});

describe('Mistwood zone arrival and publication (FR-N005 AC #3, #4)', () => {
  it('reports arrival from any point in the zone, not only at an anchor', () => {
    const clinic = resolvePublishableLocationZone(
      mistwoodLocationVisualBindings,
      'mistwood-clinic',
    );
    expect(clinic).toBeDefined();
    const rect = footprintsById.get('mistwood-clinic')!;
    const offAnchor = { x: rect.x + 0.13, y: rect.y + rect.height - 0.07 };
    expect([...clinic!.ambientAnchors, ...clinic!.entryAnchors]).not.toContainEqual(offAnchor);
    expect(hasArrivedAtLocation(clinic!, offAnchor)).toBe(true);
    expect(hasArrivedAtLocation(clinic!, { x: rect.x - 1, y: rect.y - 1 })).toBe(false);
  });

  it('keeps every zone recognisable from its own anchors and no other zone', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      for (const anchor of binding.ambientAnchors) {
        const owners = mistwoodLocationVisualBindings.filter((candidate) =>
          hasArrivedAtLocation(candidate, anchor),
        );
        expect(owners.map((owner) => owner.locationId)).toEqual([binding.locationId]);
      }
    }
  });

  it('publishes no position for a Canon location that has no binding', () => {
    expect(
      resolvePublishableLocationZone(mistwoodLocationVisualBindings, 'mistwood-nowhere'),
    ).toBeUndefined();
  });
});
