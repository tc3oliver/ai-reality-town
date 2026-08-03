---
id: ART-83
title: Post-commit cognition story and editorial pipeline
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 16:20'
updated_date: '2026-08-03 23:08'
labels:
  - prd-1.0
  - epic-f
milestone: m-0
dependencies:
  - ART-23
  - ART-9
  - ART-78
  - ART-79
  - ART-80
  - ART-81
  - ART-24
  - ART-25
  - ART-10
  - ART-29
  - ART-30
  - ART-31
  - ART-64
  - ART-65
  - ART-82
  - ART-33
  - ART-34
  - ART-66
  - ART-55
  - ART-51
  - ART-40
  - ART-84
  - ART-85
  - ART-95
  - ART-96
  - ART-17
  - ART-57
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 83000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 12 stages 11–21

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Orchestrate projection, knowledge, memory, relationship, arc, episode, recap, safety, publication, snapshot, and metrics stages after accepted-event commit with resumable checkpoints.

Scope
Orchestrate projection, knowledge, memory, relationship, arc, episode, recap, safety, publication, snapshot, and metrics stages after accepted-event commit with resumable checkpoints.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-23, ART-9, ART-78, ART-79, ART-80, ART-81, ART-24, ART-25, ART-10, ART-29, ART-30, ART-31, ART-64, ART-65, ART-82, ART-33, ART-34, ART-66, ART-55, ART-51, ART-40, ART-84, ART-85, ART-95, ART-96, ART-17, ART-57

Schema Impact
Simulation Run, Director Plan, Intent, Scene, checkpoint, failure-stage, and proposal references named by the task.

API Impact
Internal scheduling/orchestration commands with idempotent start, resume, retry, pause, and inspection boundaries.

Security Impact
Generated data is untrusted, knowledge-scoped, safety-checked, and unable to bypass validation or commit directly.

Validation Commands
npm run check; run the task-focused automated or documented manual validation and record exact evidence.

Test Requirements
Tests or documented human evaluation cover every acceptance criterion and applicable negative, retry, and privacy cases.

Documentation Impact
Update relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each post-commit stage has durable status and a safe retry boundary.
- [x] #2 Accepted events remain durable when any downstream stage fails.
- [x] #3 Public content remains at the last valid published version until replacement is ready.
- [x] #4 Retry resumes safely without duplicating events or memories.
- [x] #5 Stage 21 records a durable run/stage metrics hook linked to ART-57 trace data; asynchronous quality evaluators consume it without blocking or mutating Canon.
- [x] #6 Stages 11–21 invoke the completed projection, cognition, story, editorial, safety, publication, snapshot, and trace capabilities in PRD order; the orchestrator does not reimplement those capabilities.
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
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED: convex/operations/ (new module; boundary policy already declared it). postCommitOrchestration.ts (pure, mirrors ART-23 worldDayOrchestration): POST_COMMIT_STAGES (projection→knowledge→memory→relationship→arc→episode→recap→safety→publication→snapshot→metrics, PRD §12 stages 11-21), PostCommitRunStore injectable interface, executePostCommitPipeline (resume-from-safe-boundary via completedPrefix; per-stage durable checkpoints AC#1; failure isolation — never touches accepted events AC#2; retry skips completed stages AC#4; metrics stage records PostCommitMetricsHook linked to traceId via StageContext.traceId AC#5; injectable handlers — orchestrator does NOT reimplement capabilities AC#6). postCommitOrchestrationFunctions.ts (wiring): createPostCommitRun/recordPostCommitCheckpoint/updatePostCommitRun/inspectPostCommitRun over postCommitRuns+postCommitCheckpoints tables (mirror ART-23 store). schema.ts: operationsTables (postCommitRuns, postCommitCheckpoints). Registered via ...operationsTables; added convex/operations to lint dirs.

AC#3 (public content last valid published until replacement): the publication stage DELEGATES to the LKG-aware publication capability (ART-40 publicRead); the orchestrator does not force publication or override LKG.

PRD TRACEABILITY: PRD §12 stages 11-21 -> doc-1.

VALIDATION: npm run check = exit 0. Architecture boundaries valid (policy v1, 11 modules — operations now implemented). typecheck clean. lint clean. Tests: 530 passed (+6 from convex/operations/postCommitOrchestration.test.ts). build OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the post-commit cognition + editorial pipeline orchestrator (PRD §12 stages 11-21): convex/operations/postCommitOrchestration.ts (pure resumable stage sequencer mirroring ART-23 — durable checkpoints AC#1, failure isolation AC#2, safe retry without duplication AC#4, durable metrics hook linked to trace AC#5, injectable handlers that invoke capabilities in PRD order without reimplementing them AC#6) + durable store wiring + tables. AC#3 upheld by delegating publication to the LKG-aware capability. Verified: npm run check exit 0; 530 tests pass (+6); architecture boundaries valid; typecheck/lint/build clean.
<!-- SECTION:FINAL_SUMMARY:END -->
