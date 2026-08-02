---
id: ART-10
title: Directional relationship projection and history
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 19:27'
labels:
  - prd-1.0
  - epic-c
milestone: m-0
dependencies:
  - ART-12
  - ART-16
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-B002

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Model bounded directional trust, affection, resentment, fear, dependency, and familiarity changes with causal event history and visibility controls.

Scope
Model bounded directional trust, affection, resentment, fear, dependency, and familiarity changes with causal event history and visibility controls.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-12, ART-16

Schema Impact
Versioned character, relationship, location, asset, or organization projection records explicitly named by the task.

API Impact
Typed reducer/projection queries for the named domain state; no direct LLM mutation interface.

Security Impact
Private character state and secret-derived changes remain event-authorized and excluded from public reads unless published.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests cover asymmetric changes, bounds, provenance, replay, and visibility.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-B002: 關係變化必須具有原因與來源事件。
- [x] #2 FR-B002: 關係數值不得超出定義範圍。
- [x] #3 FR-B002: 關係歷史必須可查詢。
- [x] #4 FR-B002: 關係的雙向數值可以不同。
- [x] #5 FR-B002: 關係變化不得直接暴露未公開 Secret。
- [x] #6 Automated tests provide evidence for every mapped FR-B002 acceptance criterion, including rejection and failure paths.
- [ ] #7 PRD traceability links FR-B002 to doc-1 and the merged implementation evidence.
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
1. Extend the versioned relationship change contract to all six directional dimensions plus explicit private/public visibility, retaining the accepted event as causal provenance. 2. Project bounded six-dimensional directional state and append immutable per-change history records containing event ID, sequence, world time, reason, deltas, and visibility. 3. Deep-clone the history through snapshots/replay and expose only an internal history query so unpublished reasons and secret-derived changes cannot enter public APIs. 4. Add focused tests for structural/canon rejection, asymmetric directions, bounds, provenance, replay/snapshot equality, queryability, and visibility; update docs and run full gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented six-dimensional directional relationship projection and append-only causal history. New v1 fields are additive: legacy omissions normalize to zero/private and old snapshots are tolerated, avoiding a schema-version replay regression. Private changes are internal-only and Canon rejects any private relationship change carrying publicSummary with PRIVATE_RELATIONSHIP_DISCLOSURE. Convex codegen succeeded against the development deployment. Focused Jest verification passed 72 tests; final npm run check passed architecture, typecheck, lint, 25 suites/260 tests, and build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-B002 directional six-dimensional relationship state, bounded reducer updates, causal event history, replay/snapshot support, internal queryability, backward-compatible v1 normalization, and private-summary disclosure rejection. Full verification passed 260 tests; merge evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
