---
id: ART-23
title: Core world-day proposal and commit orchestration
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:45'
labels:
  - prd-1.0
  - epic-f
milestone: m-0
dependencies:
  - ART-22
  - ART-17
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 12 stages 1–10

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Orchestrate load state, environment events, arcs, Director, intents, grouping, scene simulation, structural/Canon validation, and accepted-event commit with durable checkpoints.

Scope
Orchestrate load state, environment events, arcs, Director, intents, grouping, scene simulation, structural/Canon validation, and accepted-event commit with durable checkpoints.

Out of Scope
Post-commit projections, cognition, story/editorial generation, publication, snapshots, metrics, and production deployment.

Dependencies
ART-22, ART-17

Schema Impact
Simulation Run, Director Plan, Intent, Scene, checkpoint, failure-stage, and proposal references named by the task.

API Impact
Internal scheduling/orchestration commands with idempotent start, resume, retry, pause, and inspection boundaries.

Security Impact
Generated data is untrusted, knowledge-scoped, safety-checked, and unable to bypass validation or commit directly.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
Failure injection covers every pre-commit boundary, retry, duplicate commit, and partial-write rejection.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Section 12 stages 1–10 execute in order with durable run and checkpoint status.
- [ ] #2 Structural and Canon validation failures reject the proposal without any partial Canon write.
- [ ] #3 Accepted-event commit is durable and idempotent; retry cannot duplicate an accepted event.
- [ ] #4 A failure records its exact stage and stable error information, and retry resumes only from a safe boundary.
- [ ] #5 Automated failure-injection tests cover every pre-commit boundary, duplicate commit, and partial-write rejection.
- [ ] #6 PRD traceability links Section 12 stages 1–10 to doc-1 and merged implementation evidence.
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
