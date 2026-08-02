---
id: ART-49
title: Proposed-event validation and trace review
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-m
milestone: m-0
dependencies:
  - ART-15
  - ART-57
  - ART-48
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-K002

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Show proposals, validation/rejection results, traces, participants, state changes, arcs, and safety labels to authorized operators.

Scope
Show proposals, validation/rejection results, traces, participants, state changes, arcs, and safety labels to authorized operators.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-15, ART-57, ART-48

Schema Impact
Simulation control, review, correction, publication, model-config, kill-switch, operator audit, and queue/run records named by the task.

API Impact
Authenticated administrative commands and queries with explicit roles and audit trails.

Security Impact
Every mutation is server-authorized, reasoned, auditable, secret-safe, and non-destructive to accepted history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Authorization, redaction, filtering, and result-rendering tests pass.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-K002: Event review shows Proposed Event, Validation Result, Rejection Reason, Model Trace, participants, state changes, related arcs, and Safety Label.
- [ ] #2 Review data is filterable and secret-safe for authorized operators only.
- [ ] #3 Stable validation reason codes render without free-text classification logic.
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
