# Mistwood Location Visual Bindings (FR-N005 / ART-110)

Canon owns the semantic town: `mistwood-clinic` is a place characters can be, and nothing more.
The map owns the geometry. A **Location Visual Binding** is the versioned join between the two, so
the Visual Runtime can draw a Canon location without Canon ever learning what a tile is
(PRD 2.0 §10.6, §14.2).

- Contract, validation and zone arrival: `convex/visual/locationVisualBinding.ts`
- The eight Mistwood bindings: `convex/visual/mistwoodLocationBindings.ts`
- Persisted row shape: `locationVisualBindings` in `convex/visual/schema.ts`
- Map geometry they are measured against: `data/mistwood.ts` (FR-N009 / ART-109)

It shares the `visual` module with the Character Visual Binding (FR-N004 / ART-111,
`docs/character-visual-binding.md`): both are the same layer, one keyed by `locationId` and one by
`characterId`.

## Coordinates

All binding coordinates are **map tile coordinates**, the same space as the footprint rectangles in
`data/mistwood.ts`. Tile `(tx, ty)` covers the unit square from `(tx, ty)` to `(tx + 1, ty + 1)`, so a
character standing on it sits at its centre `(tx + 0.5, ty + 0.5)`. Anchors are therefore always on a
`.5` grid, while zone corners are whole numbers. Pixel conversion is the renderer's job; a binding
never stores pixels.

## Shape

```ts
type LocationVisualBinding = {
  id: string;
  worldId: string;
  mapId: string;              // geometry is meaningless across map versions
  locationId: string;         // the Canon location
  zoneType: 'canon-location';
  zonePolygon: ZonePoint[];   // convex ring, not closed
  entryAnchors: ZonePoint[];  // where a character crosses in from outside
  ambientAnchors: ZonePoint[];// standing positions for in-zone activity (§9.1.2)
  sceneFocusPoint: ZonePoint; // camera target for a scene, not a standing position
  publicLabel: string;        // public text; never private Canon detail
  status: 'active' | 'retired';
  version: number;
};
```

`createdAt`/`updatedAt` from PRD §14.2 are clock values, so they exist only on the persisted
`locationVisualBindings` row; the authored set here is a versioned constant, pinned by
`MISTWOOD_LOCATION_BINDING_VERSION`. Re-authoring a zone writes a new `version` and retires the
previous row rather than editing geometry in place, so a published position can always be traced
back to the map it was measured on.

## Nothing here is hand-placed

Every field is derived from data that already exists, so a map or seed edit cannot silently strand a
location:

| Field | Derived from |
| --- | --- |
| `zonePolygon` | the location's footprint rectangle in `mistwoodLocationFootprints` |
| `entryAnchors` | in-zone walkable tiles that touch a walkable tile outside the zone. Everything that is not a location or a road is blocked woodland, so these are exactly the mouths of the roads ART-109 built from the seed's `connectedLocationIds` graph |
| `ambientAnchors` | a deterministic farthest-point spread over the tiles reachable on foot from an entry anchor |
| `sceneFocusPoint` | the centre of the footprint rectangle |
| `publicLabel` | the Canon location `name`, which is already public text |

**Walkable is not reachable.** The Northwater channel cuts the mill zone's far bank off from the mill
floor, and the orchard packing shed leaves a two-tile pocket behind blocked crates. Both are walkable
tiles inside their zone that a character could never walk to, so ambient anchors are taken from a
flood fill seeded by the entry anchors rather than from raw walkability.

## The eight zones

Zone columns are the tile ranges the polygon spans (`x from–to`, `y from–to`, upper bound exclusive).

| Canon location | Public label | Zone | Entry anchors | Ambient anchors | Scene focus |
| --- | --- | --- | --- | --- | --- |
| `mistwood-station` | Mistwood Station | x 3–13, y 4–10 | (5.5, 4.5) (6.5, 4.5) (6.5, 9.5) (7.5, 9.5) | (7.5, 7.5) (12.5, 4.5) (3.5, 4.5) (12.5, 9.5) (3.5, 9.5) | (8, 7) |
| `mistwood-square` | Lantern Square | x 3–15, y 14–25 | (6.5, 14.5) (7.5, 14.5) (9.5, 24.5) (10.5, 24.5) (13.5, 14.5) (14.5, 14.5) (14.5, 18.5) | (8.5, 19.5) (14.5, 14.5) (14.5, 24.5) (3.5, 14.5) (3.5, 24.5) | (9, 19.5) |
| `mistwood-hall` | Town Hall | x 17–28, y 4–11 | (17.5, 10.5) (18.5, 10.5) (27.5, 6.5) (27.5, 7.5) | (22.5, 7.5) (17.5, 10.5) (27.5, 6.5) (18.5, 5.5) (25.5, 9.5) | (22.5, 7.5) |
| `mistwood-paper` | Mistwood Chronicle | x 32–45, y 4–11 | (32.5, 6.5) (32.5, 7.5) (36.5, 4.5) (36.5, 10.5) (37.5, 4.5) (37.5, 10.5) | (38.5, 7.5) (32.5, 4.5) (44.5, 4.5) (32.5, 10.5) (44.5, 10.5) | (38.5, 7.5) |
| `mistwood-clinic` | Juniper Clinic | x 19–30, y 15–24 | (19.5, 19.5) (29.5, 18.5) (29.5, 19.5) | (24.5, 19.5) (19.5, 15.5) (19.5, 23.5) (29.5, 15.5) (29.5, 23.5) | (24.5, 19.5) |
| `mistwood-mill` | Northwater Mill | x 33–45, y 13–26 | (33.5, 18.5) (33.5, 19.5) (36.5, 13.5) (36.5, 25.5) (37.5, 13.5) (37.5, 25.5) | (38.5, 19.5) (33.5, 13.5) (33.5, 25.5) (39.5, 13.5) (39.5, 25.5) | (39, 19.5) |
| `mistwood-orchard` | Bellweather Orchard | x 26–40, y 27–35 | (26.5, 30.5) (26.5, 31.5) (36.5, 27.5) (37.5, 27.5) | (32.5, 30.5) (39.5, 27.5) (26.5, 31.5) (37.5, 32.5) (35.5, 27.5) | (33, 31) |
| `mistwood-inn` | Foxglove Inn | x 7–20, y 28–35 | (9.5, 28.5) (19.5, 30.5) (19.5, 31.5) | (13.5, 31.5) (7.5, 28.5) (19.5, 28.5) (7.5, 34.5) (19.5, 34.5) | (13.5, 31.5) |

The clinic has three entry anchors rather than four because the juniper hedge blocks tile (19, 18) on
the Lantern Square side; the road still reaches the zone at (19, 19).

## Import-time validation

`validateLocationVisualBindings` throws `LocationVisualBindingError` on the first problem, so an
invalid set can never be observed half-loaded. It rejects:

| Code | Rejects |
| --- | --- |
| `LOCATION_BINDING_UNKNOWN_LOCATION` | a `locationId` Canon does not define |
| `LOCATION_BINDING_DUPLICATE_ID` / `_DUPLICATE_LOCATION` | the same binding id or location bound twice |
| `LOCATION_BINDING_DEGENERATE_POLYGON` | fewer than three vertices, non-finite or collinear points, a non-convex ring, or a zone smaller than one tile |
| `LOCATION_BINDING_INSUFFICIENT_ANCHORS` | no entry anchor, fewer than three ambient anchors, or duplicate ambient anchors |
| `LOCATION_BINDING_ANCHOR_OUTSIDE_ZONE` | any anchor or the scene focus point outside its own zone |
| `LOCATION_BINDING_UNREASONABLE_OVERLAP` | two active zones sharing more than 10% of the smaller zone's area |
| `LOCATION_BINDING_MISSING_LOCATION` | a required Canon location with no active binding |
| `LOCATION_BINDING_INVALID_SHAPE` | empty identity fields, an unsupported zone type or status, or a non-positive version |

Zone polygons must be **convex**. Overlap is then measured by exact convex clipping instead of
sampling, and containment stays cheap and deterministic. Every Mistwood zone is a map rectangle; an
L-shaped zone would have to be expressed as two bindings or the constraint revisited.

## Zone arrival

Arrival is containment in the bound polygon, never equality with a stored coordinate
(FR-N005 AC #3). A character at (19.13, 23.93) is in the Juniper Clinic just as much as one standing
exactly on an ambient anchor.

- `hasArrivedAtLocation(binding, point)` — has this character reached this location?
- `findLocationZoneAtPoint(bindings, point)` — which active zone is this point standing in?
- `resolvePublishableLocationZone(bindings, locationId)` — the only sanctioned way to turn a Canon
  `locationId` into map geometry. An unbound or retired location resolves to `undefined`, so it can
  never be published as a visible position (AC #4).

Boundaries count as inside, so a character on the shared edge of a zone and its road has arrived.

## Out of scope here

Movement planning and trajectories (FR-N010), the Canon-to-runtime sync state machine (FR-N006) and
character visual bindings (FR-N004) are separate requirements. This module answers only "where is
this Canon location on the map, and is this point inside it".
