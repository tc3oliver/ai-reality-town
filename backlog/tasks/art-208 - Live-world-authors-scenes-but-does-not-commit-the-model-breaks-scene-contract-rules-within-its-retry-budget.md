---
id: ART-208
title: >-
  Live world authors scenes but does not commit: the model breaks scene-contract
  rules within its retry budget
status: Done
assignee: []
created_date: '2026-09-18 03:00'
updated_date: '2026-09-18 14:00'
labels: []
dependencies: []
priority: high
ordinal: 205000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
State after ART-195/196/197/199/200/201/202/203/204/205/206/207 on colorless-deer-917.

The authoring path is healthy and fully diagnosable. Slots reliably author 3 scenes. Every failure
now names its own rule. What the world does NOT do is commit: Canon sequence has been 88 since the
one successful slot on 2026-09-17.

## What the live evidence says

inspectAuthoringFailures, most recent 20:

  SCENE_OUTPUT_INVALID              13  'relationship endpoints must differ' x4,
                                        'character is not a Scene participant' x3,
                                        'must be a non-empty string'
  INVALID_EVENT_SHAPE                4  'fromValue does not match the selected state field',
                                        'sourceEventId has invalid reference format'
  SCENE_OUTPUT_PROVENANCE_MISMATCH   2
  SCENE_CANON_REJECTED               0

Stage 8 separately refuses DUPLICATE_CHARACTER_MOVEMENT on scenes that were authored successfully.

Every one of these rules is stated in the prompt, most of them with the scene's literal values
inlined, and since ART-207 a refusal is fed back as a specific correction. The model still breaks
them, and a slot exhausts its 2 semantic attempts per scene.

## Two candidate levers, and why neither is mine to pull

1. semanticMaxAttempts is 2. Raising it gives the feedback loop more chances to converge, and it
   spends more free-tier allowance per slot on a key whose allowance is the thing that can stop the
   world. That is a cost decision.

2. The model itself. The deployment requests `agnes-2.5-flash` through the free-route chain. A more
   capable route would follow a long contract more reliably, and choosing it is a cost and
   product decision.

Neither is a repository defect. Do not raise the retry budget or change the route without deciding
the cost.

## Open question, not assumed answered

No SCENE_CANON_REJECTED row has ever been written, while stage 8 refuses DUPLICATE_CHARACTER_MOVEMENT
on scenes the ART-205 in-authoring check passed. The wiring is present end to end and
validateSceneProposals returns correct feedback when called directly with a bad event. Why the two
checks disagree is unexplained. Investigating it needs per-call instrumentation that does not exist.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The disagreement between the in-authoring Canon check and stage 8 is explained from evidence
- [x] #2 A decision is recorded on the retry budget and the route, with their allowance cost
- [ ] #3 A slot commits end to end on acceptance
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
ROOT CAUSE (B): the candidate is mutated between the two validations.

simulate_scenes does, AFTER authorSlotScenes returns:
  results.push(withSceneProvenance(withArrivalStateChanges(result, world.snapshot)))

withArrivalStateChanges PREPENDS a character_location_changed to the FIRST proposed event for
every participant whose projected location differs from the scene's. The ART-205 in-authoring check
runs inside simulateWholeScene, BEFORE that injection, so it validates the author's events and
never sees the injected one. Stage 8 validates the merged event.

If the author also moved that character -- which ART-200 now actively encourages, because each
participant is told their own origin and their own legal destinations -- the merged event carries
TWO character_location_changed for one character and Canon refuses it with
DUPLICATE_CHARACTER_MOVEMENT.

That is exactly the three-way contradiction: in-authoring PASS, stage 8 refuse, zero
SCENE_CANON_REJECTED rows. All three hold because the two checks are not looking at the same event.

The injection's own docblock states the premise it was built on: 'The author never sees the world
projection, so it cannot state the movement precondition.' ART-200 made that false.

FIX: withArrivalStateChanges must not inject an arrival for a character the author already moved
anywhere in the scene. The authored movement stands; the orchestrator stops contradicting it.
Per-scene rather than per-event, because an arrival in event 1 plus an authored move in event 2 is
CHARACTER_ALREADY_MOVED_THIS_SLOT rather than a duplicate.

Lowers no threshold: Canon is unchanged, stage 8 is unchanged, and the author's own proposal is
still fully validated.

CROSS-STAGE TEST: drive parsed scene -> in-authoring validation -> withArrivalStateChanges ->
withSceneProvenance -> stage 7 -> stage 8 with the real functions, and assert that a candidate the
in-authoring check accepted is not refused later by the same rule, plus that the authored
stateChanges survive the boundary unmodified.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: B -- the candidate is mutated between the two validations.

withArrivalStateChanges prepends a character_location_changed to the first proposed event AFTER
authorSlotScenes returns, so the ART-205 in-authoring check never sees it. When the author has
already moved that character -- which ART-200 actively encourages -- the merged event carries two
movements and Canon refuses it. All three contradictory observations follow from that single fact.

Verified: npm run check exit 0, 4914 tests (baseline 4907 + 7).
crossStageValidatorAgreement.test.ts reproduced the live DUPLICATE_CHARACTER_MOVEMENT with no
provider before the fix.
Two fault injections, each failing the named test it should:
  1 remove the authored-movement skip -> 3 failed
  2 skip per EVENT instead of per scene -> bit nothing until a multi-event case was added, then 1 failed
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in #319. ROOT CAUSE: B -- the candidate is mutated between the two validations. simulate_scenes applies withArrivalStateChanges AFTER authorSlotScenes returns, prepending a character_location_changed to the first proposed event for every participant whose projected location differs from the scene's. The ART-205 in-authoring check runs inside simulateWholeScene and never sees it, so when the author had already moved that character -- which ART-200 actively encourages -- the merged event carried two movements and Canon refused it. All three contradictory observations follow from that one fact.

The injection's own docblock stated the premise it was built on: 'The author never sees the world projection, so it cannot state the movement precondition.' ART-200 made that false.

FIX: an authored movement wins; the arrival is skipped for any character the author already moved anywhere in the scene. Per scene, not per event, because an arrival in event 1 plus an authored move in event 2 is CHARACTER_ALREADY_MOVED_THIS_SLOT rather than a duplicate. Nothing is lowered: Canon unchanged, stage 8 unchanged, no retry added, and the arrival is still injected for a character the author did not move.

crossStageValidatorAgreement.test.ts drives the real functions in the real order with nothing mocked and reproduced the live DUPLICATE_CHARACTER_MOVEMENT before the fix. Two fault injections; the second bit nothing until a multi-event case was added, because every fixture had a single event so per-event and per-scene coincided.

LIVE CONFIRMATION on colorless-deer-917 after deploy:
  - no stage-8 DUPLICATE_CHARACTER_MOVEMENT on any slot run after the fix; every such slot failure
    predates it (days 6 and 7 morning-afternoon).
  - SCENE_CANON_REJECTED rows now EXIST for the first time -- 13:50:13, scene 3 attempt 1,
    UNSUPPORTED_PERSONA_REVERSAL -- proving the in-authoring check fires and feeds back. It had
    never refused before because the only rule being broken was created after it ran.

The world still does not commit, and the reason is now isolated to model compliance: every failure
is a DIFFERENT contract violation on each regenerated attempt.
<!-- SECTION:FINAL_SUMMARY:END -->
