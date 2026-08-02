---
id: ART-9
title: Event-derived character state projection
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 19:19'
labels:
  - prd-1.0
  - epic-c
milestone: m-0
dependencies:
  - ART-12
  - ART-16
references:
  - 'https://github.com/tc3oliver/ai-reality-town/pull/36'
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-B001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Project location, health, emotion, finance, occupation, memberships, availability, and alive/active status exclusively from accepted events.

Scope
Project location, health, emotion, finance, occupation, memberships, availability, and alive/active status exclusively from accepted events.

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
Reducer tests cover every state field and rejected direct mutation.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-B001: 所有狀態變化必須由 Accepted Event 產生。
- [x] #2 FR-B001: LLM 不得直接覆寫角色目前狀態。
- [x] #3 FR-B001: 狀態必須可從 Replay 重建。
- [x] #4 Automated tests provide evidence for every mapped FR-B001 acceptance criterion, including rejection and failure paths.
- [x] #5 PRD traceability links FR-B001 to doc-1 and the merged implementation evidence.
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
1. Add a typed character-state event union for every FR-B001 field and reject provider-side direct projection mutation. 2. Project unified current state solely through the pure reducer, including movement and life-status synchronization. 3. Extend snapshot/replay cloning and internal read boundaries. 4. Add focused validation, reducer, replay, privacy, and direct-mutation rejection tests; document and run full gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented typed character_state_changed proposals for health, emotion, finance, occupation, organization memberships, availability, and active; existing accepted movement/life events synchronously project location and alive, with death forcing active=false. Added prior-value/no-op/duplicate-field/type/reason/participant/character/organization/contradictory-death validation, unified deterministic projection and deep snapshot cloning, organization context loading, and internal-only Canon/state queries. Direct provider projection fields are rejected before commit and cause zero writes. Development Convex codegen succeeded. Focused command passed 4 suites/26 tests; full npm run check passed architecture, typecheck, lint, 23 suites/250 tests, and build. AC5 and DoD1/13/14 remain merge-evidence dependent.

Implementation committed and pushed on feat/ART-9-character-state-projection.

Merged PR #36 on 2026-08-02T19:19:10Z after Bootstrap and CI checks succeeded. The implementation adds event-derived location, health, emotion, finance, occupation, organization memberships, availability, alive, and active projection; rejects direct provider character-state envelopes; preserves deterministic replay and internal-only reads. Full combined verification passed architecture checks, typecheck, lint, build, and 24 suites/256 tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered FR-B001 through merged PR #36. All current character state is reducer-derived from accepted events, direct LLM projection mutation is rejected, replay reproduces state, and focused plus full checks passed 256 tests.
<!-- SECTION:FINAL_SUMMARY:END -->
