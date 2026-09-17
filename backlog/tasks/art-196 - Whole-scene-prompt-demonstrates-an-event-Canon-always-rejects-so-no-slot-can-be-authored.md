---
id: ART-196
title: >-
  Whole-scene prompt demonstrates an event Canon always rejects, so no slot can
  be authored
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 18:06'
updated_date: '2026-09-17 18:12'
labels: []
dependencies: []
priority: high
ordinal: 193000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Established from a live slot on colorless-deer-917 (Public Acceptance / Staging) on 2026-09-17, using the ART-195 failure detail:

  code: INVALID_EVENT_SHAPE
  errorName: CanonError
  message: stateChanges must not be empty
  stage: output_validation
  slot: mistwood day 5 morning, scene grouping:mistwood:5:morning:scene:2

## The cause

`validateEventStructure` (convex/canon/validators.ts:481) requires every Proposed Event to carry at
least one state change. The whole-scene request never asks for one:

1. `wholeSceneSystemPrompt` builds a worked example and, when the scene's location has NO legal
   destination, sets `stateChanges: []` on it -- then tells the model "A well-formed item for this
   scene looks like: <that>". The one example the model is given is an event Canon rejects
   unconditionally.
2. `WHOLE_SCENE_JSON_SCHEMA`'s `stateChanges` is `{ type: 'array', items: { anyOf: [...] } }` with no
   `minItems`, so the schema does not state the rule either.
3. No sentence of the prompt states it in prose.

ART-157 made the example stop demonstrating a movement that could not be accepted, because the
prompt named no legal destination. That was right. Emptying `stateChanges` to achieve it replaced an
illegal movement with an illegal EVENT, and nothing caught it because the deterministic author knows
the canon rules independently of the prompt -- the same blind spot ART-157 itself recorded.

## The second, smaller defect

A refusal raised as a CanonError is NOT retried, while a refusal raised as a SceneSimulationError
is. Both mean "the provider answered and the answer was refused", both are counted as
`output_rejected` against §16.2's structured-output rate, and a second sample of a stochastic model
can fix either. The retry path and the metric currently disagree about what the same event is.

## Not in scope

Do NOT relax the Canon rule, the JSON schema or any validation threshold. The model is being asked
for something invalid; the fix is to ask correctly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The prompt never demonstrates an event Canon would reject
- [ ] #2 The request states the non-empty stateChanges rule in both the JSON schema and prose
- [ ] #3 A scene whose location has no legal destination still gets a worked example that Canon accepts
- [ ] #4 A refused ANSWER is retried consistently, whichever error class raised the refusal
- [ ] #5 A test drives the real prompt for a no-destination scene and asserts its example validates against Canon
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
1. wholeSceneSystemPrompt: the no-destination branch demonstrates a character_state_changed on emotion instead of an empty stateChanges array. That change is legal in EVERY scene -- it needs no destination, no second character and no prior canon -- so the example is always one Canon accepts.
2. WHOLE_SCENE_JSON_SCHEMA: stateChanges gains minItems: 1, so the contract states the rule structurally and travels with the serialized schema already embedded in the prompt.
3. One prose sentence stating the rule, beside the one that already explains what a proposedEvents item is.
4. describeFailure: a CanonError raised while parsing model output is retryable, matching SCENE_OUTPUT_*. Both are 'the provider answered and the answer was refused' and both already count as output_rejected against §16.2.
5. Tests: drive the REAL prompt for a no-destination scene, extract its example, and put it through validateEventStructure -- the check that actually refused the live slot. Assert minItems travels in the serialized schema. Assert the retry loop makes a second call for a CanonError.
6. Fault injection: restore the empty array and watch the named test fail.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause established from a real live slot on colorless-deer-917 (acceptance), 2026-09-17, using the ART-195 failure detail:

  code INVALID_EVENT_SHAPE / CanonError / output_validation / 'stateChanges must not be empty'
  slot mistwood day 5 morning, scene grouping:mistwood:5:morning:scene:2

The no-destination worked example was invalid in TWO ways, not one: empty stateChanges AND
eventType 'interaction', which is not in EVENT_TYPES. Only the movement branch had ever been
put through Canon by anything.

Two further defects found while fixing it, both pre-existing:
- a CanonError refusal was not retried while a SceneSimulationError refusal was;
- a canon refusal was reported twice, so Sec 16.2's provider-failure dimension has been counting
  model-output refusals as outages.

Verification: npm run check exit 0, 276 suites, 4792 tests (baseline 4773 + 19).
Five fault injections, each failing the named test it should, baseline restored after each:
  1 restore stateChanges: []          -> 2 failed
  2 restore eventType 'interaction'   -> 3 failed
  3 drop minItems from the schema     -> 2 failed
  4 stop retrying a canon refusal     -> 2 failed
  5 restore the class-based guard     -> 2 failed
<!-- SECTION:NOTES:END -->
