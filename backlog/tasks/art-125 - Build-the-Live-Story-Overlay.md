---
id: ART-125
title: Build the Live Story Overlay
status: To Do
assignee: []
created_date: '2026-08-04 15:59'
updated_date: '2026-08-04 16:02'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-118
priority: high
type: feature
ordinal: 125000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O007 (PRD 2.0 §12 Epic O)

**Problem / Context:** A map alone shows what is happening but not why it matters. PRD 2.0 UX2-004 requires narrative context to be permanently available alongside the map.

**Goal:** A collapsible story information area that never obscures the map and always answers what is happening, why it matters, who is involved and where to catch up.

**Scope:**
- World day and time slot, current situation, primary active story arc, active scenes, latest major event, recommended Episode / recap entry.
- Sourced from the public read model, never the Canon write store.
- Collapsible; mobile does not require showing everything simultaneously.

**Out of Scope:** Visual design system (FR-P003); responsive layout rules (FR-O008); navigation continuity (FR-P002).

**Dependencies:** FR-O001 live map.

**Schema Impact:** None.

**API Impact:** Consumes existing public read model projections.

**Security Impact:** Must not trigger summary generation on public view.

**Test Requirements:** Tests asserting the overlay reads only public projections, triggers no generation, and stays in reasonable sync with map state.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Live overlay content contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The overlay shows world day and time slot, current situation, primary story arc, active scenes and the latest major event
- [ ] #2 The overlay offers a recommended Episode or recap entry point
- [ ] #3 The overlay reads the public read model and never the Canon write store
- [ ] #4 Overlay content and map state stay in sync within a reasonable interval
- [ ] #5 The overlay is collapsible and does not obscure the map
- [ ] #6 Public viewing never triggers summary generation
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
