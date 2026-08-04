---
id: ART-124
title: Build the public character card
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
  - ART-111
priority: high
type: feature
ordinal: 124000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O006 (PRD 2.0 §12 Epic O)

**Problem / Context:** Clicking a character is the primary path from "who is that" to narrative understanding, and is a direct private-data exposure risk.

**Goal:** A public character card showing identity, current public status and narrative context, with private fields structurally excluded.

**Scope (shown):** name and sprite/portrait, occupation and public background, current public location or movement state, public emotional/activity state, public goal, active story arc membership, recent major events, link to the character page.

**Scope (never shown):** private goal, undisclosed secrets, private memories, prompts or model output, operator annotations.

**Out of Scope:** The character page itself (PRD 1.0 FR-I005, already delivered); relationship graph (ART-44).

**Dependencies:** FR-O001 live map; FR-N004 character visual bindings.

**Schema Impact:** None.

**API Impact:** Consumes the public projection and existing public character projection.

**Security Impact:** High — requires explicit negative tests for every forbidden field.

**Test Requirements:** Negative tests asserting private goal, secrets, memories, prompts and operator notes cannot appear; visual identity consistency test across map, card and Episode.

**Validation Commands:**
- `npm run check`
- Browser E2E: clicking a character opens its card.

**Documentation Impact:** Public character card field contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Clicking a character opens a card with name, sprite or portrait, occupation and public background
- [ ] #2 The card shows current public location or movement state and public activity state
- [ ] #3 The card shows the public goal, active story arc and recent major events
- [ ] #4 The card links to the character page
- [ ] #5 Private goal, undisclosed secrets, private memories, prompts and operator annotations are never shown
- [ ] #6 The character visual identity matches the map and Episode surfaces
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
