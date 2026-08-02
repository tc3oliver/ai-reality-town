---
id: ART-16
title: Pure deterministic world reducer
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 18:52'
labels:
  - prd-1.0
  - epic-e
milestone: m-0
dependencies:
  - ART-12
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-D005, NFR-003

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Reduce supported ordered events with no database, API, clock, or unfixed randomness dependencies.

Scope
Reduce supported ordered events with no database, API, clock, or unfixed randomness dependencies.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-12

Schema Impact
Versioned validation results, Canon facts/projections, snapshots, replay metadata, and stable error codes named by the task.

API Impact
Pure reducer/validator/replay interfaces separated from database and external services.

Security Impact
Invalid state never partially writes; correction and rollback preserve an auditable append-only history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Property and unit tests verify purity, determinism, version handling, and gaps.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-D005: Reducer reads no database, external API, current clock, or unfixed randomness.
- [x] #2 FR-D005: Identical initial state and ordered events produce identical projections.
- [x] #3 FR-D005: Unsupported versions and sequence gaps fail explicitly.
- [x] #4 Reducer unit/property tests cover every supported event version.
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
- [x] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit the reducer and versioned event/state-change contracts against FR-D005/NFR-003, including the incoming ART-15 projection variants before final verification. 2. Add executable purity guards that reject database/API/clock/unfixed-random dependencies and property-style determinism/immutability tests over every supported state-change variant. 3. Add explicit version, ordering, sequence-gap, duplicate, and world-conflict evidence at the reducer boundary; document the pure contract and update PRD traceability. 4. Run focused tests and npm run check, finalize evidence, commit/push, open an auto-merge PR, and record merged evidence separately.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added an executable reducer import/capability allowlist plus repeated isolated-copy determinism checks over all six state-change variants for every declared supported schema version. Existing reducer/replay tests prove sequence ordering, gaps, duplicates, world mismatch, and mutation isolation. Focused command passed 3 suites/24 tests; full npm run check passed architecture, typecheck, lint, 21 suites/243 tests, and build. ACs are proven; DoD1/13/14 remain commit/merge dependent.

Implementation committed and pushed on feat/ART-16-deterministic-reducer.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Hardened FR-D005/NFR-003 with CI-enforced purity and supported-version property tests. The reducer cannot silently gain database/API/clock/random dependencies, every state-change variant produces identical projections from identical inputs, and invalid versions/sequences fail explicitly. Full npm run check passed with 243 tests; commit and merge evidence remain pending.
<!-- SECTION:FINAL_SUMMARY:END -->
