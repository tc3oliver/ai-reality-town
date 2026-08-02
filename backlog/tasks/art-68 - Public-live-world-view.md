---
id: ART-68
title: Public live world view
status: To Do
assignee: []
created_date: '2026-08-02 15:43'
updated_date: '2026-08-02 16:27'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-96
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I002

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Deliver the public live view for locations, character positions, active scenes, recent events, world time, and active arcs entirely from the read model.

Scope
Deliver the public live view for locations, character positions, active scenes, recent events, world time, and active arcs entirely from the read model.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-40, ART-96

Schema Impact
No Canon mutation schema; owns published read-model records, query DTOs, cache/version metadata, or UI state explicitly named by the task.

API Impact
Read-only public query contracts and internal projection writers; UI never calls providers.

Security Impact
Server-side field allowlists, publication status, accessibility, and secret/privacy boundaries apply to every public view.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every acceptance criterion and all stated negative or failure cases.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-I002: 不要求高品質遊戲動畫。
- [ ] #2 FR-I002: 場景內容以摘要與精華為主。
- [ ] #3 FR-I002: 公開讀取不得觸發生成。
- [ ] #4 FR-I002: 模擬暫停時仍可瀏覽最後狀態。
- [ ] #5 Automated tests provide evidence for every mapped FR-I002 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-I002 to doc-1 and the merged implementation evidence.
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
