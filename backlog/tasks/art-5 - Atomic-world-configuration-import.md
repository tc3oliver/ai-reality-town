---
id: ART-5
title: Atomic world configuration import
status: To Do
assignee: []
created_date: '2026-08-02 15:30'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-b
milestone: m-0
dependencies:
  - ART-3
  - ART-4
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-A001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Import structured world, location, organization, immutable-rule, and history data with runtime validation and atomic failure behavior.

Scope
Import structured world, location, organization, immutable-rule, and history data with runtime validation and atomic failure behavior.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-3, ART-4

Schema Impact
World import/seed schemas for world, locations, organizations, history, rules, characters, relationships, knowledge, secrets, and assets named by the task.

API Impact
Validated administrative import/readiness commands; imports are atomic and unavailable to public callers.

Security Impact
Seed/import data rejects real-person data, invalid references, unsafe defaults, and partial writes.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Automated tests cover valid import, invalid references, immutable-rule availability, and rollback on failure.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-A001: 可從結構化設定匯入世界。
- [ ] #2 FR-A001: 匯入時執行 Runtime Schema Validation。
- [ ] #3 FR-A001: 無效參照必須被拒絕。
- [ ] #4 FR-A001: 世界建立後產生 Initial Snapshot。
- [ ] #5 FR-A001: 不可變世界規則必須可被 Canon Validator 讀取。
- [ ] #6 FR-A001: 匯入失敗不得產生部分世界。
- [ ] #7 Automated tests provide evidence for every mapped FR-A001 acceptance criterion, including rejection and failure paths.
- [ ] #8 PRD traceability links FR-A001 to doc-1 and the merged implementation evidence.
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
