---
id: ART-50
title: Audited canon correction workflows
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:27'
labels:
  - prd-1.0
  - epic-m
milestone: m-0
dependencies:
  - ART-49
  - ART-17
  - ART-40
  - ART-84
  - ART-85
  - ART-95
  - ART-96
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-K003

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Create Correction, Compensation, and Retcon events with operator/reason audit, replay consistency, and public-content refresh.

Scope
Create Correction, Compensation, and Retcon events with operator/reason audit, replay consistency, and public-content refresh.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-49, ART-17, ART-40, ART-84, ART-85, ART-95, ART-96

Schema Impact
Simulation control, review, correction, publication, model-config, kill-switch, operator audit, and queue/run records named by the task.

API Impact
Authenticated administrative commands and queries with explicit roles and audit trails.

Security Impact
Every mutation is server-authorized, reasoned, auditable, secret-safe, and non-destructive to accepted history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Integration tests cover each correction type, replay, read-model refresh, and authorization.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-K003: 不得刪除 Accepted Event。
- [ ] #2 FR-K003: Retcon 必須記錄操作者與理由。
- [ ] #3 FR-K003: 修正後 Replay 結果一致。
- [ ] #4 FR-K003: 公開內容需依修正更新。
- [ ] #5 FR-K003: 重大 Retcon 應保留稽核紀錄。
- [ ] #6 Automated tests provide evidence for every mapped FR-K003 acceptance criterion, including rejection and failure paths.
- [ ] #7 PRD traceability links FR-K003 to doc-1 and the merged implementation evidence.
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
