---
id: ART-7
title: Initial tension readiness validator
status: To Do
assignee: []
created_date: '2026-08-02 15:30'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-b
milestone: m-0
dependencies:
  - ART-6
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-A003

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Validate the required conflict, secret, dependency, misconception, emotional-tension, shared-misunderstanding, and launchable-arc counts before warmup.

Scope
Validate the required conflict, secret, dependency, misconception, emotional-tension, shared-misunderstanding, and launchable-arc counts before warmup.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-6

Schema Impact
World import/seed schemas for world, locations, organizations, history, rules, characters, relationships, knowledge, secrets, and assets named by the task.

API Impact
Validated administrative import/readiness commands; imports are atomic and unavailable to public callers.

Security Impact
Seed/import data rejects real-person data, invalid references, unsafe defaults, and partial writes.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests cover every threshold and administrator-readable result output.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-A003: 缺少必要張力時，世界不得進入公開暖機。
- [ ] #2 FR-A003: 系統應產生具體缺失報告。
- [ ] #3 FR-A003: 張力檢查結果必須可由管理者查看。
- [ ] #4 Automated tests provide evidence for every mapped FR-A003 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-A003 to doc-1 and the merged implementation evidence.
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
