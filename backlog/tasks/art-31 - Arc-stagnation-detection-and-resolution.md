---
id: ART-31
title: Arc stagnation detection and resolution
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 20:39'
labels:
  - prd-1.0
  - epic-h
milestone: m-0
dependencies:
  - ART-64
  - ART-30
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-F005

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Detect 14-day stagnation and support outcome suggestions, merge, downgrade, resolving, archive, and background compression with consequence updates.

Scope
Detect 14-day stagnation and support outcome suggestions, merge, downgrade, resolving, archive, and background compression with consequence updates.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-64, ART-30

Schema Impact
Versioned Story Arc state, fields, event links, lifecycle, scores, outcomes, and summary-consequence references named by the task.

API Impact
Deterministic arc classification/lifecycle/query interfaces; public ordering consumes published projections only.

Security Impact
Arc data cannot reveal unpublished facts or mutate Canon outside accepted events.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Time-controlled tests cover alerts, every closure path, and summary consequences.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-F005: A 14-world-day stagnation produces an operator-visible prompt.
- [x] #2 FR-F005: A major Arc cannot disappear without a valid lifecycle transition and retained history.
- [x] #3 FR-F005: Resolved Arc retains Outcome and Consequences.
- [x] #4 Resolution emits source-proven consequence data consumed by ART-82 for character/world summary refresh.
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
1. Add a deterministic FR-F005 resolution domain model that detects active-family arcs stalled for 14 world days and emits stable operator prompts. 2. Model source-proven remediation decisions (suggest outcome, merge, downgrade, enter resolving, archive/background-compress) with lifecycle and major-arc disappearance guards; require resolved outcome and consequences. 3. Persist/query prompts and decisions through internal Convex boundaries, verifying Accepted Event provenance and retaining history plus ART-82 consequence payloads. 4. Add time-controlled tests for the threshold, every remediation path, invalid disappearance/provenance, resolution payloads, persistence surface, and update docs/traceability; run codegen and full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented deterministic 14-world-day stagnation prompts and append-only Accepted-Event-proven resolution decisions for suggestion, merge, downgrade, resolving, resolve, archive, and background compression. Terminal decisions require source-proven outcome/consequence payloads for ART-82. Focused Jest passed 6 tests; Convex codegen succeeded; npm run check passed architecture, typecheck, lint, 37 suites/327 tests, and build.

PR #63 merged at 2026-08-02T20:36:08Z: https://github.com/tc3oliver/ai-reality-town/pull/63
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-F005 operator-visible 14-day stagnation detection, lifecycle-safe remediation records, retained terminal outcomes/consequences, and ART-82's source-proven consequence contract. Verified with focused 6-test coverage, full npm run check (327 tests), and merged PR #63.
<!-- SECTION:FINAL_SUMMARY:END -->
