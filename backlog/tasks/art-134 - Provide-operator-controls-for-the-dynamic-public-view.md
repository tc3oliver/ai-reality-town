---
id: ART-134
title: Provide operator controls for the dynamic public view
status: To Do
assignee: []
created_date: '2026-08-04 15:59'
updated_date: '2026-08-04 16:03'
labels:
  - prd-2.0
  - v2-i
  - epic-q
dependencies:
  - ART-133
priority: medium
type: feature
ordinal: 134000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-Q002 (PRD 2.0 §12 Epic Q) — P1

**Problem / Context:** Operators need to intervene in the public visual layer (pause updates, hide a character or scene, rebuild the projection) without touching Canon or bypassing the correction workflow.

**Goal:** Operator control over the public visual layer only, with Canon integrity preserved.

**Scope:**
- Pause public runtime updates.
- Force use of the last valid snapshot.
- Hide the public visual for an individual character or scene.
- Inspect binding and synchronization errors.
- Rebuild the public dynamic projection.

**Out of Scope:** Canon corrections (PRD 1.0, delivered); emergency stop (PRD 1.0, delivered).

**Dependencies:** FR-Q001 observability.

**Schema Impact:** Operator control state for the dynamic layer.

**API Impact:** Authenticated operator endpoints only.

**Security Impact:** Must reuse the existing operator authorization and audit path; must not permit Canon event modification or bypass of the correction workflow.

**Test Requirements:** Authorization tests, tests that controls cannot modify Canon events, and audit-trail tests.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Operator runbook additions for the dynamic layer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Operators can pause public runtime updates
- [ ] #2 Operators can force use of the last valid snapshot
- [ ] #3 Operators can hide the public visual for an individual character or scene
- [ ] #4 Operators can inspect binding and synchronization errors
- [ ] #5 Operators can rebuild the public dynamic projection
- [ ] #6 Operator controls cannot modify Canon events
- [ ] #7 Operator controls cannot bypass the correction workflow
- [ ] #8 All operator actions reuse the existing authorization and audit path
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
