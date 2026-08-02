---
id: ART-58
title: Continuity and Canon quality metrics
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-o
milestone: m-0
dependencies:
  - ART-57
  - ART-15
  - ART-17
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M002 continuity metrics; Section 16.2 Canon targets

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Compute Continuity Score and report Canon conflict, replay, secret-leak, deceased-character, and location-conflict quality targets.

Scope
Compute Continuity Score and report Canon conflict, replay, secret-leak, deceased-character, and location-conflict quality targets.

Out of Scope
Narrative, story/editorial, rejection-rate, safety-rate evaluators, and production deployment.

Dependencies
ART-57, ART-15, ART-17

Schema Impact
Versioned LLM trace, budget, degradation, evaluator, metric-definition, aggregate, and reason-dimension records named by the task.

API Impact
Authorized observability/configuration queries and internal accounting/evaluation interfaces.

Security Impact
Metrics and traces redact secrets, resist duplicate counting, and cannot become or mutate Canon.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
Deterministic fixtures verify calculation, thresholds, aggregation, duplicate-run handling, and source traceability.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-M002: Continuity Score is calculated with documented inputs and version.
- [ ] #2 World-quality reporting exposes severe Canon conflicts, replay consistency, unsourced secret leaks, invalid deceased-character appearances, and location conflicts.
- [ ] #3 Metrics trace to validation, replay, and accepted-event evidence without becoming Canon.
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
