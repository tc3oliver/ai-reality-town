---
id: ART-17
title: 'Snapshot, replay, and non-destructive rollback'
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 19:03'
labels:
  - prd-1.0
  - epic-e
milestone: m-0
dependencies:
  - ART-13
  - ART-15
  - ART-16
references:
  - 'https://github.com/tc3oliver/ai-reality-town/pull/33'
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-D006, NFR-003, NFR-008

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Create daily snapshots; replay from initial state or snapshot; compare projections; and roll back operationally without deleting history.

Scope
Create daily snapshots; replay from initial state or snapshot; compare projections; and roll back operationally without deleting history.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-13, ART-15, ART-16

Schema Impact
Versioned validation results, Canon facts/projections, snapshots, replay metadata, and stable error codes named by the task.

API Impact
Pure reducer/validator/replay interfaces separated from database and external services.

Security Impact
Invalid state never partially writes; correction and rollback preserve an auditable append-only history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Integration tests cover daily snapshots, both replay paths, equality, corruption detection, and rollback.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-D006: A Snapshot is created at least daily.
- [x] #2 FR-D006: Replay works from initial state and from Snapshot plus subsequent events.
- [x] #3 FR-D006: Full replay and Snapshot replay are identical for 30 world days.
- [x] #4 FR-D006: Rollback never deletes accepted history.
- [x] #5 Replay detects corruption, unsupported versions, and sequence gaps explicitly.
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
1. Version Canon snapshots with world-day and deterministic integrity metadata, validate snapshots before replay, and persist at most one canonical daily checkpoint while allowing explicit manual/recovery checkpoints. 2. Add a repository-neutral snapshot/recovery service plus Convex internal mutations/queries that resume from the latest valid snapshot and only load subsequent accepted events. 3. Implement audited operational rollback as a reversible recovery-head pointer to an existing verified snapshot; never mutate/delete accepted events or idempotency records, and expose clear/inspect operations for later Admin integration. 4. Add 30-day integration tests covering daily cadence, full-vs-snapshot equality, corruption/version/gap detection, and rollback history preservation; update docs/codegen, run full gates, finalize and merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented versioned, canonically hashed snapshots; daily idempotent persistence that resumes from the latest verified snapshot; exact accepted-prefix verification; internal Convex operations; and reversible audited recovery heads separate from append-only Canon. Snapshot projection access is internal-only. Development Convex codegen succeeded. Focused snapshot/replay/world-import command passed 3 suites/24 tests. Full npm run check passed architecture, typecheck, lint, 22 suites/247 tests, and build. The 30-day test creates exactly one snapshot per day, proves full/snapshot equality daily, rejects forged/corrupt/unsupported/gapped data, and proves rollback/clear leaves all accepted events byte-equivalent. DoD13/14 remain commit/merge dependent.

Implementation committed and pushed on feat/ART-17-snapshot-recovery.

Implementation PR #33 merged into main on 2026-08-02T19:03:00Z after all required checks passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered FR-D006/NFR-003/NFR-008 via merged PR #33: verified daily snapshots, initial/snapshot replay, 30-day equality, explicit corruption/version/gap failures, and audited reversible rollback that preserves every accepted event. Full pre-merge check passed 247 tests.
<!-- SECTION:FINAL_SUMMARY:END -->
