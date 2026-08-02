---
id: ART-78
title: Canonical fact and world environment projection
status: To Do
assignee: []
created_date: '2026-08-02 16:19'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-e
milestone: m-0
dependencies:
  - ART-12
  - ART-16
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 13.5; Section 13.8; NFR-008

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Project canonical facts and world-level environment state deterministically from accepted events, including validity intervals and visibility.

Scope
Project canonical facts and world-level environment state deterministically from accepted events, including validity intervals and visibility.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-12, ART-16

Schema Impact
Versioned validation results, Canon facts/projections, snapshots, replay metadata, and stable error codes named by the task.

API Impact
Pure reducer/validator/replay interfaces separated from database and external services.

Security Impact
Invalid state never partially writes; correction and rollback preserve an auditable append-only history.

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
- [ ] #1 Canonical facts contain subject, predicate, value, validity event range, and visibility.
- [ ] #2 Only accepted events create, supersede, or end canonical facts and environment state.
- [ ] #3 Replay reconstructs identical fact and environment projections without editing history.
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
