---
id: ART-65
title: Story arc projection data contract
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 15:43'
updated_date: '2026-08-02 19:56'
labels:
  - prd-1.0
  - epic-h
milestone: m-0
dependencies:
  - ART-12
  - ART-16
references:
  - 'https://github.com/tc3oliver/ai-reality-town/pull/46'
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-F003

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Maintain every required arc field, including premise, question, core characters, inciting event, turning point, facts, questions, entry point, heat, and progress time.

Scope
Maintain every required arc field, including premise, question, core characters, inciting event, turning point, facts, questions, entry point, heat, and progress time.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-12, ART-16

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
- [x] #1 FR-F003: Arc stores Title, Premise, Current Question, Status, Core Characters, Inciting Event, Latest Turning Point, Essential Facts, Unresolved Questions, Resolved Questions, Recommended Entry Point, Heat Score, and Last Progress Time.
- [x] #2 Every required field is runtime validated and replayable from accepted events.
- [x] #3 Traceability links FR-F003 to doc-1 and implementation evidence.
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
1. Define and runtime-validate a versioned Story Arc projection containing every FR-F003 field, with deterministic world-time progress provenance and nullable not-yet-established turning/entry links. 2. Represent arc initialization and updates as append-only Story projection events linked to accepted Canon events; implement a pure reducer that replays them and composes status from ART-64 lifecycle history. 3. Add Story-owned Convex event storage and internal create/update/replay queries with optimistic revision and accepted-event/reference validation; never expose unpublished arc facts publicly. 4. Test every required field, malformed/duplicate/conflicting arrays, invalid bounds/references, revision conflicts, deterministic replay, lifecycle status composition, and internal boundaries; update docs/codegen and run full gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the complete versioned FR-F003 arc projection with all required fields, runtime validation, nullable not-yet-established turning/entry links, accepted-event progress provenance, append-only full-field projection events, deterministic pure replay, lifecycle status composition, optimistic revisions, and internal-only storage/query boundaries. Character/event references are checked against the world; arrays reject duplicates and resolved/unresolved overlap; heat is bounded 0–100. Convex codegen succeeded. Focused verification passed 19 tests; final npm run check passed architecture, typecheck, lint, 28 suites/285 tests, and build.

Implementation commit a3ba216 pushed on feat/ART-65-arc-data-contract.

Implementation PR #46 merged into main on 2026-08-02T19:55:36Z after Bootstrap and CI checks succeeded.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered FR-F003 through merged PR #46: complete runtime-validated Story Arc projection fields, accepted-event append-only revisions, deterministic replay, lifecycle composition, reference validation, and internal privacy boundaries. Full pre-merge verification passed 285 tests.
<!-- SECTION:FINAL_SUMMARY:END -->
