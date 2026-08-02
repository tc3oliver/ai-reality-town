---
id: ART-79
title: Location connectivity and occupancy projection
status: To Do
assignee: []
created_date: '2026-08-02 16:19'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-c
milestone: m-0
dependencies:
  - ART-12
  - ART-16
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 13.4; FR-D004 location rules

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Project location definitions, connectivity, capacity, active state, and occupancy from accepted events for scheduling and Canon validation.

Scope
Project location definitions, connectivity, capacity, active state, and occupancy from accepted events for scheduling and Canon validation.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-12, ART-16

Schema Impact
Versioned character, relationship, location, asset, or organization projection records explicitly named by the task.

API Impact
Typed reducer/projection queries for the named domain state; no direct LLM mutation interface.

Security Impact
Private character state and secret-derived changes remain event-authorized and excluded from public reads unless published.

Validation Commands
npm run check; run the task-focused automated or documented manual validation and record exact evidence.

Test Requirements
Tests or documented human evaluation cover every acceptance criterion, negative case, retry boundary, and privacy rule applicable to this task.

Documentation Impact
Update relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Location IDs, connectivity, capacity, and active state are replayable.
- [ ] #2 Character occupancy agrees with character-location projection for every sequence.
- [ ] #3 Invalid, inactive, over-capacity, and impossible connected-location transitions are rejected or flagged according to Canon rules.
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
