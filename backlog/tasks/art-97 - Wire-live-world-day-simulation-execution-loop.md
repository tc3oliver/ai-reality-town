---
id: ART-97
title: Wire live world-day simulation execution loop
status: In Progress
assignee: []
created_date: '2026-08-04 05:06'
updated_date: '2026-08-04 05:36'
labels:
  - prd-1.0
  - epic-c
  - launch-readiness
dependencies:
  - ART-18
  - ART-19
  - ART-20
  - ART-21
  - ART-22
  - ART-23
  - ART-4
  - ART-72
priority: high
ordinal: 97000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PRD Milestone 2's completion criterion requires that 'one world day can run completely end-to-end' (backlog/docs/prd/ai-reality-town-prd-1.0/doc-1, Section 18, Milestone 2), and FR-C001-C005 (Section 11, Epic C) are all P0. ART-18/19/20/21/22/23 implement the world scheduler, director planning, character intent generation, scene grouping, and scene simulation as pure, unit-tested logic, but none of them are wired into a live-invokable Convex action or cron: confirmed by grep that convex/simulation/worldDayOrchestration.ts (executeWorldDay) and the director/scene-simulation Convex function wrappers are referenced nowhere outside their own files, _generated/api.d.ts, and tests. The only live-wired event-producing path today is convex/simulation/workflow.ts (runFoundationSimulation), a Phase-0 scaffold that only ever emits a single trivial movement event via FakeSimulationProvider -- it cannot produce director-planned, multi-character scenes. This task closes that gap: wire a real, live-invokable orchestration (triggered by the existing scheduler slot-reservation mutations in convex/simulation/schedulerOperations.ts) that, for one queued slot, runs director planning -> character intent generation -> scene grouping -> scene simulation -> commits the resulting proposed event(s) through the existing canon commit pipeline (convex/canon/commit.ts), reusing the FakeSimulationProvider (or the real provider adapter from ART-72) as the character-intent/scene-simulation backend. Do not change the underlying pure logic modules unless a defect is found while wiring them; this task is about connecting already-tested pieces, not re-implementing them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A live-invokable Convex function (mutation/action) exists that, given a worldId and a queued scheduled slot, runs the full director -> intent -> scene-grouping -> scene-simulation -> commit chain for that slot and results in one or more new accepted canonEvents rows
- [x] #2 The function is idempotent per FR-C001 AC#3/#4: a failed or retried slot does not duplicate committed events
- [x] #3 An integration test proves a full world day (all TIME_SLOTS) can run end-to-end against a seeded world (e.g. the Mistwood fixture) and produces canon events without manual per-event scripting
- [x] #4 Director output respects FR-C002 AC#1-4 (no scene/location conflicts, traceable to a Director Run, daily scene cap enforced) and FR-C003 AC#1-4 (character intents are structured, traceable, cannot directly mutate world state, invalid intents are rejected or degraded) as already specified by the existing director.ts/scheduler.ts pure logic -- this task verifies those guarantees hold when driven live, it does not redefine them
- [x] #5 Uses the deterministic FakeSimulationProvider by default so the wiring can be exercised and tested with zero cost / no network; the real provider adapter (ART-72) can be swapped in via existing configuration without additional wiring changes
- [x] #6 npm run check passes; the new orchestration function is documented as the FR-C001-C005 live entry point in code comments and, if applicable, docs/architecture
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
1. Add convex/simulation/fakeSceneNarrator.ts: deterministic FakeWholeSceneProvider implementing LanguageModelProvider (fakeProvider.ts idiom: no network, no key, same input -> same output). It turns a GroupedScene into a WholeSceneOutput (summary, key actions, dialogue, one conversation Proposed Event with relationship_changed + character_memory_formed + fact_created state changes, relationship/knowledge/memory/rumor links, continuity warnings).
2. Add convex/simulation/worldDayLive.ts (pure, no Convex imports): a WorldDayLivePort data-access port + LiveWorldSnapshot type, deterministic builders for DirectorPlanContext / candidate DirectorPlan and per-character CharacterIntentContext / CharacterIntent, and createWorldDayStageHandlers(port) returning the 10 WorldDayStageHandlers for executeWorldDay. Reuse (never reimplement) parseAndValidateDirectorPlan, validateCharacterIntent, groupCharacterIntents, simulateWholeScene, validateEventStructure, validateCanon, commitProposedEvent. Checkpoint artifacts stay small (ids/counts); heavy artifacts are re-read from their persisted tables so resume works.
3. Add createConvexWorldDayRunStore(db) to convex/simulation/worldDayOrchestrationFunctions.ts, following the createConvexCanonStore(db) adapter idiom in convex/canon/commit.ts.
4. Add convex/simulation/worldDayLiveFunctions.ts: internalMutation runQueuedWorldDaySlot({worldId, slotId?, maxSlots?, now?}) - the FR-C001..C005 live entry point. It picks the oldest queued scheduledSlots row (or the given slotId), calls startScheduledSlot, runs executeWorldDay with the Convex-backed store + port, then completeScheduledSlot (with the committed event id) or failScheduledSlot. Director plans, intents, grouped scenes and scene simulations are persisted through the existing internal mutations (persistDirectorPlan, persistCharacterIntent, groupPersistedCharacterIntents, persistValidatedSceneSimulation) via ctx.runMutation so their tested idempotency/authorization rules run live.
5. Idempotency (FR-C001 AC#3/#4): runId, directorRunId, intentRunId, groupingRunId, simulationRunId and every Proposed Event idempotencyKey are derived from (worldId, worldDay, timeSlot), so a retry resumes from the last safe checkpoint and the canon commit dedups instead of duplicating events.
6. Safety (FR-C005 AC#5): scenes whose simulation result is reviewStatus 'required' are withheld from the commit stage and recorded in the checkpoint artifact.
7. Tests: convex/simulation/worldDayLive.test.ts drives a full world day (all five TIME_SLOTS) against an in-memory port seeded from the Mistwood seed plus InMemoryCanonStore, asserting canon events are produced, retries do not duplicate them, director/intent/grouping constraints hold live, and the live entry point stays internal.
8. Docs: document the entry point in code comments and docs/architecture/current-state.md; run npm run check; commit, push, PR with auto-merge; set ART-97 to In Review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was wired

New:
- convex/simulation/worldDayLive.ts (pure): WorldDayLivePort + LiveWorldSnapshot, buildLiveWorldSnapshot, buildDirectorPlanContext, generateDirectorPlanCandidate, buildCharacterIntentContext, generateCharacterIntent, and createWorldDayStageHandlers(port) returning the 10 PRD Section 12 stage handlers for executeWorldDay.
- convex/simulation/fakeSceneNarrator.ts: FakeWholeSceneProvider, a deterministic no-network/no-key LanguageModelProvider (fakeProvider.ts idiom) that turns a GroupedScene into a full WholeSceneOutput -- key actions, dialogue, and one conversation Proposed Event carrying relationship_changed + character_memory_formed + fact_created state changes. Replaces the Phase-0 single-movement scaffold for scene work.
- convex/simulation/worldDayLiveFunctions.ts: internalMutation runQueuedWorldDaySlot({worldId, slotId?, maxSlots?, now?}) -- the FR-C001..C005 live entry point.
- convex/simulation/worldDayLive.test.ts: 10 integration tests.
- docs/world-day-execution.md; cross-links from docs/world-day-orchestration.md and docs/architecture/target-state.md.

Changed:
- convex/simulation/worldDayOrchestrationFunctions.ts: extracted the durable operations into plain db helpers so the existing internal mutations and the new createConvexWorldDayRunStore(db, now) adapter share one implementation (same idiom as createConvexCanonStore in convex/canon/commit.ts). One deliberate behavior change: updateRun no longer clears committedEventIds when the argument is absent, so a resume/fail update cannot drop commit evidence (PRD Section 12: accepted events must never be lost).

No pure logic module was modified -- no defect was found in director.ts, characterIntent.ts, sceneGrouping.ts, sceneSimulation.ts, commit.ts or validators.ts. Every stage is a thin adapter over them.

## Key decisions

- Single Convex mutation/transaction, like runFoundationSimulation: the deterministic provider needs no network, so there is no action-then-mutation race and the commit stays atomic. maxSlots (1..5) lets one call execute a whole world day.
- Identity is derived, not allocated: worldday:/director:/intent:/grouping: Run IDs and every Proposed Event idempotency key come from (worldId, worldDay, timeSlot). A completed run short-circuits, an interrupted run resumes at its last safe checkpoint, and a replayed proposal deduplicates at the Canon commit boundary.
- Director/Intent/Grouping/Scene artifacts are persisted through the existing internal mutations via ctx.runMutation, so their already-tested idempotency and per-character authorization rules execute live rather than being reimplemented.
- Every character produces a structured intent each slot; characters the Director did not schedule emit a 'wait' intent with downgradeReason INTENT_NOT_SCHEDULED_THIS_SLOT, so FR-C003 traceability holds without inflating the FR-C002 major-scene cap.
- Scene results with reviewStatus 'required' (safety withhold / human review) are persisted for review and excluded from the commit stage.
- Stage 2 (apply scheduled environment events) commits any queued environment proposals through the same Canon pipeline; FR-J001 viewer environment-event voting does not exist yet, so today the queue is genuinely empty. This is recorded as an honest empty input, not a stub.
- The entry point is internal only: public reads must never trigger generation.

## Live verification (deployment colorless-deer-917, world 'mistwood', seeded per ART-77)

Before: npx convex data canonEvents -> 15 rows (genesis seed, sequences 0-14).

  npx convex run simulation/schedulerOperations:advanceOneWorldDay '{"worldId":"mistwood","now":1785810500000}'
  -> reserved 5 scheduledSlots (day 0 morning..night)

  npx convex run simulation/worldDayLiveFunctions:runQueuedWorldDaySlot '{"worldId":"mistwood"}'
  -> {"executed":1,"slots":[{"slotKey":"mistwood:day:0:slot:morning","status":"completed","attemptCount":1,"committedEventIds":["mistwood#event#15","mistwood#event#16","mistwood#event#17"]}]}

  npx convex run simulation/worldDayLiveFunctions:runQueuedWorldDaySlot '{"worldId":"mistwood","maxSlots":4}'
  -> executed 4; noon #18-#20, afternoon #21-#23, evening #24-#26, night #27-#29, all status completed

After: canonEvents 30 rows (15 new). Artifact tables: directorPlans 5, characterIntents 60 (12 characters x 5 slots), groupedSceneRuns 5, sceneSimulationRuns 15, worldDayRuns 5 all completed, worldDayCheckpoints 50 completed (5 runs x 10 stages). All 5 scheduledSlots completed with a committedEventId.

Sample new canonEvents row (sequence 29 payload excerpt):
  eventType 'conversation', idempotencyKey 'grouping:mistwood:0:night:scene:3:event:1', locationId 'mistwood-mill', participantIds ['he-jun','zhao-ming'], proposedBy {type:'director', id:'director:mistwood:0:night'}, publicSummary 'At mistwood-mill, he-jun and zhao-ming meet over: Press the matter of "Prevent another mill shutdown." at mistwood-mill', traceId 'worldday:mistwood:0:night', validationVersion 'canon-v1'.

Live idempotency evidence:
- Re-running with no queued slot: {"executed":0,"slots":[]}.
- Re-running a completed slot by slotId: rejected with SchedulerError INVALID_SLOT_TRANSITION ('only queued slots may start'); canonEvents stayed at 30 (FR-C001 AC#1).
- Re-proposing a committed key through the public commit mutation:
  npx convex run canon/commit:validateAndCommitProposedEvent with idempotencyKey 'grouping:mistwood:0:night:scene:1:event:1'
  -> {"deduplicated":true,"eventId":"mistwood#event#27","sequenceNumber":27}; canonEvents stayed at 30 (FR-C001 AC#4).

## Automated verification

npm run check -> architecture boundaries valid (policy v1, 11 modules), boundary unit tests pass, typecheck clean, lint clean, 69 suites / 654 tests passed, vite build succeeded.

## AC#5 deviation, recorded explicitly

The AC names FakeSimulationProvider. That class implements the SimulationProvider port whose proposeEvent returns a single movement event; it structurally cannot author a whole scene, which is what FR-C005 requires. This task therefore adds FakeWholeSceneProvider, built to the same idiom (deterministic, same input -> same output, no network, no API key, no cost) but implementing the vendor-neutral LanguageModelProvider port that simulateWholeScene consumes. FakeSimulationProvider is untouched and still backs runFoundationSimulation. The intent of AC#5 -- exercise and test the live wiring at zero cost with no network -- is met, and createWorldDayStageHandlers(port, provider?) takes any LanguageModelProvider so the ART-72 OpenAI-compatible adapter is injected at that seam with no change to this wiring (covered by the test 'accepts any LanguageModelProvider so a real adapter swaps in without rewiring'). Provider construction deliberately stays inside convex/simulation/providers, the only adapter root the architecture boundary permits it in.

## Second live run (world day 1, after the provider-injection seam was added)

  npx convex run simulation/schedulerOperations:advanceOneWorldDay '{"worldId":"mistwood","now":1785810600000}'
  npx convex run simulation/worldDayLiveFunctions:runQueuedWorldDaySlot '{"worldId":"mistwood","maxSlots":5}'
  -> executed 5, all five day-1 slots completed; canonEvents 30 -> 45.

Final npm run check after the seam change: architecture boundaries valid, 69 suites / 655 tests passed, build succeeded.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired PRD Section 12 stages 1-10 (FR-C001..FR-C005) into one live-invokable Convex entry point, simulation/worldDayLiveFunctions:runQueuedWorldDaySlot. It takes a reserved scheduledSlots row, drives executeWorldDay through load world state -> environment events -> active arcs -> Director Plan -> Character Intents -> scene grouping -> whole-scene simulation -> structural validation -> Canon validation -> Canon commit, then completes or fails the slot. New convex/simulation/worldDayLive.ts builds each capability's input from real world state and returns the ten stage handlers; new convex/simulation/fakeSceneNarrator.ts (FakeWholeSceneProvider) is a deterministic, no-network, no-cost LanguageModelProvider that authors multi-character scenes, replacing the Phase-0 single-movement scaffold. No pure logic module was changed: parseAndValidateDirectorPlan, validateCharacterIntent, groupCharacterIntents, simulateWholeScene, validateEventStructure, validateCanon and commitProposedEvent are reused as-is. worldDayOrchestrationFunctions.ts gained createConvexWorldDayRunStore and had its durable operations extracted into shared db helpers.

Verified live against dev deployment colorless-deer-917, world 'mistwood': two complete world days ran end-to-end (day 0 slot by slot, day 1 in a single maxSlots=5 call), taking canonEvents from 15 genesis rows to 45 -- 30 new director-planned 'conversation' events with relationship, memory and fact state changes, plus 10 directorPlans, 120 characterIntents, 10 groupedSceneRuns, 30 sceneSimulationRuns, 10 completed worldDayRuns and 100 completed checkpoints. Idempotency verified live three ways: a re-run with no queued slot is a no-op, a completed slot is rejected with INVALID_SLOT_TRANSITION, and re-proposing a committed key returns {deduplicated:true, eventId:'mistwood#event#27'} without adding a row. Automated: convex/simulation/worldDayLive.test.ts adds 11 tests (full world day over all TIME_SLOTS on the Mistwood seed, resume after a partial commit with no duplicates, FR-C002 plan constraints, FR-C003 intent traceability and degradation, FR-C004 scene bounds, FR-C005 safety withholding, provider swappability). npm run check is green: architecture boundaries valid, typecheck and lint clean, 69 suites / 655 tests passed, build succeeded.
<!-- SECTION:FINAL_SUMMARY:END -->
