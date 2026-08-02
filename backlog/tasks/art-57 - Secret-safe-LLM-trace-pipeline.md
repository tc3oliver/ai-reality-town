---
id: ART-57
title: Secret-safe LLM trace pipeline
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-o
milestone: m-0
dependencies:
  - ART-3
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Record world/day/run/scene/arc/characters, model/prompt version, token counts, latency, retries, validation, and final status with redaction and access control.

Scope
Record world/day/run/scene/arc/characters, model/prompt version, token counts, latency, retries, validation, and final status with redaction and access control.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-3

Schema Impact
Versioned LLM trace, budget, degradation, evaluator, metric-definition, aggregate, and reason-dimension records named by the task.

API Impact
Authorized observability/configuration queries and internal accounting/evaluation interfaces.

Security Impact
Metrics and traces redact secrets, resist duplicate counting, and cannot become or mutate Canon.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Trace completeness, correlation, authorization, and redaction tests pass.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-M001: Every model call records World ID, World Day, Run ID, Scene ID, Arc ID, Character IDs, Model, Prompt Version, Input Tokens, Output Tokens, Latency, Retry Count, Validation Result, and Final Status.
- [ ] #2 Trace fields have defined optionality for calls without scene, arc, or character context.
- [ ] #3 Complete prompts and secrets are redacted from public and unauthorized trace access.
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
