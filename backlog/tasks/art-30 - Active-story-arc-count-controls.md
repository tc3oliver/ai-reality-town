---
id: ART-30
title: Active story arc count controls
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 20:23'
labels:
  - prd-1.0
  - epic-h
milestone: m-0
dependencies:
  - ART-29
  - ART-64
  - ART-65
references:
  - 'https://github.com/tc3oliver/ai-reality-town/pull/56'
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-F004

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Enforce three major, six minor, six core-character, and two-major-arc-per-event limits through merge, downgrade, or rejection without deleting events.

Scope
Enforce three major, six minor, six core-character, and two-major-arc-per-event limits through merge, downgrade, or rejection without deleting events.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-29, ART-64, ART-65

Schema Impact
Versioned Story Arc state, fields, event links, lifecycle, scores, outcomes, and summary-consequence references named by the task.

API Impact
Deterministic arc classification/lifecycle/query interfaces; public ordering consumes published projections only.

Security Impact
Arc data cannot reveal unpublished facts or mutate Canon outside accepted events.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Boundary tests cover every limit and each remediation path.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-F004: 超過上限時必須合併、降級或拒絕。
- [x] #2 FR-F004: 首頁預設只展示最高優先級 Arc。
- [x] #3 FR-F004: Arc 數量控制不得刪除 Event。
- [x] #4 Automated tests provide evidence for every mapped FR-F004 acceptance criterion, including rejection and failure paths.
- [x] #5 PRD traceability links FR-F004 to doc-1 and the merged implementation evidence.
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
1. Define a deterministic Arc portfolio control input/output over replayed lifecycle/projection data, with explicit major/minor priority and remediation decisions (accept, downgrade, merge, reject) that never remove Accepted Events. 2. Enforce at most three major Active-family arcs, six minor Active-family arcs, six core characters per major arc, and two major memberships per Accepted Event; reject malformed or unresolvable overflow and validate merge targets. 3. Produce a deterministic homepage selection containing only the highest-priority eligible published Arc, with stable heat/recency/ID ordering and no LLM decision. 4. Add boundary tests for every limit and remediation path, preservation of source Event IDs, deterministic homepage ordering, lifecycle exclusions, malformed inputs, and privacy-safe output; document and run full gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented deterministic Story portfolio limits: 3 active-family major arcs, 6 minor arcs, 6 core characters per major arc, and 2 major memberships per Accepted Event. Overflow requires explicit reject/downgrade/merge; every decision retains source Event IDs. Added internal persisted admission with Accepted Event provenance and idempotent decisions. Homepage selection returns one published active-family Arc using tier, priority, heat, recency, and stable ID ordering. Convex codegen succeeded. Focused verification passed 6 tests; npm run check passed architecture, typecheck, lint, 33 suites/309 tests, and build.

Implementation PR #56 merged into main on 2026-08-02T20:21:22Z after Bootstrap and CI checks succeeded.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered FR-F004 through merged PR #56: persisted Arc portfolio hard limits, explicit auditable reject/downgrade/merge outcomes retaining Accepted Event provenance, and deterministic one-Arc homepage selection. Full pre-merge verification passed 309 tests.
<!-- SECTION:FINAL_SUMMARY:END -->
