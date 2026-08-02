---
id: ART-80
title: Unique item and asset ownership projection
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 16:19'
updated_date: '2026-08-02 20:29'
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
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 9.1; Section 13; FR-D004 item rule

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Project item and asset custody or ownership deterministically so one unique item cannot have multiple simultaneous owners.

Scope
Project item and asset custody or ownership deterministically so one unique item cannot have multiple simultaneous owners.

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
- [x] #1 Every ownership change references an accepted event and previous ownership state.
- [x] #2 A unique item has at most one current owner or custodian.
- [x] #3 Transfer replay is deterministic and duplicate/retried transfers remain idempotent.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
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
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Strengthen item_transferred so every proposal explicitly states the previous owner (character ID or null for initial custody), target owner, and reason, with structural and Canon precondition validation. 2. Extend the deterministic projection with an append-only per-item ownership history recording prior/new owner, reason, Accepted Event ID, sequence, and world time while preserving exactly one current owner map. 3. Clone ownership history through snapshots/replay and rely on Canon idempotency/sequence checks so duplicate retries neither append history nor change ownership twice. 4. Add initial custody, multi-hop transfer, incorrect prior owner, same-target, same-event duplicate, retry/idempotency, replay/snapshot, and immutability tests; update docs/codegen and run full gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Strengthened item_transferred to require an explicit previous owner or null initial custody, target, and reason. Canon validates the unique current/seed owner, same-target, duplicate same-event transfer, and all references. Reducer appends per-item history with previous/new owner, reason, Accepted Event ID, sequence, world day, and time slot while keeping one current owner. Snapshot/replay clone history; duplicate commit retries return the original event and produce one ledger entry. Convex codegen succeeded. Focused verification passed 27 tests; npm run check passed architecture, typecheck, lint, 34 suites/311 tests, and build.

PR #58 merged at 2026-08-02T20:24:49Z: https://github.com/tc3oliver/ai-reality-town/pull/58
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Sections 9.1/13 and FR-D004 item ownership with explicit prior-state transfers, unique current ownership, immutable Accepted-Event ledger provenance, deterministic replay/snapshots, and retry idempotency. Verified by npm run check (34 suites, 311 tests) and merged PR #58.
<!-- SECTION:FINAL_SUMMARY:END -->
