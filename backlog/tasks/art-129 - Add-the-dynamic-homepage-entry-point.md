---
id: ART-129
title: Add the dynamic homepage entry point
status: To Do
assignee: []
created_date: '2026-08-04 15:59'
updated_date: '2026-08-04 16:02'
labels:
  - prd-2.0
  - v2-h
  - epic-p
dependencies:
  - ART-118
  - ART-111
priority: high
type: feature
ordinal: 129000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-P001 (PRD 2.0 §12 Epic P)

**Problem / Context:** The homepage currently presents text headings and lists, which PRD 2.0 §4.1 identifies as the core product gap. UX2-001 requires viewers to see the world before reading about it.

**Goal:** A homepage first screen that leads with the living world and routes viewers into it.

**Scope:**
- Live Town entry point or dynamic preview above the fold.
- Current situation, primary active story arc, up to four core characters, latest major event, recommended Episode.
- Core characters rendered with their existing sprite / visual identity.
- Clicking a character, scene or arc navigates to the corresponding page.

**Out of Scope:** Live page itself (FR-O001); design system (FR-P003).

**Dependencies:** FR-O001 live map; FR-N004 character visual bindings.

**Schema Impact:** None.

**API Impact:** Consumes existing public read projections.

**Security Impact:** Public homepage must trigger no LLM call.

**Test Requirements:** Tests asserting the first screen is not text-only, that character visuals match bindings, and that the homepage triggers no generation.

**Validation Commands:**
- `npm run check`
- Browser E2E of the homepage first screen.

**Documentation Impact:** Homepage composition notes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The homepage first screen provides a Live Town entry point or dynamic preview
- [ ] #2 The first screen shows current situation, primary story arc, up to four core characters, the latest major event and a recommended Episode
- [ ] #3 The first screen is not only text headings and lists
- [ ] #4 Core characters use their existing sprite and visual identity
- [ ] #5 Clicking a character, scene or arc navigates to the corresponding page
- [ ] #6 The public homepage triggers no LLM call
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
