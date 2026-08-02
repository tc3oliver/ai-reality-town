---
id: ART-18
title: Idempotent world scheduler and run state
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:57'
labels:
  - prd-1.0
  - epic-f
milestone: m-0
dependencies:
  - ART-17
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-C001; Sections 10.1–10.2

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Trigger each world time slot once with pause, resume, manual execution, safe retry, and inspectable schedule/run state.

Scope
Trigger each world time slot once with pause, resume, manual execution, safe retry, and inspectable schedule/run state.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-17

Schema Impact
Simulation Run, Director Plan, Intent, Scene, checkpoint, failure-stage, and proposal references named by the task.

API Impact
Internal scheduling/orchestration commands with idempotent start, resume, retry, pause, and inspection boundaries.

Security Impact
Generated data is untrusted, knowledge-scoped, safety-checked, and unable to bypass validation or commit directly.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Clock-controlled integration tests cover slot uniqueness, controls, failures, and retries.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-C001: 同一世界時段不得重複執行。
- [ ] #2 FR-C001: 支援暫停、恢復與手動觸發。
- [ ] #3 FR-C001: 任務失敗可以安全重試。
- [ ] #4 FR-C001: 重試不得重複提交已接受事件。
- [ ] #5 FR-C001: 管理者可查看目前排程與執行狀態。
- [ ] #6 Automated tests provide evidence for every mapped FR-C001 acceptance criterion, including rejection and failure paths.
- [ ] #7 PRD traceability links FR-C001 to doc-1 and the merged implementation evidence.
- [ ] #8 Section 10.1: Public mode defaults to one real calendar day per world day and advances through Morning, Noon, Afternoon, Evening, and Night in order.
- [ ] #9 Section 10.2: Development/test controls can pause time, advance exactly one time slot, advance exactly one world day, and run accelerated simulation.
- [ ] #10 Section 10.2: Fixed-seed clock-controlled runs reproduce the same scheduled slot sequence and do not publish unless explicitly enabled.
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
