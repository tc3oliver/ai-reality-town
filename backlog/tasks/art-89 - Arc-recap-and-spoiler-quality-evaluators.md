---
id: ART-89
title: Arc recap and spoiler quality evaluators
status: To Do
assignee: []
created_date: '2026-08-02 16:20'
updated_date: '2026-08-02 16:45'
labels:
  - prd-1.0
  - epic-o
milestone: m-0
dependencies:
  - ART-32
  - ART-35
  - ART-57
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M002 story editorial metrics

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Compute Arc Progress, Arc Stagnation, Recap Coverage, and Spoiler Violation metrics.

Scope
Compute Arc Progress, Arc Stagnation, Recap Coverage, and Spoiler Violation metrics.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-32, ART-35, ART-57

Schema Impact
Versioned LLM trace, budget, degradation, evaluator, metric-definition, aggregate, and reason-dimension records named by the task.

API Impact
Authorized observability/configuration queries and internal accounting/evaluation interfaces.

Security Impact
Metrics and traces redact secrets, resist duplicate counting, and cannot become or mutate Canon.

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
- [ ] #1 Metrics derive from accepted events, arc state, and published summaries.
- [ ] #2 Results identify exact omitted or violating sources.
- [ ] #3 Operator queries expose components and evaluator version.
- [ ] #4 Section 16.2: At least 95% of high-importance Accepted Events are covered by a published recap or carry an explicit, reviewable exclusion reason.
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
