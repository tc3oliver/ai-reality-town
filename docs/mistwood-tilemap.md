# Mistwood Tilemap (FR-N009 / ART-109)

`data/mistwood.ts` is the Mistwood-specific tilemap. It replaces the inherited a16z
demo layout (`data/gentle.js`), which is a generic forest scene with no relationship
to Mistwood's canon.

## Why the map is rebuilt rather than relabelled

PRD 2.0 §24.21 forbids binding the eight canonical locations onto the inherited map:
doing so would resolve the clinic, the newsroom, the mill and the orchard to
unrelated buildings or bare grass, which RISK2-006 identifies as the main "still
looks like a tech demo" failure mode.

## Tileset constraint

The only tileset cleared for the public bundle is `public/assets/gentle-obj.png`
(see `ASSETS-LICENSE.md`); `magecity.png`, `rpg-tileset.png` and `tilemap.json` are
quarantined. That tileset contains **no town buildings** — it is terrain (grass,
sand, water, cliffs, forest) plus camp, market and farm props.

So each location is built as a **place, not a house**: a distinct ground material
plus a prop vocabulary that reads as that location's function. This is what AC #2
allows ("semantically appropriate buildings **or areas**"), and it introduces no new
art asset.

| Location | Reads as |
|---|---|
| Mistwood Station | disused timber platform on the old rail corridor, sealed lockers, encroaching scrub |
| Town Hall | walled civic courtyard around a timber chamber, notice board, records crates |
| Mistwood Chronicle | print-shop floor beside the rail line, newsprint bales, ink barrels, posted notices |
| Lantern Square | paved market ground, stall canopies, produce baskets, lantern posts |
| Juniper Clinic | timber ward with a rear dispensary of bottles and flasks, juniper hedge, herb beds |
| Northwater Mill | mill floor on the Northwater channel, turning wheel, grain sacks, millstones |
| Bellweather Orchard | planted tree rows either side of the disputed access road, packing shed, apple baskets |
| Foxglove Inn | boarding-house yard, dining tables, foxglove beds, cellar pots |

The Chronicle sitting beside the rail line and the mill sitting on the water channel
are both taken from the seed's own descriptions in `convex/canon/mistwoodSeed.ts`.

## Layers

The module exports a `SerializedWorldMap` (`mistwoodWorldMap`) that
`src/components/world/PixiStaticMap.tsx` consumes directly, plus the pieces it is built
from:

- `mistwoodBgTiles` — ground, then ground detail.
- `mistwoodObjectTiles` — structures, then small props.
- `mistwoodCollision` — `1` blocks movement, `0` is walkable. The `SerializedWorldMap`
  contract has no collision field, so this is exported separately for the Visual
  Runtime to consume.
- `mistwoodAnimatedSprites` — the mill wheel (`windmill.json`) and water breaking in
  the channel (`gentlesplash.json`), both already-approved FX sheets.

All layers are `layer[x][y]` with `-1` meaning "no tile", matching the renderer.

## Roads and the canon graph

Everything that is not a location or a road is woodland, and blocked. The roads are
therefore the town's actual circulation, one corridor per undirected edge of the
seed's `connectedLocationIds` graph:

```
station — square      hall — square       clinic — mill
station — paper       hall — paper        square — inn
square — clinic       paper — mill        inn — orchard
                                          orchard — mill
```

`data/mistwood.test.ts` walks the collision layer for each edge with **every other
location's footprint treated as impassable**, so a passing test means the two
locations are joined *directly*, not via a third one.

## Authoring notes

Tile indices are positions in the tileset, `index = tileX + tileY * 45`. The module
is a deterministic builder rather than a dumped array so that the intent of each
location stays legible in review — the tests assert the built output, not the code
shape.

`mistwoodLocationFootprints` records the tile rectangle and prop vocabulary of each
location. It is map-authoring metadata for these tests and for reviewers; the runtime
zone polygons and anchors are FR-N005's contract, not this one.
