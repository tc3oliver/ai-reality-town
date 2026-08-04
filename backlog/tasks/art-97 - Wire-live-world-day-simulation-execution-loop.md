---
id: ART-97
title: Wire live world-day simulation execution loop
status: To Do
assignee: []
created_date: '2026-08-04 05:06'
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
- [ ] #1 A live-invokable Convex function (mutation/action) exists that, given a worldId and a queued scheduled slot, runs the full director -> intent -> scene-grouping -> scene-simulation -> commit chain for that slot and results in one or more new accepted canonEvents rows
- [ ] #2 The function is idempotent per FR-C001 AC#3/#4: a failed or retried slot does not duplicate committed events
- [ ] #3 An integration test proves a full world day (all TIME_SLOTS) can run end-to-end against a seeded world (e.g. the Mistwood fixture) and produces canon events without manual per-event scripting
- [ ] #4 Director output respects FR-C002 AC#1-4 (no scene/location conflicts, traceable to a Director Run, daily scene cap enforced) and FR-C003 AC#1-4 (character intents are structured, traceable, cannot directly mutate world state, invalid intents are rejected or degraded) as already specified by the existing director.ts/scheduler.ts pure logic -- this task verifies those guarantees hold when driven live, it does not redefine them
- [ ] #5 Uses the deterministic FakeSimulationProvider by default so the wiring can be exercised and tested with zero cost / no network; the real provider adapter (ART-72) can be swapped in via existing configuration without additional wiring changes
- [ ] #6 npm run check passes; the new orchestration function is documented as the FR-C001-C005 live entry point in code comments and, if applicable, docs/architecture
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
