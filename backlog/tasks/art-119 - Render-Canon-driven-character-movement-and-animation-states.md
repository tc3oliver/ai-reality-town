---
id: ART-119
title: Render Canon-driven character movement and animation states
status: To Do
assignee: []
created_date: '2026-08-04 15:58'
updated_date: '2026-08-05 02:49'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-118
  - ART-117
priority: high
type: feature
ordinal: 119000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O002 (PRD 2.0 §12 Epic O)

**Problem / Context:** Canon-driven movement is the only motion type permitted to express a semantic location change (PRD 2.0 UX2-002). The client must interpolate published motion units smoothly and render animation states legibly.

**Goal:** All twelve characters render on the map with smooth cross-location movement and recognisable idle, walking, speaking and thinking states.

**Scope:**
- Interpolate `PublicCharacterMotion` using `startedAt`, `arriveAt` and `motionSequence`.
- Walking animation with correct facing direction.
- Idle animation or a clear static standby state.
- Recognisable speaking / thinking / activity indicators.
- Frame-rate degradation on low-end devices without corrupting semantic state.
- No teleporting unless a Canon event explicitly permits special movement.

**Fixture rule (ART-107 §8):** Any deterministic-fixture development or test must use IDs from the production Mistwood seed (`convex/canon/mistwoodSeed.ts`). Production acceptance, and any other V2 Dynamic Live work, must never use `convex/canon/legacyCanonTestFixture.ts` (renamed from `mistwoodFixture.ts`; Cassia/Rowan at `mistwood-market`/`mistwood-grove` are not real Mistwood seed locations).

**Out of Scope:** Ambient in-zone behaviour (FR-O011); dialogue content and safety filtering (FR-O004); replay playback (FR-O013).

**Dependencies:** FR-O001 live map; FR-N006 Canon/runtime sync.

**Schema Impact:** None.

**API Impact:** Consumer of the public dynamic projection.

**Security Impact:** None beyond the projection boundary.

**Test Requirements:** Interpolation correctness against fixed motion fixtures (Mistwood-seed IDs only); animation-state mapping tests; a test proving reduced frame rate does not change semantic location.

**Validation Commands:**
- `npm run check`
- Browser E2E: a character moves smoothly from point A to point B.

**Documentation Impact:** Motion rendering and animation-state documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All twelve characters can display on the map
- [ ] #2 Canon location changes render as smooth cross-location movement
- [ ] #3 Stationary characters show an idle animation or a clear static standby state
- [ ] #4 Moving characters show a walking animation with correct facing direction
- [ ] #5 Speaking, thinking and special activity have recognisable indicators
- [ ] #6 Characters never teleport unless a Canon event explicitly permits special movement
- [ ] #7 Low-performance devices may reduce update rate without corrupting semantic state
- [ ] #8 Implementation may proceed against deterministic fixtures, but production acceptance requires ART-139 fixed and cross-location movement verified from accepted events produced by the real provider
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
