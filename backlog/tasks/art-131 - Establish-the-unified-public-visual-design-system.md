---
id: ART-131
title: Establish the unified public visual design system
status: To Do
assignee: []
created_date: '2026-08-04 15:59'
updated_date: '2026-08-04 16:02'
labels:
  - prd-2.0
  - v2-h
  - epic-p
dependencies:
  - ART-125
priority: high
type: feature
ordinal: 131000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-P003 (PRD 2.0 §12 Epic P, RISK2-006)

**Problem / Context:** Public pages currently render as plain dark documents resembling an admin console. PRD 2.0 RISK2-006 identifies this as a primary reason the product still reads as a technical demo.

**Goal:** One coherent visual language across live, homepage, Episode, character and arc surfaces.

**Scope:**
- Background, surface, border and accent colours.
- Card treatments for story arc, character, event and Episode.
- Character sprite / portrait containers.
- World day, time slot and status indicators, including Live, Paused, Delayed and Stale.
- Type hierarchy and information density.

**Out of Scope:** Responsive rules (FR-O008); accessibility compliance (NFR2-006).

**Dependencies:** FR-O007 live overlay.

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** The visual layer must not alter Canon semantics.

**Test Requirements:** Visual consistency checks across the five public surfaces; a test that status is not conveyed by colour alone.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Design system reference.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Background, surface, border and accent colours are defined and applied
- [ ] #2 Story arc, character, event and Episode cards share consistent treatments
- [ ] #3 World day, time slot and Live, Paused, Delayed and Stale states have defined indicators
- [ ] #4 Live, homepage, Episode, character and arc surfaces share one design language
- [ ] #5 Public pages no longer read as an admin console or a plain monochrome document
- [ ] #6 The visual layer does not alter Canon semantics
- [ ] #7 Colour is never the only way to identify a state
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
