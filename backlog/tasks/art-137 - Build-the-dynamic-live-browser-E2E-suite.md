---
id: ART-137
title: Build the dynamic live browser E2E suite
status: To Do
assignee: []
created_date: '2026-08-04 16:00'
updated_date: '2026-08-05 02:49'
labels:
  - prd-2.0
  - v2-k
  - epic-o
dependencies:
  - ART-126
  - ART-121
priority: high
type: feature
ordinal: 137000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-Q006 (PRD 2.0 §12 Epic Q) — realizes §21.3

**Problem / Context:** PRD 2.0 §22 requires browser E2E evidence on desktop and mobile as a release gate. The dynamic surface has many interacting parts whose regressions are invisible to unit tests, and the zero-mutation and zero-LLM guarantees need runtime evidence, not only static reasoning.

**Goal:** An automated browser E2E suite that exercises the full dynamic viewing experience and proves the zero-mutation and zero-LLM guarantees at runtime.

**Scope:**
- `/live` loads the map.
- At least four fixture characters visible; twelve in the public acceptance environment.
- A character moves smoothly from A to B.
- Idle, walking, speaking and thinking states are distinguishable.
- Clicking a character opens the card; clicking an active scene focuses and summarises.
- Pan, zoom and return to town view.
- Mobile bottom sheet or equivalent works.
- Replay auto-plays once then enters ambient state; manual replay works.
- No network request contains an unauthorized mutation.
- LLM call count does not increase during the run.

**Fixture rule (ART-107 §8):** The four fixture characters must be drawn from the production Mistwood seed (`convex/canon/mistwoodSeed.ts`), never from `convex/canon/legacyCanonTestFixture.ts` (renamed from `mistwoodFixture.ts`; its Cassia/Rowan characters and `mistwood-market`/`mistwood-grove` locations are not part of the real Mistwood seed).

**Out of Scope:** Performance measurement (ART-136); security probing (ART-128).

**Dependencies:** ART-126 (responsive experience), ART-121 (replay and time-state labelling).

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** Provides runtime evidence for the zero-mutation and zero-LLM guarantees.

**Test Requirements:** The suite itself is the deliverable; it must run headless in CI.

**Validation Commands:**
- `npm run check`
- The E2E suite passing on desktop and mobile viewports.

**Documentation Impact:** E2E coverage documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /live loads the map in the E2E environment
- [ ] #2 At least four fixture characters are visible, and twelve in the public acceptance environment
- [ ] #3 A character is observed moving smoothly from one point to another
- [ ] #4 Idle, walking, speaking and thinking states are distinguishable
- [ ] #5 Clicking a character opens the character card
- [ ] #6 Clicking an active scene focuses the camera and shows its summary
- [ ] #7 Pan, zoom and return to town view all work
- [ ] #8 The mobile bottom sheet or equivalent presentation works
- [ ] #9 Replay auto-plays once and then enters the ambient state, and manual replay works
- [ ] #10 No network request during the run contains an unauthorized mutation
- [ ] #11 LLM call count does not increase during the run
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
