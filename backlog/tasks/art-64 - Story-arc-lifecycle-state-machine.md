---
id: ART-64
title: Story arc lifecycle state machine
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:43'
updated_date: '2026-08-02 19:42'
labels:
  - prd-1.0
  - epic-h
milestone: m-0
dependencies:
  - ART-13
  - ART-16
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-F002

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Implement explicit Emerging, Active, Escalating, Climax, Resolving, Resolved, and Archived transitions, preserving historical queryability and excluding resolved arcs from active context.

Scope
Implement explicit Emerging, Active, Escalating, Climax, Resolving, Resolved, and Archived transitions, preserving historical queryability and excluding resolved arcs from active context.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-13, ART-16

Schema Impact
Versioned Story Arc state, fields, event links, lifecycle, scores, outcomes, and summary-consequence references named by the task.

API Impact
Deterministic arc classification/lifecycle/query interfaces; public ordering consumes published projections only.

Security Impact
Arc data cannot reveal unpublished facts or mutate Canon outside accepted events.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every acceptance criterion and all stated negative or failure cases.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-F002: 狀態轉換必須符合明確規則。
- [x] #2 FR-F002: Resolved Arc 不應持續被當作主要活躍上下文。
- [x] #3 FR-F002: Archived Arc 仍可由歷史查詢。
- [x] #4 Automated tests provide evidence for every mapped FR-F002 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-F002 to doc-1 and the merged implementation evidence.
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
1. Define a versioned seven-state Story Arc lifecycle and an explicit forward-only transition matrix with optimistic expected-status checks and accepted-event provenance. 2. Implement pure transition/active-context/history selectors plus an in-memory reference ledger for exhaustive deterministic tests. 3. Persist current lifecycle and append-only transition history in Story-owned Convex tables with internal create/transition, active-context, and historical queries; archived arcs remain addressable while resolved/archived arcs are excluded from active context. 4. Add exhaustive allowed/forbidden transition, provenance, concurrency, active exclusion, archive-history, and internal-boundary tests; update docs/codegen and run full gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented a versioned seven-state forward-only lifecycle matrix with optimistic expected-status checks, accepted Canon event provenance, Story-owned current state, append-only transition history, internal create/transition/history/active queries, and archived history retention. Exhaustive tests cover all 49 status pairs, stale status, invalid/mismatched provenance, active-context filtering, terminal archival, and internal API boundaries. Convex codegen succeeded. Final npm run check passed architecture, typecheck, lint, 26 suites/265 tests, and build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-F002 explicit Story Arc lifecycle rules, accepted-event provenance, concurrency safety, append-only history, active-context exclusion for resolved/archived arcs, and historical archive queries. Full verification passed 265 tests; merge evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
