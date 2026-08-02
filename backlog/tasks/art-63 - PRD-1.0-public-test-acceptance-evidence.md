---
id: ART-63
title: PRD 1.0 public-test acceptance evidence
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:59'
labels:
  - prd-1.0
  - epic-q
milestone: m-0
dependencies:
  - ART-61
  - ART-62
  - ART-74
  - ART-75
  - ART-92
  - ART-93
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 20, Milestone 8

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Collect requirement-to-task/test/PR evidence and verify all 25 public-test criteria, P0 coverage, non-blocking P1 status, CI gates, kill switch, safety, replay, comprehension, and operations.

Scope
Collect requirement-to-task/test/PR evidence and verify all 25 public-test criteria, P0 coverage, non-blocking P1 status, CI gates, kill switch, safety, replay, comprehension, and operations.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-61, ART-62, ART-74, ART-75, ART-92, ART-93

Schema Impact
No product domain schema; owns release checklist, audit findings, traceability, and verification evidence.

API Impact
Read-only audit/verification access to completed public and administrative boundaries.

Security Impact
Release remains blocked by missing evidence, unresolved Critical/High findings, or enabled production deployment.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Run the full offline gate, long-run suites, acceptance checklist, and traceability audit.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Public Test: 可連續模擬 30 個世界日。
- [ ] #2 Public Test: Replay 一致率 100%。
- [ ] #3 Public Test: 無角色位置衝突。
- [ ] #4 Public Test: 無死者不合理出場。
- [ ] #5 Public Test: 無來源 Secret 洩漏。
- [ ] #6 Public Test: Duplicate Event 不會重複提交。
- [ ] #7 Public Test: 所有高重要度 Event 被摘要涵蓋。
- [ ] #8 Public Test: 同時主要 Active Arc 不超過 3。
- [ ] #9 Public Test: 至少一條 Arc 完成合理 Turning Point。
- [ ] #10 Public Test: 至少一條 Arc 進入 Resolving 或 Resolved。
- [ ] #11 Public Test: 新觀眾 30 秒理解測試通過。
- [ ] #12 Public Test: 三分鐘前情可理解目前主線。
- [ ] #13 Public Test: 公開讀取不觸發 LLM。
- [ ] #14 Public Test: 模擬停止時歷史內容仍可讀取。
- [ ] #15 Public Test: Kill Switch 驗證通過。
- [ ] #16 Public Test: Correction Event 與 Replay 驗證通過。
- [ ] #17 Public Test: 高風險內容不會直接公開。
- [ ] #18 Public Test: 管理者可暫停、恢復、重試與查看失敗。
- [ ] #19 Public Test: Typecheck、Lint、Tests、Build 與 CI 全部通過。
- [ ] #20 Public Test: Server-side Authorization Audit 完成。
- [ ] #21 Public Test: 無已知 Critical／High 安全缺陷。
- [ ] #22 Public Test: License 與 Attribution 保留。
- [ ] #23 Public Test: Production Deployment 未被自動啟用。
- [ ] #24 Public Test: PRD P0 Requirement 全部具備驗證證據。
- [ ] #25 Public Test: P1 未完成項目不影響公開測試安全與核心體驗。
- [ ] #26 Every P0 requirement links to merged implementation and objective verification evidence; incomplete P1 work is explicitly shown not to compromise safety or core experience.
- [ ] #27 A versioned PRD closure matrix classifies every normative clause in Sections 1–23 as delivered P0 evidence, explicitly deferred P1/P2 ownership, or non-goal; every in-scope clause has a task and objective verification reference, with no unowned clause.
- [ ] #28 The closure audit verifies implemented scope does not accidentally include MVP non-goals such as production deployment, real-person simulation, direct NPC control, unreviewed external publishing, payments, native apps, or unrestricted viewer chat.
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
