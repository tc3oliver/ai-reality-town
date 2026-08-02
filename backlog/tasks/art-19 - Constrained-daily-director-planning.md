---
id: ART-19
title: Constrained daily director planning
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 20:43'
labels:
  - prd-1.0
  - epic-f
milestone: m-0
dependencies:
  - ART-18
  - ART-29
  - ART-65
  - ART-57
  - ART-9
  - ART-78
  - ART-79
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-C002; Section 10.1

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Plan bounded scene candidates from arcs, goals, positions, events, interventions, repetition, and pacing without dictating outcomes.

Scope
Plan bounded scene candidates from arcs, goals, positions, events, interventions, repetition, and pacing without dictating outcomes.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-18, ART-29, ART-65, ART-57, ART-9, ART-78, ART-79

Schema Impact
Simulation Run, Director Plan, Intent, Scene, checkpoint, failure-stage, and proposal references named by the task.

API Impact
Internal scheduling/orchestration commands with idempotent start, resume, retry, pause, and inspection boundaries.

Security Impact
Generated data is untrusted, knowledge-scoped, safety-checked, and unable to bypass validation or commit directly.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Deterministic tests cover plan contracts, conflicts, limits, and non-prescriptive output.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-C002: Director 不得直接指定最終結果。
- [x] #2 FR-C002: 同時規劃的場景不得產生明顯時間或位置衝突。
- [x] #3 FR-C002: 場景必須可追蹤至 Director Run。
- [x] #4 FR-C002: 每日必須限制主要場景數量。
- [x] #5 Automated tests provide evidence for every mapped FR-C002 acceptance criterion, including rejection and failure paths.
- [x] #6 PRD traceability links FR-C002 to doc-1 and the merged implementation evidence.
- [x] #7 Section 10.1: Each world time slot plans between zero and three major scenes, inclusive, and rejects plans above that limit.
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
1. Define a versioned, runtime-validated Director context and plan contract covering active arcs, unresolved questions, recent events, character goals/locations/absence, viewer interventions, environment, repetition, and pacing. 2. Implement deterministic bounded planning validation for 0–3 scenes per slot, unique run provenance, location/time/character conflict prevention, and pressure/trigger/expected-change fields while structurally excluding prescribed outcomes. 3. Add internal persistence/query boundaries keyed by Director Run with idempotent writes and Accepted world/run references. 4. Add deterministic tests for empty through three-scene plans, over-limit and conflict rejection, non-prescriptive output, traceability, schema failures, and docs; run codegen and full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented a strict Director context/plan contract covering all FR-C002 inputs, 0-3 scenes per world slot, Director Run provenance, character location/time conflict prevention, active-Arc validation, protected facts, and expected change types. Unknown output fields—including prescribed finalOutcome/dialogue—are rejected. Persistence is internal and idempotent per Director Run. Focused Jest passed 6 tests; Convex codegen succeeded; npm run check passed architecture, typecheck, lint, 37 suites/327 tests, and build.

PR #64 merged at 2026-08-02T20:40:42Z: https://github.com/tc3oliver/ai-reality-town/pull/64
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-C002 constrained, non-prescriptive Director planning with complete context, deterministic 0-3 scene limits, run traceability, conflict validation, and internal idempotent persistence. Verified with 6 focused tests, full npm run check (327 tests), and merged PR #64.
<!-- SECTION:FINAL_SUMMARY:END -->
