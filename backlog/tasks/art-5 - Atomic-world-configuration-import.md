---
id: ART-5
title: Atomic world configuration import
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 15:30'
updated_date: '2026-08-02 17:59'
labels:
  - prd-1.0
  - epic-b
milestone: m-0
dependencies:
  - ART-3
  - ART-4
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-A001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Import structured world, location, organization, immutable-rule, and history data with runtime validation and atomic failure behavior.

Scope
Import structured world, location, organization, immutable-rule, and history data with runtime validation and atomic failure behavior.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-3, ART-4

Schema Impact
World import/seed schemas for world, locations, organizations, history, rules, characters, relationships, knowledge, secrets, and assets named by the task.

API Impact
Validated administrative import/readiness commands; imports are atomic and unavailable to public callers.

Security Impact
Seed/import data rejects real-person data, invalid references, unsafe defaults, and partial writes.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Automated tests cover valid import, invalid references, immutable-rule availability, and rollback on failure.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-A001: 可從結構化設定匯入世界。
- [x] #2 FR-A001: 匯入時執行 Runtime Schema Validation。
- [x] #3 FR-A001: 無效參照必須被拒絕。
- [x] #4 FR-A001: 世界建立後產生 Initial Snapshot。
- [x] #5 FR-A001: 不可變世界規則必須可被 Canon Validator 讀取。
- [x] #6 FR-A001: 匯入失敗不得產生部分世界。
- [x] #7 Automated tests provide evidence for every mapped FR-A001 acceptance criterion, including rejection and failure paths.
- [x] #8 PRD traceability links FR-A001 to doc-1 and the merged implementation evidence.
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
1. Define a versioned pure WorldConfiguration contract covering world metadata, geography/social/legal rules, locations, organizations, immutable rules, and initial history, with stable runtime errors.
2. Validate duplicates and every cross-reference before writes; compile immutable rules into a Canon-readable rule context.
3. Add Convex-owned world configuration tables and an internal-only import mutation that writes the validated plan and Initial Snapshot in one transaction; provide an atomic in-memory adapter with injected-failure rollback tests.
4. Add valid/invalid/reference/rule/snapshot/rollback tests, document the import format and security boundary, run focused tests and npm run check, then finalize and merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented WorldConfigurationV1 with strict runtime parsing, stable errors, fictional/no-real-person declaration, duplicate/reference/date validation, typed immutable rule enforcement, and Initial Snapshot planning. Added internal-only Convex import mutation and world definition/location/organization/rule/history tables; all writes occur in one Convex transaction. Canon commit now loads persisted immutable rules before validation. Offline atomic adapter injects mid-write failure and proves zero visible partial state. Convex codegen succeeded and uploaded the schema/functions to the configured development deployment only (no production deploy). Focused validation: 3 suites/30 tests. Full npm run check: architecture gates, typecheck, lint, 14 suites/116 tests, build.

Implementation and validation evidence committed and pushed to origin/feat/ART-5-atomic-world-import.

PR #13 merged to main after both required GitHub checks passed; this is the merged FR-A001 implementation evidence linked to PRD doc-1.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the internal-only, transactionally atomic FR-A001 world import with strict versioned validation, complete reference checks, persisted Canon-readable immutable rules, and sequence -1 Initial Snapshot. Verified rollback, rejection paths, rule enforcement, codegen, 30 focused tests, and the full 116-test build gate.
<!-- SECTION:FINAL_SUMMARY:END -->
