---
id: ART-4
title: Deterministic fake provider and Mistwood fixtures
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:30'
updated_date: '2026-08-02 17:49'
labels:
  - prd-1.0
  - epic-a
milestone: m-0
dependencies:
  - ART-3
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-007, Milestone 0

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Provide deterministic fake model responses, fixed seeds, and reusable world fixtures for offline domain and workflow testing.

Scope
Provide deterministic fake model responses, fixed seeds, and reusable world fixtures for offline domain and workflow testing.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-3

Schema Impact
Versioned module-boundary, provider-adapter, prompt/model-config, fixture, or trace contracts named by the task; persisted changes require compatibility evidence.

API Impact
Shared provider/configuration ports and offline test interfaces only; business logic cannot import provider-specific APIs.

Security Impact
Credentials, prompts, and provider metadata are redacted and accessed only through authorized configuration boundaries.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Offline tests demonstrate deterministic provider behavior and a valid fixed-world fixture.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Domain logic runs without an LLM or network.
- [x] #2 A deterministic Fake Provider returns identical structured output for a fixed seed and scenario.
- [x] #3 A fixed valid world fixture is available for domain and workflow tests.
- [x] #4 Long-run 7/30/90-day execution is owned by ART-60 and ART-73, not this fixture task.
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
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Formalize a versioned fixed seed in SimulationInput and the Mistwood fixture while preserving the provider-only-proposes boundary.
2. Add an isolated fixture factory so tests cannot mutate shared fixture state, and add complete structural/canon/replay validity tests.
3. Extend Fake Provider tests to prove same seed/scenario yields byte-equivalent output and offline execution uses no network, env credential, clock, or randomness.
4. Update fixture/testing documentation, run focused tests and npm run check, then finalize and merge the task.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented explicit fixed integer seeds for simulation inputs and deterministic Fake Provider variants, including stable invalid-seed errors. Added versioned Mistwood seed/fixture factory with isolated copies and sequential structural, Canon, reducer, full-replay, and snapshot-replay validation. Focused validation: npm test -- --runInBand --runTestsByPath convex/simulation/fakeProvider.test.ts convex/simulation/workflow.test.ts convex/canon/mistwoodFixture.test.ts (3 suites, 16 tests). Full validation: npm run check (architecture policy/tests, typecheck, lint, 13 Jest suites/106 tests, build). Tests run without LLM credentials and fail on attempted network, clock, or random access.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a fixed-seed deterministic Fake Provider contract and reusable isolated Mistwood fixture. Proved offline behavior, structured determinism, sequential Canon validity, full replay, and snapshot replay with focused tests and the complete 106-test build gate; ART-60/73 retain long-run ownership.
<!-- SECTION:FINAL_SUMMARY:END -->
