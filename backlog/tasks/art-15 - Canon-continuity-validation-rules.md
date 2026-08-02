---
id: ART-15
title: Canon continuity validation rules
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 18:48'
labels:
  - prd-1.0
  - epic-e
milestone: m-0
dependencies:
  - ART-14
  - ART-13
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-D004

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Enforce teleportation, double-location, death, knowledge-source, unique-item, self-relationship, unexplained-change, reference, sequence, and duplicate-key rules.

Scope
Enforce teleportation, double-location, death, knowledge-source, unique-item, self-relationship, unexplained-change, reference, sequence, and duplicate-key rules.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-14, ART-13

Schema Impact
Versioned validation results, Canon facts/projections, snapshots, replay metadata, and stable error codes named by the task.

API Impact
Pure reducer/validator/replay interfaces separated from database and external services.

Security Impact
Invalid state never partially writes; correction and rollback preserve an auditable append-only history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Automated tests cover every listed P0 rule and retry behavior.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-D004: 所有 P0 規則具備自動化測試。
- [x] #2 FR-D004: 驗證拒絕原因可在管理介面查看。
- [x] #3 FR-D004: 重試不得繞過 Canon Validation。
- [x] #4 Automated tests provide evidence for every mapped FR-D004 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-D004 to doc-1 and the merged implementation evidence.
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
1. Extend typed Canon state changes and projection continuity metadata for life status, sourced knowledge, unique item ownership, and last movement time while preserving deterministic replay.
2. Load validated world character/location/item references and location connectivity into Canon validation context; enforce no teleportation, same-slot double location, dead participation, unauthorized knowledge, ownership conflicts, invalid references, self-relationships, and explained numeric changes.
3. Persist structured validation rejection records separately from Canon and expose an internal administrator query; prove retries and duplicate attempts cannot bypass validation or partially write.
4. Add table-driven tests for every FR-D004 P0 rule plus sequence/idempotency behavior, update docs/codegen, run full gates, then finalize and merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented versioned life, sourced-knowledge, and unique-item state changes; deterministic projection/snapshot metadata; database-backed reference/connectivity context; all FR-D004 rejection rules; and an internal administrator failure query backed by structured simulation-run error code/path/details. Retries re-enter the same validator before sequence/key reservation. Verification: npm run check passed (19 suites, 225 tests; architecture, typecheck, lint, build all passed); focused continuity/schema/reducer/workflow tests passed; npx convex codegen succeeded against the configured development deployment. AC5 and DoD1/13/14 remain merge-evidence dependent.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-D004 Canon continuity validation and structured internal rejection inspection. Automated coverage proves teleportation, same-slot double movement, dead participation, sourced knowledge, unique ownership, invalid references, self-relationships, zero deltas, sequence/idempotency, retry rejection, and deterministic projection behavior. Full npm run check passed with 225 tests; merge evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
