---
id: ART-109
title: Build the Mistwood-specific tilemap from the existing tileset
status: To Do
assignee: []
created_date: '2026-08-04 15:57'
updated_date: '2026-08-06 08:23'
labels:
  - prd-2.0
  - v2-b
  - epic-n
dependencies:
  - ART-107
priority: high
type: feature
ordinal: 109000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N009 (PRD 2.0 §12 Epic N, decision §24.21)

**Problem / Context:** The inherited map (`data/gentle.js`) is a generic a16z town containing none of Mistwood's eight canonical locations. Binding Canon locations onto it would make the clinic, newsroom, mill and orchard resolve to unrelated buildings or grass, which PRD 2.0 §24.21 explicitly forbids and RISK2-006 identifies as the main "still looks like a tech demo" failure mode.

**Goal:** Produce `data/mistwood.ts` — a Mistwood-specific tilemap built only from the existing tileset — where all eight canonical locations are represented by semantically appropriate buildings and areas.

**Scope:**
- Author `data/mistwood.ts` with background, object and collision layers, compatible with the existing tilemap renderer contract (tile dimension, layer shape).
- Represent all eight locations: Mistwood Station, Lantern Square, Town Hall, Mistwood Chronicle, Juniper Clinic, Northwater Mill, Bellweather Orchard, Foxglove Inn.
- Lay out walkable routes consistent with the seed `connectedLocationIds` graph in `convex/canon/mistwoodSeed.ts`.
- Verify the map loads in the existing renderer.

**Out of Scope:** Zone polygons and anchors (FR-N005); character placement (FR-N004); any new art asset — the existing tileset only.

**Dependencies:** FR-N001 audit (tilemap format and renderer contract).

**Schema Impact:** None (static map data module).

**API Impact:** None.

**Security Impact:** None.

**Test Requirements:** Unit test asserting map structural validity (layer dimensions consistent, collision layer present) and that all eight location areas are addressable.

**Validation Commands:**
- `npm run check`
- Renderer smoke: load `data/mistwood.ts` in the tilemap renderer and confirm it draws.

**Documentation Impact:** Map authoring notes describing the location layout and the connectivity it encodes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 data/mistwood.ts exists and renders in the existing tilemap renderer
- [x] #2 All eight canonical Mistwood locations are represented by semantically appropriate buildings or areas
- [x] #3 Only the existing tileset is used; no new art asset is introduced
- [x] #4 Background, object and collision layers are present and structurally valid
- [x] #5 Walkable routes between locations are consistent with the seed connectedLocationIds graph
- [x] #6 Map tile dimensions and layer shape are compatible with the existing renderer
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root constraint found during research: the only licence-approved tileset for the public bundle is `public/assets/gentle-obj.png` (ASSETS-LICENSE.md quarantines magecity.png / rpg-tileset.png / tilemap.json), and that tileset contains **no town buildings at all** — it is terrain plus camp/market/farm props. Verified by decoding the tileset and inspecting labelled contact sheets of every candidate region rather than guessing indices.

So each location is built as a place rather than a house, which is what AC #2's 'buildings **or areas**' allows and which introduces no new art: station = timber platform + sealed lockers on the old rail corridor; hall = walled courtyard around a timber chamber + notice board + records crates; paper = print-shop floor beside the rail line + newsprint bales + ink barrels; square = paved market ground + stall canopies + produce baskets + lantern posts; clinic = timber ward + rear dispensary of bottles/flasks + juniper hedge + herb beds; mill = mill floor on the Northwater channel + animated wheel + grain sacks + millstones; orchard = planted tree rows either side of the disputed access road + packing shed; inn = boarding-house yard + dining tables + foxglove beds.

Implementation shape: `data/mistwood.ts` is a deterministic builder (seeded, no randomness at import) rather than a dumped array, so the intent of each location stays reviewable; the tests assert the built output. Exports `mistwoodWorldMap` (SerializedWorldMap, consumed directly by PixiStaticMap), `mistwoodBgTiles` (ground + detail), `mistwoodObjectTiles` (structures + props), `mistwoodCollision` (explicit 0/1 layer — the SerializedWorldMap contract has no collision field), `mistwoodAnimatedSprites` (windmill.json wheel + gentlesplash.json water, both already-approved FX sheets), and `mistwoodLocationFootprints`/`mistwoodRoadEdges` as map-authoring metadata for the tests.

Everything outside a location or a road is woodland and blocked, so the roads are the town's real circulation. One road corridor per undirected edge of the seed's connectedLocationIds graph (10 edges). The connectivity test BFSes the collision layer with every *other* location's footprint treated as impassable, so a pass proves a **direct** route, not a route via a third location. That test caught a real defect: the inn's canopy was sitting on the yard gate and blocking the inn->orchard road; the canopy was moved south.

Also registered `data/mistwood.ts` in `assets/asset-licenses.json` + `PUBLIC_BUNDLE_PATHS`, so AC #3 (no new art asset) is now CI-enforced by `npm run check:asset-licenses` rather than only asserted in review.
<!-- SECTION:NOTES:END -->
