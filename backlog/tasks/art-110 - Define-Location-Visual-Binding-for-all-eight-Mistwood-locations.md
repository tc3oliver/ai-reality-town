---
id: ART-110
title: Define Location Visual Binding for all eight Mistwood locations
status: Done
assignee:
  - '@claude-art110'
created_date: '2026-08-04 15:57'
updated_date: '2026-08-06 09:29'
labels:
  - prd-2.0
  - v2-b
  - epic-n
dependencies:
  - ART-109
priority: high
type: feature
ordinal: 110000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N005 (PRD 2.0 §12 Epic N, decision §24.22)

**Problem / Context:** Canon owns semantic locations (`mistwood-clinic`, `mistwood-paper`, …) but has no geometry. The renderer needs zone polygons, entry anchors, ambient anchors and a scene focus point per location before any Canon-driven movement, zone-arrival detection or ambient activity can work. PRD 2.0 raises the P0 bar from "at least six locations" to "all eight".

**Goal:** Establish a validated, versioned mapping from each Canon `locationId` to map geometry.

**Scope:**
- Define the `LocationVisualBinding` shape: `locationId`, `zonePolygon`, `entryAnchors`, `ambientAnchors`, `sceneFocusPoint`, `publicLabel`, plus `status` and `version`.
- Author bindings for all eight Mistwood locations against `data/mistwood.ts`.
- Import-time validation: reject unknown locationIds, degenerate polygons, and unreasonable zone overlap.
- Zone-arrival helper based on polygon containment, not pixel equality.

**Out of Scope:** Movement planning (FR-N010); sync state machine (FR-N006); character bindings (FR-N004).

**Dependencies:** FR-N009 Mistwood map.

**Schema Impact:** New `LocationVisualBinding` persisted shape (PRD 2.0 §14.2), versioned and auditable.

**API Impact:** Internal read surface for the Visual Runtime; not directly public.

**Security Impact:** `publicLabel` is public text; must contain no private Canon detail.

**Test Requirements:** Unit tests for binding validation (unknown location rejected, degenerate polygon rejected, unreasonable overlap rejected) and zone-arrival containment.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Location binding reference documenting each zone and its anchors.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All eight canonical Mistwood locations have a valid Location Visual Binding
- [x] #2 Zones do not overlap unreasonably and validation rejects degenerate geometry
- [x] #3 Arrival detection uses zone containment rather than exact pixel equality
- [x] #4 A Canon location with no binding is never published as a visible position
- [x] #5 ambientAnchors are sufficient to support in-zone ambient activity
- [x] #6 Bindings are versioned and auditable
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a `visualBinding` module to `architecture/module-boundaries.json` (roots `convex/visualBinding`, mayDependOn canon + shared), per PRD 2.0 NFR2-008 which requires Visual Binding to be separated from Canon Domain and Visual Runtime; extend the lint script and `docs/architecture/module-boundaries.md` accordingly, and add a policy test proving canon may not depend on visualBinding.
2. `convex/visualBinding/locationBinding.ts`: define `LocationVisualBinding` (id, worldId, mapId, locationId, zoneType, zonePolygon, entryAnchors, ambientAnchors, sceneFocusPoint, publicLabel, status, version) in map tile coordinates, plus `LocationVisualBindingError` with typed codes and a `validateLocationVisualBindings` that rejects unknown/duplicate Canon locationIds, degenerate polygons (<3 vertices, non-finite, non-convex, ~zero area), anchors outside their own zone, missing anchors, and unreasonable pairwise zone overlap (exact convex clip area over the smaller zone, above a documented ratio).
3. Same module: zone-arrival helpers built on ray-cast polygon containment, never coordinate equality — `isPointInZone`, `hasArrivedAtLocation`, `findLocationAtPoint`, `resolveLocationVisualBinding`, and a publishable-position guard so a Canon location without an active binding can never be published as a visible position.
4. `convex/visualBinding/mistwoodLocationBindings.ts`: author the eight bindings by deriving geometry from ART-109 rather than re-inventing it — `mistwoodLocationFootprints` gives each zone rectangle, `mistwoodCollision` gives walkable tiles for anchors (entry anchors = in-zone walkable tiles that touch a walkable tile outside the zone, i.e. the actual road mouths; ambient anchors = deterministic farthest-point spread over in-zone walkable tiles), publicLabel comes from the Canon world configuration name. Validate at import time so an invalid map or seed fails the import, and export a set version for auditability.
5. Tests: `locationBinding.test.ts` for validation rejections and containment/arrival semantics (including 'a different point inside the same zone still counts as arrival' and 'exact anchor equality is not required'); `mistwoodLocationBindings.test.ts` for all eight locations bound, zones disjoint, anchors walkable and in-zone, entry anchors reachable from outside, labels equal to public Canon names and free of private detail, and determinism across repeated imports.
6. Docs and traceability: `docs/mistwood-location-bindings.md` reference listing every zone and its anchors; update `docs/prd-2.0-requirement-matrix.md` FR-N005 row; then `npm run check`, commit, rebase on main, open PR with auto-merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Approach

Added a `visualBinding` module (`convex/visualBinding/`) rather than putting geometry in Canon: PRD 2.0 §10.6 forbids Canon from holding `zonePolygon`/anchors/`mapId`, and NFR2-008 requires Visual Binding to be a module separate from Canon Domain and Visual Runtime. The module is registered in `architecture/module-boundaries.json` with `mayDependOn: [canon, shared]`, added to the lint and foundation-test scripts, documented in `docs/architecture/module-boundaries.md`, and covered by a new policy test proving canon may not depend on visualBinding.

`locationBinding.ts` owns the contract: `LocationVisualBinding` (id, worldId, mapId, locationId, zoneType, zonePolygon, entryAnchors, ambientAnchors, sceneFocusPoint, publicLabel, status, version), a typed `LocationVisualBindingError`, import-time `validateLocationVisualBindings`, and zone arrival built on ray-cast polygon containment. Zone polygons must be convex, which keeps overlap measurement exact (Sutherland–Hodgman clipping) instead of sampled; every Mistwood zone is a map rectangle. `createdAt`/`updatedAt` from PRD §14.2 are deliberately left to persistence (ART-116); the authored set is a versioned constant.

`mistwoodLocationBindings.ts` authors nothing by hand. Zone polygons come from `mistwoodLocationFootprints`, entry anchors are the in-zone walkable tiles touching a walkable tile outside the zone (which, given everything else is blocked woodland, are exactly the mouths of the ART-109 roads), ambient anchors are a deterministic farthest-point spread, scene focus is the footprint centre, and `publicLabel` is the Canon location name. All coordinates are map tile coordinates; anchors are tile centres.

## Defect found and fixed during implementation

The first derivation picked ambient anchors from raw walkable tiles and produced two unusable anchors: (44, 13) on the far bank of the Northwater channel inside the mill zone, and (39, 34) in a two-tile pocket sealed behind the orchard packing-shed crates. Both are walkable but unreachable. Ambient anchors are now taken from a flood fill seeded by the entry anchors, and `mistwoodLocationBindings.test.ts` asserts reachability independently (its own BFS) plus a named regression test for the mill's far bank.

## Decisions

- Entry anchors are derived, not authored, so a map edit that seals a location off fails the test suite instead of silently publishing an unreachable zone. The clinic has three entry anchors rather than four because the juniper hedge blocks tile (19, 18).
- `publicLabel` is taken from the Canon location `name` (already public); a test asserts no Canon `description` text leaks into any label.
- Unreasonable overlap is defined as more than 10% of the smaller zone's area (`MAX_ZONE_OVERLAP_RATIO`); the eight Mistwood zones are in fact completely disjoint, which the tests assert directly.

## Rebase onto ART-111 (module consolidation)

ART-111 (Character Visual Binding) merged first and created the Visual Binding module as `convex/visual/` with `mayDependOn: [canon, shared]`. This branch had independently created `convex/visualBinding/` with identical semantics, which would have left the repo with two modules meaning the same thing. On rebase the work was consolidated into the existing `convex/visual/` root:

- `locationBinding.ts` → `convex/visual/locationVisualBinding.ts` (mirrors their `characterVisualBinding.ts`), `mistwoodLocationBindings.ts` → `convex/visual/mistwoodLocationBindings.ts`, tests likewise.
- Dropped the duplicate `visualBinding` policy entry and the duplicate lint entry; kept `visual` from main and extended `test:foundation` to `canon|simulation|visual` so both halves of the module run in the offline gate.
- Added the persisted `locationVisualBindings` table to `convex/visual/schema.ts` (PRD §14.2) alongside their `characterVisualBindings`, with the same versioned/retired auditing rule and `mapId` on the row because geometry does not survive a new map.
- Boundary policy test now asserts `convex/visual/locationVisualBinding.ts` resolves to the `visual` module and that canon may not depend on it; added the missing Visual Binding row to `docs/architecture/module-boundaries.md`.
- Resolved the `docs/prd-2.0-requirement-matrix.md` conflict by keeping ART-111's FR-N004 row intact and updating only the FR-N005 row.

## Merge evidence

PR #166 (https://github.com/tc3oliver/ai-reality-town/pull/166) merged to main as 0a6e0356 at 2026-08-06T09:25:51Z. Both required workflows green on the merged head: 'Offline checks (typecheck, lint, test, build)' SUCCESS and 'Autonomous control plane + offline quality' SUCCESS.

Force push is blocked in this repo, so after the rebase onto ART-111 the superseded pre-rebase tip was merged in with `-s ours` (tree identical to the rebased branch, verified by `git diff HEAD <rebased-tip>` returning empty) and pushed as a fast-forward. The merged diff against main is exactly the eleven ART-110 files; ART-111's task file and sources are untouched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Bound all eight canonical Mistwood locations to map geometry (FR-N005), landing in the `convex/visual/` Visual Binding module alongside ART-111's character bindings.

**Contract** — `convex/visual/locationVisualBinding.ts` defines `LocationVisualBinding` (id, worldId, mapId, locationId, zoneType, zonePolygon, entryAnchors, ambientAnchors, sceneFocusPoint, publicLabel, status, version) in map tile coordinates, plus import-time validation that rejects unknown or duplicate Canon locationIds, degenerate polygons (fewer than three vertices, non-finite or collinear points, non-convex rings, sub-tile area), anchors outside their own zone, anchor sets too thin for ambient activity, active zones overlapping by more than 10% of the smaller zone, and any required Canon location left unbound. Zone arrival is ray-cast polygon containment (`hasArrivedAtLocation`, `findLocationZoneAtPoint`), never coordinate equality, and `resolvePublishableLocationZone` returns `undefined` for an unbound or retired location so it can never be published as a visible position. The persisted `locationVisualBindings` row shape (PRD §14.2) is added to `convex/visual/schema.ts`.

**Bindings** — `convex/visual/mistwoodLocationBindings.ts` derives every field from data that already exists rather than inventing coordinates: zone polygons from `mistwoodLocationFootprints` (ART-109), entry anchors from the in-zone walkable tiles that touch walkable ground outside the zone (the actual mouths of the seed-graph roads), ambient anchors from a deterministic farthest-point spread over tiles reachable on foot from an entry anchor, and `publicLabel` from the Canon location name. Validated at import time, so a map or seed edit that strands a location fails the import instead of publishing a broken zone.

**Defect caught while reviewing the derived output** — raw walkability had put ambient anchors at (44, 13) on the far bank of the Northwater channel and at (39, 34) in a two-tile pocket sealed behind the orchard packing-shed crates; both are walkable but unreachable. Ambient anchors now come from an entry-seeded flood fill, with an independent reachability test and a named regression test for the mill's far bank.

**Verification** — `npm run check` passes end to end after the rebase onto ART-111: `Architecture boundaries valid (policy v1, 11 modules)`, boundary policy tests pass, asset-license checks pass, `tsc --noEmit` clean, eslint clean, `Test Suites: 90 passed` / `Tests: 5 skipped, 1219 passed, 1224 total` (33 of them new across `locationVisualBinding.test.ts` and `mistwoodLocationBindings.test.ts`), and `tsc && vite build` succeeds. Evidence in PR #166.

**Documentation** — `docs/mistwood-location-bindings.md` records the coordinate space, the shape, the derivation rules, every zone with its anchors and scene focus, the validation codes and the arrival semantics; `docs/architecture/module-boundaries.md` gains the Visual Binding row; `docs/prd-2.0-requirement-matrix.md` FR-N005 row updated.
<!-- SECTION:FINAL_SUMMARY:END -->
