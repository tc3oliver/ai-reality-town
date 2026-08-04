---
id: ART-130
title: 'Connect Live, Episode, character and arc navigation'
status: To Do
assignee: []
created_date: '2026-08-04 15:59'
updated_date: '2026-08-04 16:02'
labels:
  - prd-2.0
  - v2-h
  - epic-p
dependencies:
  - ART-122
  - ART-124
priority: high
type: feature
ordinal: 130000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-P002 (PRD 2.0 §12 Epic P)

**Problem / Context:** Live Town and the editorial surfaces currently exist as disconnected routes, so viewers cannot move between "what is happening now" and "what it means".

**Goal:** Continuous navigation in both directions between the live world and editorial content, without losing viewing context.

**Scope:**
- Ended active scenes link to the related Episode or event.
- Episodes link back to the related characters and their map locations.
- Story arcs link to their core characters or scenes currently on the map.
- Recommended entry openable directly from the live overlay.
- Preserve viewing progress and current focus across navigation.

**Out of Scope:** Overlay content (FR-O007); homepage entry (FR-P001).

**Dependencies:** FR-O003 active scene visualization; FR-O006 character card.

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** None.

**Test Requirements:** Navigation E2E in both directions asserting focus and progress are preserved.

**Validation Commands:**
- `npm run check`
- Browser E2E of live-to-Episode and Episode-to-map navigation.

**Documentation Impact:** Navigation map documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An ended active scene links to the related Episode or event
- [ ] #2 An Episode links back to related characters and their map locations
- [ ] #3 A story arc links to its core characters or scenes on the map
- [ ] #4 The recommended entry can be opened directly from the live overlay
- [ ] #5 Navigation preserves viewing progress and current focus
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
