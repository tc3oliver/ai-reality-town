---
id: ART-19
title: Constrained daily director planning
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:57'
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
- [ ] #1 FR-C002: Director 不得直接指定最終結果。
- [ ] #2 FR-C002: 同時規劃的場景不得產生明顯時間或位置衝突。
- [ ] #3 FR-C002: 場景必須可追蹤至 Director Run。
- [ ] #4 FR-C002: 每日必須限制主要場景數量。
- [ ] #5 Automated tests provide evidence for every mapped FR-C002 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-C002 to doc-1 and the merged implementation evidence.
- [ ] #7 Section 10.1: Each world time slot plans between zero and three major scenes, inclusive, and rejects plans above that limit.
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
