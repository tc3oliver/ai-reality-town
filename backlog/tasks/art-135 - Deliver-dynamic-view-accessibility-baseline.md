---
id: ART-135
title: Deliver dynamic view accessibility baseline
status: To Do
assignee: []
created_date: '2026-08-04 15:59'
updated_date: '2026-08-04 16:51'
labels:
  - prd-2.0
  - v2-j
  - epic-o
dependencies:
  - ART-126
  - ART-120
priority: high
type: feature
ordinal: 135000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-Q004 (PRD 2.0 §12 Epic Q) — realizes NFR2-006 (PRD 2.0 §16)

**Problem / Context:** A canvas-rendered animated map is inherently hostile to keyboard and assistive technology users, and continuous ambient motion is a vestibular risk. PRD 2.0 §22 makes Reduced Motion and a non-map alternative view release gates. FR-Q004 exists so this non-functional requirement has a traceable requirement id and a named owner rather than being implied across other tasks.

**Goal:** The dynamic world is comprehensible and navigable without using the map canvas.

**Scope:**
- Equivalent non-map list of characters, locations and scenes.
- Keyboard focus for primary characters and scenes.
- Reduced Motion support, including disabling ambient movement, environmental animation and replay auto-play.
- Animation and status state never conveyed by colour alone.
- Readable text alternatives for important information.

**Out of Scope:** Graph and timeline accessibility (ART-94, carried forward per PRD 2.0 §13).

**Dependencies:** ART-126 (responsive experience), ART-120 (ambient and environmental animation).

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** None.

**Test Requirements:** Keyboard navigation tests, Reduced Motion behaviour tests, non-map alternative view tests, and a check that state is not colour-only.

**Validation Commands:**
- `npm run check`
- Accessibility checks over the live surface.

**Documentation Impact:** Update the accessibility documentation with the dynamic surface.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An equivalent non-map list of characters, locations and scenes is available
- [ ] #2 Primary characters and scenes are keyboard focusable
- [ ] #3 Reduced Motion disables ambient movement, environmental animation and replay auto-play
- [ ] #4 Animation and status states are not conveyed by colour alone
- [ ] #5 Important information has a readable text alternative
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
