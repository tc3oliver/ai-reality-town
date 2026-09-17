---
id: ART-195
title: A failed live authoring attempt records no reason an operator can act on
status: To Do
assignee: []
created_date: '2026-09-17 16:52'
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
- [ ] #1 A live authoring failure records enough for an operator to name the cause without deploying new code
- [ ] #2 An exception that escapes the provider adapter is classified rather than reaching the attempt recorder bare
- [ ] #3 SCENE_ATTEMPT_FAILED stops being reachable for an error that had a usable message
- [ ] #4 A test drives a raw, code-less throw from the adapter and asserts the recorded evidence names it
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
