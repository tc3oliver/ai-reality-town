---
id: ART-109
title: Build the Mistwood-specific tilemap from the existing tileset
status: To Do
assignee: []
created_date: '2026-08-04 15:57'
updated_date: '2026-08-04 16:00'
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
- [ ] #1 data/mistwood.ts exists and renders in the existing tilemap renderer
- [ ] #2 All eight canonical Mistwood locations are represented by semantically appropriate buildings or areas
- [ ] #3 Only the existing tileset is used; no new art asset is introduced
- [ ] #4 Background, object and collision layers are present and structurally valid
- [ ] #5 Walkable routes between locations are consistent with the seed connectedLocationIds graph
- [ ] #6 Map tile dimensions and layer shape are compatible with the existing renderer
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->
