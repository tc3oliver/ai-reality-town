---
id: ART-21
title: Conflict-safe scene grouping
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 20:59'
labels:
  - prd-1.0
  - epic-f
milestone: m-0
dependencies:
  - ART-20
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-C004

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Merge related intents by time and place while retaining source references and enforcing participant and concurrency limits.

Scope
Merge related intents by time and place while retaining source references and enforcing participant and concurrency limits.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-20

Schema Impact
Simulation Run, Director Plan, Intent, Scene, checkpoint, failure-stage, and proposal references named by the task.

API Impact
Internal scheduling/orchestration commands with idempotent start, resume, retry, pause, and inspection boundaries.

Security Impact
Generated data is untrusted, knowledge-scoped, safety-checked, and unable to bypass validation or commit directly.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests cover grouping, conflicts, participant limits, and intent provenance.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-C004: 相同時段、地點與角色衝突必須被處理。
- [x] #2 FR-C004: 不得讓角色同時參與兩個主要場景。
- [x] #3 FR-C004: 合併結果必須保留原始 Intent 參照。
- [x] #4 FR-C004: 每個主要場景應限制參與角色數量。
- [x] #5 Automated tests provide evidence for every mapped FR-C004 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-C004 to doc-1 and the merged implementation evidence.
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
1. Define a versioned grouped-scene contract tied to one Director Run/world slot, with location, participant IDs, source Intent IDs, Arc IDs, trigger, and dramatic pressure. 2. Implement deterministic grouping of accepted/downgraded intents by compatible time/location and related target/Arc context, preserving every source Intent reference and stable ordering. 3. Enforce a reviewable participant cap, one major scene per character per slot, persisted Intent provenance, and explicit reject/defer decisions for location/time/participant conflicts without modifying Canon. 4. Add grouping, same-character concurrency, participant overflow, duplicate/missing Intent, deterministic retry/idempotency tests and docs; run codegen and full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented deterministic grouping of compatible same-slot/location Intents, retaining all source Intent IDs, Arc/participant/run provenance, stable ordering and decisions. Rejects duplicate/cross-run/cross-slot/character conflicts, prevents a participant appearing in two scenes, defers wait/downgraded Intents, and enforces a six-participant scene cap. Persistence requires actual stored Intents and is idempotent without Canon mutation. Focused Jest passed 6 tests; Convex codegen succeeded; npm run check passed architecture, typecheck, lint, 41 suites/357 tests, and build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-C004 conflict-safe deterministic scene grouping with source Intent retention, one-scene-per-character enforcement, six-participant cap, explicit deferrals, and idempotent persisted-run validation. Verified with 6 focused tests and full npm run check (357 tests); merge evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
