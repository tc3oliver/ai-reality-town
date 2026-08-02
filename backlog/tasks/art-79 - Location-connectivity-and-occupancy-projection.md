---
id: ART-79
title: Location connectivity and occupancy projection
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 16:19'
updated_date: '2026-08-02 20:15'
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
- [x] #1 Location IDs, connectivity, capacity, and active state are replayable.
- [x] #2 Character occupancy agrees with character-location projection for every sequence.
- [x] #3 Invalid, inactive, over-capacity, and impossible connected-location transitions are rejected or flagged according to Canon rules.
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
1. Add typed location definition and lifecycle state changes so IDs, descriptions/types, capacity, connectivity, and active state derive only from Accepted Events, while retaining compatibility with imported seed rules. 2. Extend the pure WorldProjection with versioned location records and occupancy sets derived from the same character-location changes, cloning through snapshots/replay. 3. Extend structural/Canon validation to reject unknown or inactive destinations, non-connected transitions, over-capacity arrivals, malformed/duplicate definitions, and location deactivation while occupied; keep occupancy consistent at every sequence. 4. Add focused definition, movement, capacity, active-state, replay/snapshot, immutability, and failure-path tests; update proposal schema/docs/codegen and run full gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
World import snapshots now contain complete validated location definitions and empty occupancy. Added typed location_state_changed proposal/Accepted Event handling, deterministic reducer projection, deep snapshot clones, and occupancy rebuilding from characterLocations at each sequence. Canon rejects unknown/inactive destinations, disconnected movement, capacity overflow, unknown connections, duplicate location changes, occupied deactivation, and capacity below occupancy. Convex codegen succeeded. Focused verification passed 24 tests; npm run check passed architecture, typecheck, lint, 33 suites/307 tests, and build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Section 13.4 and FR-D004 location rules with replayable definition/state, occupancy aligned to character locations, Accepted-Event updates, capacity/active/connectivity validation, and snapshot replay equality. Full verification passed 307 tests; merge evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
