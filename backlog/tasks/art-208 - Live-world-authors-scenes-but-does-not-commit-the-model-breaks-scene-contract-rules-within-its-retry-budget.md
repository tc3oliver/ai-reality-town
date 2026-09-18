---
id: ART-208
title: >-
  Live world authors scenes but does not commit: the model breaks scene-contract
  rules within its retry budget
status: To Do
assignee: []
created_date: '2026-09-18 03:00'
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
- [ ] #1 The disagreement between the in-authoring Canon check and stage 8 is explained from evidence
- [ ] #2 A decision is recorded on the retry budget and the route, with their allowance cost
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
