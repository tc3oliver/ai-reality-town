---
id: ART-41
title: Story-first public homepage
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:27'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-37
  - ART-84
  - ART-85
  - ART-96
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I001; UX-001–UX-006; NFR-002 homepage LCP clause

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Deliver the mobile-accessible homepage with world/day, current situation, core characters, essential backstory, recommended episode, live entry, current vote, and latest major event, prioritizing the present story.

Scope
Deliver the mobile-accessible homepage with world/day, current situation, core characters, essential backstory, recommended episode, live entry, current vote, and latest major event, prioritizing the present story.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-40, ART-37, ART-84, ART-85, ART-96

Schema Impact
No Canon mutation schema; owns published read-model records, query DTOs, cache/version metadata, or UI state explicitly named by the task.

API Impact
Read-only public query contracts and internal projection writers; UI never calls providers.

Security Impact
Server-side field allowlists, publication status, accessibility, and secret/privacy boundaries apply to every public view.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every mapped PRD acceptance condition, negative case, and failure boundary.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-I001: Homepage shows world name/day, Current Situation, core characters, essential backstory, recommended Episode, live entry, current-vote state, and latest major event.
- [ ] #2 First viewport prioritizes the current major event and does not show the complete relationship graph or technical model/token information.
- [ ] #3 Homepage main-content LCP is below 2.5 seconds under the documented mobile profile.
- [ ] #4 Default newcomer disclosure follows UX-001 through UX-006, including one primary arc, at most four core characters, three essential facts, and one entry point.
- [ ] #5 Voting and live sections support unavailable/not-yet-active states without blocking the P0 homepage.
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
