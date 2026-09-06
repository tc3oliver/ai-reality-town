---
id: ART-159
title: Run the live world-day path on the real provider through the routing chain
status: In Progress
assignee: []
created_date: '2026-09-06 12:01'
updated_date: '2026-09-06 12:48'
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
- [x] #1 The live world-day path authors scenes through the LanguageModelProvider port bound to the real adapter and the ART-158 route chain; FakeWholeSceneProvider is no longer the production default
- [x] #2 No provider-specific branching appears in any domain or business module; the boundary policy fails the build if one is added
- [x] #3 The deterministic fake path remains available for test and dev fixtures, and the whole offline gate still passes with no network access
- [x] #4 When the primary route serves the call, no fallback route is attempted
- [x] #5 A genuine 429 from the primary route causes the next route in the chain to be tried
- [x] #6 A general provider failure is classified differently from a 429 and does not trigger the same fallback
- [x] #7 Per-key quota exhaustion fails honestly; no code path claims that changing route restores allowance
- [x] #8 Budget reserve/settle/release and token and request metering actually execute on the live wiring, proven end to end rather than by testing the helper
- [x] #9 Route id is never assumed to equal the served model; metering books what the gateway resolved, for both auto and concrete-looking ids
- [x] #10 Provider failure, retry and fallback never bypass Canon Validation, Safety Validation, Idempotency, or Event Persistence
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
- [ ] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce: prove the live path is broken today, before changing anything. 2. Fix the trace contract ART-148 broke. 3. Split the slot so only the provider call leaves the transaction: prepareQueuedWorldDaySlot (stages 1-6) -> authorSlotScenes (action) -> runQueuedWorldDaySlot (stages 7-10). 4. Remove the fake default entirely; fuse the author and the metered model id into one value. 5. Assemble the adapter + safety gate + route chain in the adapter root, and wire parseFreeRouteChain to an env var. 6. Make the budget reachable from an action via internal mutations. 7. Prove the wiring end to end with only fetch stubbed; verify by injection. 8. Live smoke test against the real gateway, gated.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Root cause

Two independent breaks, both on the live path, neither visible offline.

1. **The wiring gap.** `runQueuedWorldDaySlot` is an internalMutation and a Convex mutation may not perform network I/O, so the live path could not call a provider at all. `createWorldDayStageHandlers` DEFAULTED to FakeWholeSceneProvider, so the production entry point selected the fake by saying nothing. ART-72's adapter, ART-156's port safety gate and ART-158's route chain were all built, tested and unreachable — `parseFreeRouteChain` had no caller anywhere in the codebase.

2. **A live-path regression from ART-148.** `persistValidatedSceneSimulation.parseTrace` is the entire schema for the stored trace (the arg is `v.any()`). ART-148 renamed `ProviderTraceMetadata.model` to `requestedModel` and added three fields; the whitelist was not updated, so it demanded a key neither shipped provider has and rejected every key they had gained. Every live slot would have failed at stage 7. It had ZERO test coverage: the unit suites call simulateWholeScene directly and never persist, and the E2E fixture serves pre-built read models rather than running a slot. Reproduced with a failing test before the fix (6 failed / 5 passed), which also showed persistence ACCEPTING the stale pre-ART-148 shape.

## What changed

The slot is split so only the provider call leaves the transaction:
prepareQueuedWorldDaySlot (mutation, stages 1-6) -> authorSlotScenes (action) -> runQueuedWorldDaySlot (mutation, stages 7-10).

Canon validation, both safety classifications, idempotency and the commit are all still inside a transaction and are the same code on both paths. The action writes only sceneSimulationRuns and the budget ledger.

The fake default was REMOVED rather than repointed: createWorldDayStageHandlers requires its provider, and sceneAuthorFor returns the provider and the metered model id as ONE value, so the pair the old source-scanning pin held together by inspection is now held by the compiler. 'preauthored' authors nothing — a missing scene raises SCENE_AUTHORING_DEFERRED rather than falling back to the fake, which would put invented text into Canon whenever the gateway was down.

## Defects found while building it

- The route chain discarded `request.model`, silently voiding ART-59's over-budget downgrade: the accountant granted a reservation against the fast class, recorded that it had, and the call ran on the configured route anyway.
- `routeFailureFrom` read `code === 'LLM_HTTP_RETRYABLE'` as 'rate limited', but that code also covers 408 and every 5xx — a gateway returning 500 was booked as an exhausted allowance.
- An exhausted route chain matched neither branch, so the one outage that IS rate limiting was recorded as a generic failure and usageByRoute.rateLimited stayed at zero.

Retryability and cause are different questions, so SimulationProviderError now carries `rateLimited` alongside `kind`, defaulting to false.

## Evidence

- `npm run check`: 212 suites, 3500 passed, 5 skipped, boundaries valid, build clean.
- `npm run e2e`: 82 passed.
- `convex/simulation/providers/liveWorldDayWiring.test.ts` (35 tests): the real chain end to end — authorSlotScenes -> simulateWholeScene -> runBudgetedAttempt -> FreeRouteChainProvider -> safety gate -> adapter -> fetch, with a fake ActionCtx dispatching to the REAL registered mutations. Only fetch is stubbed.
- Five required injections, each reddened named tests, none produced 'Tests: 0 total':
  1. route chain stripped from the composition root -> 8 failed
  2. 429 misclassified (rateLimited: false) -> 1 failed
  3. fallback unconditional (isRouteLevelFailure always true) -> 4 failed
  4. budget release wiring removed -> 2 failed
  5. fake re-hardwired: on the live pass -> 1 failed; default restored -> 1 failed
- The boundary policy caught 3 real violations during development (simulation->operations, and two adapter-root imports), which is why the live action lives in convex/simulation/providers/.

## Live gateway verification

Run against the configured deployment (`ART159_LIVE_SMOKE=1 npm run test:live-gateway`, 4/4 passed):

  requested=auto resolved=deepseek/deepseek-v4-pro upstream=xkiro allowance=119/120 tokens=375

AC#9 confirmed against a real router: the alias owns no usage and the concrete model the gateway chose does. The suite is env-gated, is not part of npm run check, and skips to '4 skipped' rather than '0 total'.

**Boundary between fixture and live evidence:** the 429 fallback is proven in the FIXTURE suite (real 429 status through the real adapter and chain, stubbed transport), NOT live — a smoke test cannot summon a real rate limit. A live attempt using an unknown route as a stand-in failed, and the code was right: this gateway answers 404 model_not_found / invalid_request_error, classifying it as a request error itself, so the chain correctly does not hop. That test now asserts the honest property.

Nothing was deployed. No Convex function was pushed; the live evidence is the provider half only, exercised from the local checkout.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired the live world-day path to the real provider. The blocker was architectural, not a missing injection: runQueuedWorldDaySlot is an internalMutation and a Convex mutation may not perform network I/O, so ART-72's adapter, ART-156's port safety gate and ART-158's route chain were all built, tested and unreachable — parseFreeRouteChain had no caller at all. The slot is now split so only the provider call leaves the transaction (prepare stages 1-6 -> author in an action -> finish stages 7-10); Canon validation, both safety classifications, idempotency and the commit stay inside one and are the same code on both paths. The fake default was removed rather than repointed, and the author and the metered model id are now one value. Also fixed a live-path regression ART-148 left behind: parseTrace still demanded a key the port had renamed, so every live slot would have failed at persistence — it had zero test coverage, and was reproduced with a failing test first. Verified by npm run check (212 suites / 3500 passed, boundaries valid, build clean), npm run e2e (82 passed), a 35-test end-to-end wiring suite with only fetch stubbed, five fault injections that each reddened named tests with no 'Tests: 0 total', and a gated live gateway run that reported requested=auto resolved=deepseek/deepseek-v4-pro upstream=xkiro allowance=119/120.
<!-- SECTION:FINAL_SUMMARY:END -->
