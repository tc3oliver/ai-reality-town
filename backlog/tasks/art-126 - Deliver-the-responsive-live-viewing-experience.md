---
id: ART-126
title: Deliver the responsive live viewing experience
status: To Do
assignee: []
created_date: '2026-08-04 15:59'
updated_date: '2026-08-04 16:02'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-125
  - ART-124
priority: high
type: feature
ordinal: 126000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O008 (PRD 2.0 §12 Epic O)

**Problem / Context:** The live surface combines a canvas map with overlay cards, which is the layout most likely to break on small screens. PRD 2.0 §22 makes mobile E2E a release gate.

**Goal:** A usable live experience on both desktop and mobile, in both orientations.

**Scope:**
- Desktop: map and story overlay visible together.
- Mobile: map-first with bottom-sheet or equivalent cards.
- Adequate touch target sizes for primary controls.
- No blocking overflow in portrait or landscape.
- Character and scene cards remain openable on small screens.

**Out of Scope:** Accessibility compliance (NFR2-006); visual design system (FR-P003).

**Dependencies:** FR-O007 story overlay; FR-O006 character card.

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** None.

**Test Requirements:** Responsive E2E across desktop and mobile viewports in both orientations, including opening character and scene cards on small screens.

**Validation Commands:**
- `npm run check`
- Browser E2E at mobile and desktop viewports.

**Documentation Impact:** Responsive layout notes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Desktop displays the map and story overlay simultaneously
- [ ] #2 Mobile is map-first with bottom-sheet or equivalent card presentation
- [ ] #3 Primary controls have adequate touch target sizes
- [ ] #4 Neither portrait nor landscape produces blocking overflow
- [ ] #5 Character and scene cards can still be opened on small screens
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
