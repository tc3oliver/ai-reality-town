---
id: ART-7
title: Initial tension readiness validator
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:30'
updated_date: '2026-08-02 18:11'
labels:
  - prd-1.0
  - epic-b
milestone: m-0
dependencies:
  - ART-6
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-A003

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Validate the required conflict, secret, dependency, misconception, emotional-tension, shared-misunderstanding, and launchable-arc counts before warmup.

Scope
Validate the required conflict, secret, dependency, misconception, emotional-tension, shared-misunderstanding, and launchable-arc counts before warmup.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-6

Schema Impact
World import/seed schemas for world, locations, organizations, history, rules, characters, relationships, knowledge, secrets, and assets named by the task.

API Impact
Validated administrative import/readiness commands; imports are atomic and unavailable to public callers.

Security Impact
Seed/import data rejects real-person data, invalid references, unsafe defaults, and partial writes.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests cover every threshold and administrator-readable result output.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-A003: 缺少必要張力時，世界不得進入公開暖機。
- [x] #2 FR-A003: 系統應產生具體缺失報告。
- [x] #3 FR-A003: 張力檢查結果必須可由管理者查看。
- [x] #4 Automated tests provide evidence for every mapped FR-A003 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-A003 to doc-1 and the merged implementation evidence.
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
1. Define a versioned initial-tension profile and deterministic readiness report for all seven FR-A003 thresholds, validating every character/history reference.
2. Derive private-secret and misconception evidence from seeded data; validate explicit interest conflicts, resource/debt dependencies, emotional tensions, town-wide shared misunderstanding, and launchable arc candidates.
3. Persist profiles/reports through internal-only Convex functions, expose an administrator-readable internal query, and provide a hard assertWarmupReady guard for ART-8.
4. Test each threshold independently, detailed deficits, invalid references, stored admin retrieval, and warmup rejection/allow paths; run codegen/focused/full gates, then finalize and merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented versioned initial tension profiles and deterministic reports for all seven FR-A003 thresholds: 3 interest conflicts, 3 seeded private secrets, 2 resource/debt dependencies, 2 false-knowledge misconceptions, 2 emotional tensions, 1 history-backed town-wide misunderstanding believed by every primary character, and 1 launchable main arc candidate. Reports persist exact required/actual/missingBy/evidence IDs and messages even on failure. Added internal-only evaluation/admin query and mandatory requireWarmupReadiness guard with stable WORLD_NOT_READY_FOR_WARMUP errors. Convex codegen succeeded against the configured development deployment only. Focused validation: 1 suite/16 tests. Full npm run check: architecture gates, typecheck, lint, 16 suites/154 tests, build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the FR-A003 warmup readiness hard gate with exact evidence for every required tension category, detailed persisted administrator deficits, reference-safe profiles, and stable rejection when no passing report exists. Verified 16 focused cases, development codegen, and the complete 154-test build gate.
<!-- SECTION:FINAL_SUMMARY:END -->
