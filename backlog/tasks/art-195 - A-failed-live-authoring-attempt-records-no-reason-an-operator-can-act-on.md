---
id: ART-195
title: A failed live authoring attempt records no reason an operator can act on
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 16:52'
updated_date: '2026-09-17 21:08'
labels: []
dependencies: []
priority: high
ordinal: 192000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Blocks Public Acceptance Qualification step 3 on colorless-deer-917 (Public Acceptance / Staging).

After ART-194 unblocked the action boundary, a live slot runs and fails at authoring:

  authoringErrorCode: SCENE_SIMULATION_FAILED
  authoredScenes: 0
  outcome.errorCode: SCENE_AUTHORING_DEFERRED
  outcome.failureStage: simulate_scenes

The recorded evidence cannot say WHY. llmTraces holds:

  errorCode: SCENE_ATTEMPT_FAILED, finalStatus: failed, validationResult: not_run,
  model: agnes-2.5-flash, retryCount: 0

and getOperationalQualityMetrics reports providerFailureReasons: [SCENE_ATTEMPT_FAILED x1].

## What those codes prove

sceneSimulation.ts:50 stableAttemptCode returns SCENE_ATTEMPT_FAILED ONLY when the thrown error has no  property. Every SimulationProviderError and every SceneSimulationError carries one. So the error was neither — a raw Error or TypeError escaped the adapter.

Line 570-572 corroborates it: a SceneSimulationError or SimulationProviderError is rethrown as itself, and the outer code was the SCENE_SIMULATION_FAILED fallback, which is only reached when lastError is neither.

validationResult: not_run means no response was ever parsed.

## The repository defect

An unclassified exception on the live provider path is recorded as a constant and its message is discarded, so an operator is told a call failed and nothing else. ART-166 already fixed this shape once for the codes that WERE known; this is the case where no code exists at all, and it is the case that most needs a message.

Nothing in the repository currently lets an operator answer 'why did authoring fail' without adding code to a deployment.

## What is NOT established

Whether the underlying cause is a repository defect or an upstream gateway rejection. All provider configuration is present on the acceptance deployment — LLM_API_URL, LLM_API_KEY, LLM_MODEL, LLM_EMBEDDING_MODEL, LLM_EMBEDDING_DIMENSION and SIMULATION_LIVE_ROUTE_CHAIN are all set — and loadOpenAICompatibleConfig throws with a code when any is missing, which did not happen. The model actually requested was agnes-2.5-flash.

Do not classify the cause until the error is captured. Capturing it is this task.

## Suggested direction

Record the error message and constructor name alongside the code on the attempt row, and wrap anything escaping the adapter in a SimulationProviderError so the free-route chain can classify it. Both are diagnosability, not behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A live authoring failure records enough for an operator to name the cause without deploying new code
- [x] #2 An exception that escapes the provider adapter is classified rather than reaching the attempt recorder bare
- [x] #3 SCENE_ATTEMPT_FAILED stops being reachable for an error that had a usable message
- [x] #4 A test drives a raw, code-less throw from the adapter and asserts the recorded evidence names it
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## The propagation path, and the five places evidence is lost

provider adapter -> free-route chain -> simulateWholeScene attempt loop -> authorSlotScenes
  -> authorAndSettle -> LiveSlotOutcome / llmTraces row

1. sceneSimulation.ts:572 -- `throw new SceneSimulationError('SCENE_SIMULATION_FAILED', 'whole-scene provider failed')`
   discards `lastError` ENTIRELY. No name, no message, no cause, no stage. This is the observed loss.
2. sceneSimulation.ts:50 `stableAttemptCode` keeps only `.code`. `PreGenerationSafetyError` carries its
   code on `.rejection.code`, not `.code`, so a safety block reads `SCENE_ATTEMPT_FAILED` too.
3. liveWorldDayActions.ts:197 `stableCodeOf` -- same rule, and `LiveSlotOutcome.authoringErrorCode` is a
   bare string, so the action's return value cannot carry a reason either.
4. AuthoringAttemptDraft carries `errorCode` and nothing else.
5. `llmTraces` is contractually CODES ONLY (`ERROR_CODE_PATTERN` is upper-case; the header says
   "A code, never a message"). That contract is correct and is NOT being widened.

Raw exceptions can escape at: `gate.reserve` / `gate.settle` (a Convex mutation error, raw),
`assertPreGenerationSafe` (PreGenerationSafetyError, no `.code`), and anything a future adapter throws.

## Plan

1. NEW `convex/shared/failureDetail.ts` (pure; `shared` depends on nothing):
   `describeFailure(error, fallbackStage)` -> `{ code, errorName, message, stage, causeName, causeCode,
   causeMessage, retryable }`. Stage and retryability are DERIVED from the error, not passed in, so the
   recorded `retryable` is the same predicate the retry loop uses rather than a description of it.
   Code derivation: `.code` when it matches the bounded upper-case pattern; `PreGenerationSafetyError`
   -> `LLM_PRE_GENERATION_BLOCKED`; otherwise upper-snake of the constructor NAME
   (`TypeError` -> `PROVIDER_EXCEPTION_TYPE_ERROR`), falling back to `PROVIDER_EXCEPTION_UNCLASSIFIED`.
   A class name is a code-side constant, never model text, so it is safe to promote to a code.
2. Secret safety in the same module: `sanitizeFailureText` strips `Bearer <...>`, credential query
   params, and any opaque run of >=24 token characters; bounds the result and PUBLISHES what it
   truncated (never silent). Non-string `message` yields `''` -- no arbitrary object is ever
   stringified. Exact-value redaction of the configured key is a SECOND pass applied only in
   `providers/`, which is the one place that has the value.
3. `simulateWholeScene`: keep the two existing error types rethrown as themselves (contract unchanged);
   attach the sanitized detail to the `SCENE_SIMULATION_FAILED` fallback, and pass the detail through
   `onAttempt`. `retryable` comes from `describeFailure`, so the field cannot drift from the decision.
4. `AuthoringAttemptDraft` gains `failure: FailureDetail | null`; `recordAuthoringAttempt` writes the
   `llmTraces` row EXACTLY as now (code only) and inserts the sanitized detail into a new
   `authoringFailures` table. The trace contract stays intact and the sanitizer has one boundary.
5. `LiveSlotOutcome` gains `authoringFailure`, so `runLiveWorldDaySlotWithProvider` prints the root
   cause. `authoringErrorCode` is kept and is now `failure.code`.
6. Tests: unit tests for the sanitizer and the classifier; a regression suite driving the REAL adapter
   with a stub transport for plain Error, non-Error throw, HTTP 500/401, malformed response, abort, and
   a known typed error. Fault injection: restore line 572 and prove the evidence collapses to
   `SCENE_SIMULATION_FAILED` with nothing else.
7. `npm run codegen:api` -- a new file under `convex/`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Phase 1 (observability) complete.

Propagation path and the five loss points are in the plan. Implemented:
- convex/shared/failureDetail.ts — describeFailure / sanitizeFailureText / redactSecrets.
  Stage and retryability DERIVED from the error; retryability is the predicate
  simulateWholeScene now applies, so the field cannot drift from the decision.
- convex/simulation/schema.ts — authoringFailures table. llmTraces is NOT widened.
- sceneSimulation.ts — the fallback throw carries the detail; onAttempt carries it.
- qualityEvidenceFunctions.ts — writes the second row, deduped on the same attempt key,
  BEFORE the llmTraces dedup return so a pre-ART-195 trace row does not block it.
- liveWorldDayActions.ts — exact-value secret pass; LiveSlotOutcome.authoringFailure.

Verification:
- npm run check exit 0. 275 suites, 4773 tests passed (baseline 4717 + 56 new).
- 56 new tests across two suites; 18 of them drive the REAL adapter over a stub transport.
- SIX fault injections, each failing the named test it should:
  1 restore old fallback throw      -> 1 failed  (carries the same detail out on the thrown error)
  2 restore .code-only rule         -> 13 failed (derives a code from the class..., and 12 more)
  3 drop bearer redaction           -> 1 failed  (redacts a bearer token but keeps the word...)
  4 drop exact-value secret pass    -> 2 failed  (removes the configured credential wherever...)
  5 stringify non-string message    -> 1 failed  (never stringifies a non-string message)
  6 drop truncation marker          -> 1 failed  (publishes what truncation removed...)
  Baseline restored to 56/56 after each.
- Two harness faults caught and not counted as results: a 'git checkout --' reverted
  uncommitted work mid-injection (redone, then committed BEFORE injecting), and zsh does not
  word-split unquoted expansions, so the first injection round reported 'Tests: 0 total'.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in #305 and corrected in #306. convex/shared/failureDetail.ts classifies any thrown value into a bounded code, the class name, a sanitized message, the pipeline stage, the cause and retryability; stage and retryability are DERIVED from the error, and retryability is the predicate simulateWholeScene now applies. Secret safety is two passes -- by shape in shared/, by exact value in providers/ -- with truncation published and no arbitrary object ever stringified. The detail goes to a new authoringFailures table; llmTraces' code-only contract is untouched. Verified: npm run check exit 0; 56 new tests, 18 driving the real adapter; six fault injections plus four more for the corrections, each failing the named test it should. It worked on its first live use: the very next slot named INVALID_EVENT_SHAPE / CanonError / 'stateChanges must not be empty', which is ART-196.
<!-- SECTION:FINAL_SUMMARY:END -->
