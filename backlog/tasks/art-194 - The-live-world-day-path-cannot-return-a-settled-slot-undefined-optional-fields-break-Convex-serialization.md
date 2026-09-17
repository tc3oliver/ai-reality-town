---
id: ART-194
title: >-
  The live world-day path cannot cross the action boundary: the authoring plan
  carries a function
status: In Progress
assignee: []
created_date: '2026-09-17 16:23'
updated_date: '2026-09-17 16:26'
labels: []
dependencies: []
priority: high
ordinal: 191000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Running one live slot on the Public Acceptance deployment (colorless-deer-917) fails immediately:

  Uncaught TypeError: Cannot read properties of undefined (reading 'length')
      at stringifyValueForError (convex/src/values/value.ts:275)
      at errorMessageForUnsupportedType (convex/src/values/value.ts:383)
      at convexToJsonInternal ... x3
      at async driveOneWorld (convex/simulation/providers/liveWorldDayActions.ts:278)

Line 278 is the action calling prepareQueuedWorldDaySlot. The args are three guaranteed scalars, so the value Convex cannot serialize is the mutation RETURN.

## Root cause

convex/simulation/moduleConfig.ts:93, wholeSceneOptionsFor:

    buildSystemPrompt: selectWholeScenePrompt(config.promptVersion),

That is a FUNCTION. It is placed on WholeSceneSimulationOptions, which buildSceneAuthoringPlan stores as SceneAuthoringPlan.options, which prepareQueuedWorldDaySlot returns as { kind: 'awaiting_authoring', plan } — across an action-to-mutation boundary, where Convex must serialize it.

The nesting matches the stack exactly: prepared -> plan -> options -> function, three convexToJsonInternal frames.

Verified empirically against the installed convex-js: a function and a symbol produce precisely 'Cannot read properties of undefined (reading length)'. undefined object properties do NOT — convexToJson drops them silently. An earlier reading of this defect blamed explicitly-undefined optional fields on WorldDaySlotOutcome; that was wrong, and the probe is what disproved it.

## Why this is bigger than one failed command

awaiting_authoring is returned for every slot that actually needs the provider — which is every live slot that does real work. So the live path has never been able to author a scene since ART-159/ART-160 wired it up. This is the real reason ART-185 found a world that stopped advancing on 2026-08-04: the scheduled live cron has been dying here on every tick.

## Why no test caught it

The deterministic path runs the whole slot inside ONE mutation and never serializes the plan, so a function on options is harmless there. Every unit test builds and consumes the plan in-process. Nothing exercised the one boundary that serializes it.

## Fix direction

A function must not be on a value that crosses the boundary. The plan should carry the prompt VERSION (a string, which is what module config stores anyway) and the authoring side should resolve it to a builder where it already adds onAttempt and budget — both of which are added action-side for exactly this reason.

Scope: convex/simulation/moduleConfig.ts, convex/simulation/worldDayLive.ts, and a test that serializes the real plan the way Convex does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A successful live slot returns a settled PreparedSlot that Convex can serialize
- [ ] #2 An omitted optional field is ABSENT from the returned object, not present with value undefined
- [ ] #3 A failing slot still carries its failureStage, errorCode and errorMessage
- [ ] #4 Every other value crossing the live path's action/mutation boundary is checked for the same shape
- [ ] #5 A test serializes the real return value the way Convex does, so the defect cannot reappear behind an in-process assertion
- [ ] #6 Fault injection: restoring the explicit undefined fails a NAMED test
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
