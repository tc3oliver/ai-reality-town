---
id: ART-18
title: Idempotent world scheduler and run state
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 19:18'
labels:
  - prd-1.0
  - epic-f
milestone: m-0
dependencies:
  - ART-17
references:
  - 'https://github.com/tc3oliver/ai-reality-town/pull/35'
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
- [x] #1 FR-C001: 同一世界時段不得重複執行。
- [x] #2 FR-C001: 支援暫停、恢復與手動觸發。
- [x] #3 FR-C001: 任務失敗可以安全重試。
- [x] #4 FR-C001: 重試不得重複提交已接受事件。
- [x] #5 FR-C001: 管理者可查看目前排程與執行狀態。
- [x] #6 Automated tests provide evidence for every mapped FR-C001 acceptance criterion, including rejection and failure paths.
- [x] #7 PRD traceability links FR-C001 to doc-1 and the merged implementation evidence.
- [x] #8 Section 10.1: Public mode defaults to one real calendar day per world day and advances through Morning, Noon, Afternoon, Evening, and Night in order.
- [x] #9 Section 10.2: Development/test controls can pause time, advance exactly one time slot, advance exactly one world day, and run accelerated simulation.
- [x] #10 Section 10.2: Fixed-seed clock-controlled runs reproduce the same scheduled slot sequence and do not publish unless explicitly enabled.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Define a deterministic scheduler state/cursor and slot-run contract for the five ordered world slots, public 24-hour clock mapping, fixed seeds, publication isolation, and stable slot/idempotency keys. 2. Implement pure clock-controlled pause/resume, public tick, manual one-slot/day, accelerated reservation, lifecycle failure/retry, and uniqueness behavior with an in-memory reference engine. 3. Persist schedule and slot state in Convex with internal configure/control/lifecycle/inspection operations; retries reuse the same slot row and Canon idempotency key. 4. Add clock-controlled integration tests for every FR-C001 and Sections 10.1–10.2 criterion, update docs/codegen, run full gates, finalize, and auto-merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented a deterministic five-slot scheduler, stable slot/Canon idempotency keys, fixed seed derivation, 24-hour public mapping, pause anchor shifting, manual slot/day and 1–90 day acceleration, publication isolation, durable lifecycle/retry state, internal inspection, and a minute Convex cron for all running public worlds. Development Convex codegen succeeded. Focused clock suite passed 6 tests. Full npm run check passed architecture, typecheck, lint, 23 suites/253 tests, and build. Tests prove repeated clock ticks reserve one row, post-commit timeout retry reuses one key/event, controls work while paused, fixed-seed sequences reproduce, and non-public runs remain unpublished unless explicitly enabled. AC7 and DoD1/13/14 remain merge-evidence dependent.

Implementation committed and pushed on feat/ART-18-world-scheduler.

Implementation PR #35 merged into main on 2026-08-02T19:11:50Z after all required checks passed. FR-C001 is now linked to doc-1 and merged evidence.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered FR-C001 and Sections 10.1–10.2 via merged PR #35: unique five-slot public scheduling, cron triggering, pause/resume, exact manual and accelerated controls, deterministic unpublished test runs, safe same-key retries, and internal inspection. Full pre-merge check passed 253 tests.
<!-- SECTION:FINAL_SUMMARY:END -->
