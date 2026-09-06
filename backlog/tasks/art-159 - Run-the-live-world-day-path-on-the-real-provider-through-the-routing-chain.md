---
id: ART-159
title: Run the live world-day path on the real provider through the routing chain
status: In Progress
assignee: []
created_date: '2026-09-06 12:01'
labels:
  - prd-1.0
  - epic-a
dependencies:
  - ART-72
  - ART-158
priority: high
ordinal: 159000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

ART-72 delivered the OpenAI-compatible adapter, the pre-generation safety gate at the port, and ART-158 delivered the free-route fallback chain — but none of it is reachable from the world. createWorldDayStageHandlers defaults its provider to FakeWholeSceneProvider and worldDayLiveFunctions calls it without an argument, so every scene the live world authors is deterministic fake text. The real adapter is reachable only from probeConfiguredOpenAICompatibleProvider.

The reason is architectural, not an oversight: runQueuedWorldDaySlot is an internalMutation and a Convex mutation cannot perform network I/O. Wiring the real provider therefore requires splitting the slot so the provider call happens in an action, while Canon validation, safety, idempotency and event persistence stay inside a transaction.

## Goal

The live world-day path authors scenes through the real provider port and the ART-158 route chain, with the deterministic fake retained as an explicit test/dev binding rather than as the production default.

## Out of scope

Paid/free model filtering (FREE_ONLY is an endpoint/policy fact, not route metadata). ART-158 AC#2 per-route RPM/TPM time-bucketing. FR-M004 degradation ladder (ART-91).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The live world-day path authors scenes through the LanguageModelProvider port bound to the real adapter and the ART-158 route chain; FakeWholeSceneProvider is no longer the production default
- [ ] #2 No provider-specific branching appears in any domain or business module; the boundary policy fails the build if one is added
- [ ] #3 The deterministic fake path remains available for test and dev fixtures, and the whole offline gate still passes with no network access
- [ ] #4 When the primary route serves the call, no fallback route is attempted
- [ ] #5 A genuine 429 from the primary route causes the next route in the chain to be tried
- [ ] #6 A general provider failure is classified differently from a 429 and does not trigger the same fallback
- [ ] #7 Per-key quota exhaustion fails honestly; no code path claims that changing route restores allowance
- [ ] #8 Budget reserve/settle/release and token and request metering actually execute on the live wiring, proven end to end rather than by testing the helper
- [ ] #9 Route id is never assumed to equal the served model; metering books what the gateway resolved, for both auto and concrete-looking ids
- [ ] #10 Provider failure, retry and fallback never bypass Canon Validation, Safety Validation, Idempotency, or Event Persistence
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->
