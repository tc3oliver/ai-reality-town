---
id: ART-123
title: Show public conversation and activity hints without leaking private dialogue
status: To Do
assignee: []
created_date: '2026-08-04 15:58'
updated_date: '2026-08-04 16:02'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-119
priority: high
type: feature
ordinal: 123000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O004 (PRD 2.0 §12 Epic O)

**Problem / Context:** Seeing characters talk is central to the live experience, but full private dialogue must never be public and unapproved text must never appear.

**Goal:** Conversation is legible on the map through safe public summaries or status indicators, never raw private dialogue.

**Scope:**
- Public dialogue summary, status or short bubble while characters converse.
- Never render full private conversation.
- Never render content that has not passed safety and publication status.
- Summarise long text so it does not obscure the map.
- Safe fallback state such as "in conversation" when no publishable text exists.

**Out of Scope:** The publication/safety pipeline itself (FR-P004); scene cards (FR-O003).

**Dependencies:** FR-O002 movement and animation rendering.

**Schema Impact:** None.

**API Impact:** Consumes only published, safety-approved public text.

**Security Impact:** A primary leakage surface — requires explicit tests that withheld content cannot render.

**Test Requirements:** Tests that withheld dialogue never renders while the conversing state still shows; long-text summarisation tests; a test that no unapproved text can reach the bubble.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Public dialogue presentation rules.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Conversing characters show a public dialogue summary, status or short bubble
- [ ] #2 Full private conversation is never exposed
- [ ] #3 Content that has not passed safety and publication status is never shown
- [ ] #4 Long content is summarised and does not obscure the main view
- [ ] #5 When no publishable text exists a safe state such as in-conversation is still shown
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
