---
id: ART-83
title: Post-commit cognition story and editorial pipeline
status: To Do
assignee: []
created_date: '2026-08-02 16:20'
updated_date: '2026-08-02 16:51'
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
- [ ] #1 Each post-commit stage has durable status and a safe retry boundary.
- [ ] #2 Accepted events remain durable when any downstream stage fails.
- [ ] #3 Public content remains at the last valid published version until replacement is ready.
- [ ] #4 Retry resumes safely without duplicating events or memories.
- [ ] #5 Stage 21 records a durable run/stage metrics hook linked to ART-57 trace data; asynchronous quality evaluators consume it without blocking or mutating Canon.
- [ ] #6 Stages 11–21 invoke the completed projection, cognition, story, editorial, safety, publication, snapshot, and trace capabilities in PRD order; the orchestrator does not reimplement those capabilities.
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
