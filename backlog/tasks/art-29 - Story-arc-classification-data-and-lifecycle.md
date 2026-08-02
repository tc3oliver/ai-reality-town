---
id: ART-29
title: Story arc event classification
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 20:09'
labels:
  - prd-1.0
  - epic-h
milestone: m-0
dependencies:
  - ART-13
  - ART-16
references:
  - 'https://github.com/tc3oliver/ai-reality-town/pull/50'
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-F001

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Classify important accepted events into existing or new arcs with bounded multi-arc membership, explicit event roles, premise, current question, importance, and core-character changes.

Scope
Classify important accepted events into existing or new arcs with bounded multi-arc membership, explicit event roles, premise, current question, importance, and core-character changes.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-13, ART-16

Schema Impact
Versioned Story Arc state, fields, event links, lifecycle, scores, outcomes, and summary-consequence references named by the task.

API Impact
Deterministic arc classification/lifecycle/query interfaces; public ordering consumes published projections only.

Security Impact
Arc data cannot reveal unpublished facts or mutate Canon outside accepted events.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every mapped PRD acceptance condition, negative case, and failure boundary.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-F001: Event 可屬於多條 Arc，但主要 Arc 數量有限。
- [x] #2 FR-F001: Arc 建立必須有明確 Premise 與 Current Question。
- [x] #3 FR-F001: 低重要度事件不得任意建立新 Arc。
- [x] #4 Automated tests provide evidence for every mapped FR-F001 acceptance criterion, including rejection and failure paths.
- [x] #5 PRD traceability links FR-F001 to doc-1 and the merged implementation evidence.
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
1. Define a versioned runtime-validated classification contract for attaching an Accepted Event to existing arcs or proposing one new arc, including bounded memberships, primary designation, event role, importance, core-character changes, premise, and current question. 2. Implement a pure deterministic classifier validator that requires accepted-event provenance, rejects low-importance new-arc creation, and enforces a small primary-membership limit without altering Canon. 3. Add Story-owned internal persistence/query functions that atomically record idempotent classifications and initialize valid new-arc projection/lifecycle state through accepted-event references. 4. Test multi-arc bounds, every event role, low-importance rejection, required premise/question, invalid references, idempotency, and internal privacy; update docs/codegen and run full gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented versioned Accepted-Event classification with six-membership/two-primary bounds, seven event roles, importance and core-character deltas, runtime/reference validation, idempotent internal persistence, and atomic new-arc lifecycle/projection creation. New arcs require an inciting role, non-empty title/premise/question, valid characters, and importance >= 0.6. Convex codegen succeeded. Focused verification passed 6 tests; npm run check passed architecture, typecheck, lint, 30 suites/295 tests, and build.

Implementation PR #50 merged into main on 2026-08-02T20:05:55Z after Bootstrap and CI checks succeeded.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered FR-F001 through merged PR #50: versioned Accepted Event classification, bounded multi-Arc/primary membership, all narrative roles, low-importance new-Arc prevention, and atomic lifecycle/projection initialization. Full pre-merge verification passed 295 tests.
<!-- SECTION:FINAL_SUMMARY:END -->
