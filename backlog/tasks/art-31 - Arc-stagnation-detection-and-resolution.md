---
id: ART-31
title: Arc stagnation detection and resolution
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:27'
labels:
  - prd-1.0
  - epic-h
milestone: m-0
dependencies:
  - ART-64
  - ART-30
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-F005

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Detect 14-day stagnation and support outcome suggestions, merge, downgrade, resolving, archive, and background compression with consequence updates.

Scope
Detect 14-day stagnation and support outcome suggestions, merge, downgrade, resolving, archive, and background compression with consequence updates.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-64, ART-30

Schema Impact
Versioned Story Arc state, fields, event links, lifecycle, scores, outcomes, and summary-consequence references named by the task.

API Impact
Deterministic arc classification/lifecycle/query interfaces; public ordering consumes published projections only.

Security Impact
Arc data cannot reveal unpublished facts or mutate Canon outside accepted events.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Time-controlled tests cover alerts, every closure path, and summary consequences.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-F005: A 14-world-day stagnation produces an operator-visible prompt.
- [ ] #2 FR-F005: A major Arc cannot disappear without a valid lifecycle transition and retained history.
- [ ] #3 FR-F005: Resolved Arc retains Outcome and Consequences.
- [ ] #4 Resolution emits source-proven consequence data consumed by ART-82 for character/world summary refresh.
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
