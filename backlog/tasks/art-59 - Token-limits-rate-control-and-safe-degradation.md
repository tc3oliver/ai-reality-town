---
id: ART-59
title: Token budget rate and concurrency controls
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-28 18:44'
labels:
  - prd-1.0
  - epic-o
milestone: m-0
dependencies:
  - ART-52
  - ART-18
  - ART-57
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M003; Section 16.3 resource measurement

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Enforce daily, module, model, concurrency, and retry budgets and expose deterministic over-budget decisions and resource measurements.

Scope
Enforce daily, module, model, concurrency, and retry budgets and expose deterministic over-budget decisions and resource measurements.

Out of Scope
Ordered model-outage degradation workflow, provider implementation, and production deployment.

Dependencies
ART-52, ART-18, ART-57

Schema Impact
Versioned LLM trace, budget, degradation, evaluator, metric-definition, aggregate, and reason-dimension records named by the task.

API Impact
Authorized observability/configuration queries and internal accounting/evaluation interfaces.

Security Impact
Metrics and traces redact secrets, resist duplicate counting, and cannot become or mutate Canon.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
Tests cover every limit, concurrent reservations, retry accounting, day rollover, audit history, and deterministic over-budget response.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-M003: Enforce daily token, per-module, per-model, concurrency, and retry-budget limits.
- [ ] #2 FR-M003: A configured over-budget strategy is selected deterministically and audited.
- [ ] #3 Resource reporting measures retry-token share, fast-model routing share, public-read LLM calls, outage availability, and daily cap compliance.
- [ ] #4 Section 16.3: Retry Token usage is measured and must not exceed 10% of total token usage.
- [ ] #5 Section 16.3: More than 80% of low-importance work is routed to the configured fast-model class.
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
