---
id: ART-9
title: Event-derived character state projection
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:25'
labels:
  - prd-1.0
  - epic-c
milestone: m-0
dependencies:
  - ART-12
  - ART-16
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-B001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Project location, health, emotion, finance, occupation, memberships, availability, and alive/active status exclusively from accepted events.

Scope
Project location, health, emotion, finance, occupation, memberships, availability, and alive/active status exclusively from accepted events.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-12, ART-16

Schema Impact
Versioned character, relationship, location, asset, or organization projection records explicitly named by the task.

API Impact
Typed reducer/projection queries for the named domain state; no direct LLM mutation interface.

Security Impact
Private character state and secret-derived changes remain event-authorized and excluded from public reads unless published.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Reducer tests cover every state field and rejected direct mutation.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-B001: 所有狀態變化必須由 Accepted Event 產生。
- [ ] #2 FR-B001: LLM 不得直接覆寫角色目前狀態。
- [ ] #3 FR-B001: 狀態必須可從 Replay 重建。
- [ ] #4 Automated tests provide evidence for every mapped FR-B001 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-B001 to doc-1 and the merged implementation evidence.
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
