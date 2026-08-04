---
id: ART-120
title: Implement ambient in-zone movement and environmental animation
status: To Do
assignee: []
created_date: '2026-08-04 15:58'
updated_date: '2026-08-04 16:01'
labels:
  - prd-2.0
  - v2-g
  - epic-o
dependencies:
  - ART-114
  - ART-110
priority: high
type: feature
ordinal: 120000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O011, FR-O012 (PRD 2.0 §12 Epic O, §9.1.2, §9.1.3)

**Problem / Context:** Canon advances only five times per real day, so a purely Canon-driven view is static for hours. PRD 2.0 §9.1.2 permits narratively meaningless in-zone activity to keep the world alive, under strict limits, and RISK2-008 warns that ambient motion must never be mistaken for plot.

**Goal:** Characters remain visibly alive inside their current Canon zone, and the environment animates, without producing or implying any Canon fact.

**Scope:**
- Ambient behaviours strictly inside the current Canon location zone: walking, standby, sitting, reading, working, facing environment objects, short back-and-forth movement.
- Deterministic seeding by characterId + locationId + worldDay + timeBucket so concurrent viewers see consistent behaviour.
- Visual distinction from Canon-driven movement.
- Environmental animation: water, trees, smoke, lighting, weather, day/night, building ambience.
- Reduced Motion disables ambient and environmental animation.

**Out of Scope:** Canon-driven movement (FR-O002); replay (FR-O013); dialogue rendering (FR-O004).

**Dependencies:** FR-N010 Visual Runtime; FR-N005 location bindings (ambientAnchors).

**Schema Impact:** None persisted beyond deterministic derivation.

**API Impact:** Published as `motionType: "ambient"` within the existing projection.

**Security Impact:** Must create no accepted event and must not mutate Canon, memory, knowledge, relationships or story arcs — asserted by test.

**Test Requirements:** Zone-boundary tests (ambient never leaves the zone), determinism tests across repeated derivations, an integration test asserting zero accepted events result from ambient activity, and Reduced Motion behaviour tests.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Ambient and environmental animation rules, including the RISK2-008 mitigation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Ambient movement never leaves the character current Canon location zone
- [ ] #2 Ambient movement creates no accepted event and does not change Canon, memory, knowledge, relationships or story arcs
- [ ] #3 Ambient movement never starts a new character conversation
- [ ] #4 Ambient behaviour is deterministically seeded by characterId, locationId, worldDay and timeBucket
- [ ] #5 Concurrent viewers see reproducible and broadly consistent ambient activity
- [ ] #6 Ambient movement is visually distinguishable from Canon-driven movement
- [ ] #7 Environmental animation does not modify world state
- [ ] #8 Reduced Motion disables ambient and environmental animation
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
