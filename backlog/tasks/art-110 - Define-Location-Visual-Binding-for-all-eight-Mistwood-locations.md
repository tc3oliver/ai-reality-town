---
id: ART-110
title: Define Location Visual Binding for all eight Mistwood locations
status: To Do
assignee: []
created_date: '2026-08-04 15:57'
updated_date: '2026-08-04 16:00'
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
- [ ] #1 All eight canonical Mistwood locations have a valid Location Visual Binding
- [ ] #2 Zones do not overlap unreasonably and validation rejects degenerate geometry
- [ ] #3 Arrival detection uses zone containment rather than exact pixel equality
- [ ] #4 A Canon location with no binding is never published as a visible position
- [ ] #5 ambientAnchors are sufficient to support in-zone ambient activity
- [ ] #6 Bindings are versioned and auditable
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
