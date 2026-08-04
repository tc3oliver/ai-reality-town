---
id: ART-114
title: Build the lightweight Visual Runtime and movement trajectory planner
status: To Do
assignee: []
created_date: '2026-08-04 15:58'
updated_date: '2026-08-04 16:13'
labels:
  - prd-2.0
  - v2-d
  - epic-n
dependencies:
  - ART-110
  - ART-111
priority: high
type: feature
ordinal: 114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N010 (PRD 2.0 §12 Epic N)

**Problem / Context:** With the a16z engine retired, nothing converts Canon semantic locations into on-map coordinates and paths. PRD 2.0 §10.3 requires a replacement runtime that contains no LLM path and cannot mutate Canon.

**Goal:** A deterministic Visual Runtime that derives movement trajectories from Canon/Public Read Model plus the visual bindings, and produces the motion units the projection publishes.

**Scope:**
- Visual Sync Planner: resolve a semantic location change into a start anchor, a target entry anchor and a walkable path over the Mistwood collision layer.
- Trajectory production: `from`, `to`, `startedAt`, `arriveAt`, `direction`, `animationState`, `motionSequence`.
- Deterministic ambient anchor selection seeded by characterId + locationId + worldDay + timeBucket (consumed by FR-O011).
- Deterministic fixtures for testing without any provider.

**Out of Scope:** The published projection contract (FR-N003); the Canon sync state machine (FR-N006); ambient behaviour semantics (FR-O011); client interpolation (FR-O002).

**Dependencies:** FR-N005 location bindings; FR-N004 character bindings.

**Schema Impact:** May persist derived trajectory state; must not write Canon.

**API Impact:** Internal producer for the public projection.

**Security Impact:** Must contain no LLM call path and no Canon write path — both asserted by test.

**Test Requirements:** Determinism tests (identical inputs produce identical trajectories), path validity against collision data, and assertions that no provider import and no Canon write exists in the module graph.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Visual Runtime design note including the Canon / Visual Runtime responsibility split.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Movement trajectories are derived from Canon or the Public Read Model plus visual bindings
- [ ] #2 The runtime module graph contains no LLM call path
- [ ] #3 The runtime never writes to the Canon event store
- [ ] #4 Character coordinates are never written back to the backend per frame
- [ ] #5 Ambient anchor selection is deterministic given characterId, locationId, worldDay and timeBucket
- [ ] #6 The runtime is testable with deterministic fixtures and no external API
- [ ] #7 New Convex modules are registered in architecture/module-boundaries.json with dependency rules that forbid the visual runtime from importing any Canon write path, and npm run check:architecture passes
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
