---
id: ART-81
title: Organization membership and state projection
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 16:19'
updated_date: '2026-08-02 20:28'
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
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Sections 9.1, 13.2; NFR-008

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Project organization state and character memberships from accepted events with history and replay support.

Scope
Project organization state and character memberships from accepted events with history and replay support.

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
- [x] #1 Organization identifiers and active state remain valid across replay.
- [x] #2 Membership changes are event-derived, historical, and consistent with character state.
- [x] #3 Invalid organization or duplicate membership changes are rejected.
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
1. Add replayable organization definitions (identity, name, description, type, headquarters, active state) to world-import snapshots and a typed organization_state_changed Accepted Event path. 2. Derive character organization memberships and append-only added/removed membership history from existing accepted character_state_changed organization_memberships changes, keeping the character state field and reverse organization membership projection consistent. 3. Extend structural/Canon validation to reject unknown/inactive organizations, duplicate memberships, duplicate same-event organization or character membership changes, invalid headquarters, and deactivation while members remain. 4. Test seed state, join/leave history, reverse consistency, invalid/duplicate/inactive paths, replay/snapshot equality, immutability, and retry behavior; update docs/codegen and run full gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
World import snapshots now contain validated organization definitions with active state and headquarters. Added typed organization_state_changed proposals and Accepted Event reduction. Character organization_memberships changes atomically update character state, reverse members, and append added/removed history with Event/time provenance. Canon rejects unknown/inactive/duplicate memberships, repeated same-event changes, invalid headquarters, unknown organizations, and deactivation with members. Convex codegen succeeded. Focused verification passed 17 tests; npm run check passed architecture, typecheck, lint, 36 suites/321 tests, and build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Sections 9.1/13.2 and NFR-008 organization state and membership projections with Accepted-Event history, bidirectional consistency, deterministic replay/snapshots, and invalid/duplicate/inactive enforcement. Full verification passed 321 tests; merge evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
