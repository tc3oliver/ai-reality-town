---
id: ART-78
title: Canonical fact and world environment projection
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 16:19'
updated_date: '2026-08-02 20:09'
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
- [x] #1 Canonical facts contain subject, predicate, value, validity event range, and visibility.
- [x] #2 Only accepted events create, supersede, or end canonical facts and environment state.
- [x] #3 Replay reconstructs identical fact and environment projections without editing history.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit the current fact_created contract and reducer, then define typed accepted-event state changes for superseding/ending canonical facts and setting world environment values without in-place mutation. 2. Extend the deterministic projection with subject type/id, predicate, JSON value, visibility, valid-from event, nullable valid-until event, and versioned environment entries with the same provenance. 3. Add structural and Canon validation for references, visibility, prior active fact/environment identity, and duplicate changes, preserving append-only Accepted Events and snapshot/replay compatibility. 4. Test creation, supersession, closure, environment updates, invalid/repeated attempts, replay/snapshot equality, input immutability, and privacy fields; update docs/codegen and run full gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Extended every projected Canonical Fact with deterministic identity, typed subject, predicate/value/visibility, valid-from and nullable valid-until Accepted Event provenance. A later Accepted Event for the same subject/predicate closes the old projection version and appends the replacement. World facts additionally maintain cloned current environment state and lossless version history. Canon rejects foreign-world subjects and duplicate same-key changes in one event. Focused verification passed 28 tests including 30-day snapshots; npm run check passed architecture, typecheck, lint, 31 suites/297 tests, and build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Sections 13.5/13.8 and NFR-008 fact/environment projections: Accepted-Event-only versioning, complete validity and visibility metadata, current plus historical world environment state, and deterministic snapshot/replay equality. Full verification passed 297 tests; merge evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
