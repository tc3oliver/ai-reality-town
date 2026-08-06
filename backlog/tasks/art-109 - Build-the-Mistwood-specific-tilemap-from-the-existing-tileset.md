---
id: ART-109
title: Build the Mistwood-specific tilemap from the existing tileset
status: Done
assignee: []
created_date: '2026-08-04 15:57'
updated_date: '2026-08-06 08:32'
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
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered `data/mistwood.ts`: a 48x36 Mistwood-specific tilemap built entirely from the existing approved tileset `public/assets/gentle-obj.png`, replacing the generic a16z demo layout for FR-N009.

Approach and the constraint that shaped it: the only tileset cleared for the public bundle is gentle-obj.png (ASSETS-LICENSE.md quarantines magecity.png / rpg-tileset.png / tilemap.json), and that tileset contains no town buildings — it is terrain plus camp, market and farm props. Verified by decoding the tileset and reading labelled contact sheets of every candidate region rather than guessing indices. So each location is built as a place rather than a house, which is exactly what AC #2's "buildings **or areas**" permits and which introduces no new art. The Chronicle beside the rail line and the mill on the water channel are taken from the seed's own descriptions in convex/canon/mistwoodSeed.ts.

Verification evidence:
- `npm run check` on the merged branch: 86 test suites, 1150 passed / 5 skipped, plus architecture boundaries, asset-licence gate, typecheck, lint and vite build all clean.
- `data/mistwood.test.ts`: 23 tests. Renderer compatibility (tileset divides exactly into 45x32 tiles, `tileX + tileY * 45` indexing, layer shape is what PixiStaticMap derives width/height from); every tile index is -1 or in range; ground layer has no holes; collision is strictly 0/1; animated sprites sit on approved sheets inside map bounds; all eight footprint ids and names equal the seed's locations; footprints do not overlap; every location has structures and walkable tiles; no two locations share an identical prop signature (this is the assertion that stops the map degenerating back into anonymous grass); declared road edges equal the seed's undirected connectedLocationIds set; and each edge has a walkable route with every *other* location's footprint treated as impassable, in both directions.
- That connectivity test caught a real defect during development: the Foxglove Inn's canopy was sitting on the yard gate and blocking the inn->orchard road. Fixed by moving the canopy south.
- Booted in the **real PixiJS renderer**: `PixiStaticMap` mounted behind a temporary, uncommitted vite entry in a live browser. Canvas 1536x1152 (= 48x36 tiles at 32px), WebGL context present, 100% of sampled pixels painted across 1286 distinct colours, with spot samples matching the design (sand on the rail corridor and the square, dark teal water in the mill channel, canopy green in the woodland). The animated mill wheel (windmill.json) and channel splashes (gentlesplash.json) render. The temp entry was removed before committing.
- AC #3 is now CI-enforced, not just review-asserted: `data/mistwood.ts` was added to `assets/asset-licenses.json` and to `PUBLIC_BUNDLE_PATHS`, so `npm run check:asset-licenses` fails if the map ever loses its approved licence record (15 public-bundle assets verified).

Merged as PR #162 (https://github.com/tc3oliver/ai-reality-town/pull/162), merge commit b62757c, both required checks green ("Offline checks (typecheck, lint, test, build)" and "Autonomous control plane + offline quality"). The branch was created before ART-143 landed, so origin/main was merged in and two conflicts resolved by hand: the FR-N008/FR-N009 rows of the PRD matrix (kept ART-143's FR-N008 row alongside the new FR-N009 row) and `assets/asset-licenses.json`, where an earlier whole-file reformat was discarded in favour of main's file plus a single minimal entry.

Follow-up noted, not in scope here: ART-144 already records that `PUBLIC_BUNDLE_PATHS` and vite's actual `dist/` output disagree; adding the map to that list inherits the same known gap and does not widen it.
<!-- SECTION:NOTES:END -->
