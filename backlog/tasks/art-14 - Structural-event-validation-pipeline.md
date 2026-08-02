---
id: ART-14
title: Structural event validation pipeline
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 18:31'
labels:
  - prd-1.0
  - epic-e
milestone: m-0
dependencies:
  - ART-12
references:
  - 'https://github.com/tc3oliver/ai-reality-town/pull/24'
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
modified_files:
  - convex/canon/validators.ts
  - convex/canon/validators.test.ts
  - convex/canon/commit.test.ts
  - convex/canon/mistwoodFixture.test.ts
  - docs/structural-event-validation.md
  - docs/DEVELOPMENT.md
priority: high
type: feature
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-D003

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Validate schemas, versions, types, unions, participants, finite values, keys, days, summaries, and references before persistence.

Scope
Validate schemas, versions, types, unions, participants, finite values, keys, days, summaries, and references before persistence.

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
Table-driven tests cover every structural rule and atomic rejection.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-D003: 錯誤使用穩定 Error Code。
- [x] #2 FR-D003: 不得以自由文字判斷錯誤類型。
- [x] #3 FR-D003: 驗證失敗不得產生部分寫入。
- [x] #4 Automated tests provide evidence for every mapped FR-D003 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-D003 to doc-1 and the merged implementation evidence.
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
1. Complete the pure structural validator with exact-key checks, safe integers/finite values, bounded technical-reference formats, recursive JSON-safe metadata, and stable code/path/details results for every FR-D003 field.
2. Keep the commit boundary fail-closed before repository reads/writes and ensure runtime normalization and direct commit use the same structural rules.
3. Add table-driven validator and commit-atomicity tests for required fields, versions, event/union types, participant dedupe, values, keys, days, summaries, references, unknown fields, and metadata.
4. Document the validation contract, run focused/full gates, then finalize, push, and auto-merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Completed exact-key and version/type/union validation, participant dedupe, safe-integer and finite-value checks, bounded reference/key formats, summary limits, recursive JSON-safe acyclic metadata, and stable code/path errors. Commit atomicity tests prove rejected proposals create neither event nor idempotency rows. Focused validation: 3 suites/51 tests. Full npm run check passed architecture checks, typecheck, lint, 18 suites/204 tests, and Vite build.

Committed as e0cb265, pushed to origin, and opened PR #24.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the FR-D003 fail-closed structural validation pipeline with stable machine-readable code/path errors and complete table-driven boundary coverage. Invalid proposals are rejected before repository access and cannot partially write. Verified with 51 focused tests and the full 204-test quality gate.
<!-- SECTION:FINAL_SUMMARY:END -->
