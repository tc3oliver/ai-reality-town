---
id: ART-8
title: Private world warmup workflow
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:57'
labels:
  - prd-1.0
  - epic-b
milestone: m-0
dependencies:
  - ART-7
  - ART-77
  - ART-83
  - ART-40
  - ART-67
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-A004; Sections 10.2–10.3

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Run 30–60 configurable unpublished world days with pause, resume, rerun, launch-episode recommendation, and isolation from public reads.

Scope
Run 30–60 configurable unpublished world days with pause, resume, rerun, launch-episode recommendation, and isolation from public reads.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-7, ART-77, ART-83, ART-40, ART-67

Schema Impact
World import/seed schemas for world, locations, organizations, history, rules, characters, relationships, knowledge, secrets, and assets named by the task.

API Impact
Validated administrative import/readiness commands; imports are atomic and unavailable to public callers.

Security Impact
Seed/import data rejects real-person data, invalid references, unsafe defaults, and partial writes.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Integration tests prove unpublished isolation, resumability, rerun safety, and failure recovery.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-A004: 暖機期間內容不得出現在公開 Read Model。
- [ ] #2 FR-A004: 暖機可暫停、恢復與重跑。
- [ ] #3 FR-A004: 公開前至少產生一條 Active Story Arc。
- [ ] #4 FR-A004: 公開起始 Episode 可由系統建議並由管理者確認。
- [ ] #5 FR-A004: 暖機失敗不得污染公開資料。
- [ ] #6 Automated tests provide evidence for every mapped FR-A004 acceptance criterion, including rejection and failure paths.
- [ ] #7 PRD traceability links FR-A004 to doc-1 and the merged implementation evidence.
- [ ] #8 Section 10.3: World actual start day, public broadcast start day, and recommended newcomer entry point are persisted as distinct, queryable markers.
- [ ] #9 Section 10.3: Public broadcast may start after Day 1, and changing the confirmed public start never rewrites warmed Canon history.
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
