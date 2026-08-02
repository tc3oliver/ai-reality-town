---
id: ART-17
title: 'Snapshot, replay, and non-destructive rollback'
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-e
milestone: m-0
dependencies:
  - ART-13
  - ART-15
  - ART-16
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-D006, NFR-003, NFR-008

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Create daily snapshots; replay from initial state or snapshot; compare projections; and roll back operationally without deleting history.

Scope
Create daily snapshots; replay from initial state or snapshot; compare projections; and roll back operationally without deleting history.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-13, ART-15, ART-16

Schema Impact
Versioned validation results, Canon facts/projections, snapshots, replay metadata, and stable error codes named by the task.

API Impact
Pure reducer/validator/replay interfaces separated from database and external services.

Security Impact
Invalid state never partially writes; correction and rollback preserve an auditable append-only history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Integration tests cover daily snapshots, both replay paths, equality, corruption detection, and rollback.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-D006: A Snapshot is created at least daily.
- [ ] #2 FR-D006: Replay works from initial state and from Snapshot plus subsequent events.
- [ ] #3 FR-D006: Full replay and Snapshot replay are identical for 30 world days.
- [ ] #4 FR-D006: Rollback never deletes accepted history.
- [ ] #5 Replay detects corruption, unsupported versions, and sequence gaps explicitly.
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
