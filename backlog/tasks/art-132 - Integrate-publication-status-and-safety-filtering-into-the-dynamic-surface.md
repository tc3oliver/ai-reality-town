---
id: ART-132
title: Integrate publication status and safety filtering into the dynamic surface
status: To Do
assignee: []
created_date: '2026-08-04 15:59'
updated_date: '2026-08-04 17:14'
labels:
  - prd-2.0
  - v2-h
  - epic-p
dependencies:
  - ART-115
  - ART-121
  - ART-122
priority: critical
type: feature
ordinal: 132000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-P004 (PRD 2.0 §12 Epic P)

**Problem / Context:** The dynamic layer introduces new public text surfaces — bubbles, scene cards, overlay — each a path by which unapproved or withheld content could reach viewers. Removing text must not disturb Canon or character positions.

**Goal:** Every public text on the dynamic surface is provably published and safety-approved, and withholding text never corrupts world state.

**Scope:**
- Live overlay shows only published, publicly permitted content.
- Withheld scenes show only a safe generic state or are hidden entirely.
- Safety status updates propagate to remove content from the public projection.
- Removing public text leaves Canon and character positions intact.
- Every public text traceable to an accepted event or published summary.

**Out of Scope:** The safety classifier itself (PRD 1.0, delivered); dialogue presentation (FR-O004).

**Dependencies:** FR-N003 public dynamic projection; FR-O003 active scene visualization.

**Schema Impact:** Publication status carried on public presentation records.

**API Impact:** Projection filters by publication status.

**Security Impact:** Primary content-safety gate for the new dynamic surface.

**Test Requirements:** Tests that withheld content never publishes, that a safety status change removes already-published text, that removal does not alter Canon or positions, and traceability of every public string.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Publication and safety integration notes for the dynamic layer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The live overlay shows only published and publicly permitted content
- [ ] #2 Withheld scenes show only a safe generic state or are hidden entirely
- [ ] #3 A safety status update removes the affected content from the public projection
- [ ] #4 Removing public text does not affect Canon or character positions
- [ ] #5 Every public text is traceable to an accepted event or a published summary
- [ ] #6 A withhold or supersede of published content invalidates or rebuilds every Visual Replay referencing it, verified by test
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
