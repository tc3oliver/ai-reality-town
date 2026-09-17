---
id: ART-199
title: >-
  Whole-scene prompt does not state the parser's provenance and participant
  rules
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 19:01'
updated_date: '2026-09-17 19:01'
labels: []
dependencies: []
priority: high
ordinal: 196000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Third failure of the same class as ART-196 and ART-197, from the next live slot on
colorless-deer-917 (acceptance):

  slot          mistwood day 5 noon
  code          SCENE_OUTPUT_PROVENANCE_MISMATCH
  stage         output_validation
  message       Proposed Event must remain within the Scene world, slot, and participants

`parseWholeSceneOutput` requires every proposedEvents item to carry the scene's own worldId,
worldDay and timeSlot verbatim, and its participantIds to be a subset of the scene's. The scene
payload carries all four values and the worked example uses them, but the prompt never says they
must be copied -- so a model that names a character who was merely mentioned, or writes the slot it
thinks the scene is in, loses the whole scene. It is retried twice and then the slot fails.

The same is true of several other parser rules that refuse the whole scene and are stated nowhere:
every characterId in keyActions, dialogueHighlights, relationshipChanges, knowledgeChanges, memories
and rumors must be a scene participant; idempotencyKeys must be unique within the scene;
continuityWarnings must not repeat.

ART-197 stated the participants rule for stateChanges only. The event's OWN participantIds field is
a different field and was not covered.

## Approach

State all of them in one pass rather than discovering them one live slot at a time. Each round trip
costs a deploy and a CI cycle, and every one of these rules refuses the entire scene.

## Not in scope

Do NOT relax the parser, the schema or Canon.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The prompt states the provenance triple and requires it copied verbatim
- [ ] #2 The prompt states that every characterId in every collection must be a scene participant
- [ ] #3 The prompt states the uniqueness rules the parser enforces
- [ ] #4 A test drives a model-shaped output violating each stated rule and asserts the parser refuses it
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
One paragraph in wholeSceneSystemPrompt stating every parseWholeSceneOutput rule a model can break, with the scene's literal values inlined the way ART-157 inlined legal destinations. Tests drive parseWholeSceneOutput with a model-shaped output breaking each rule, so the prompt text and the parser cannot drift: a rule the prompt states must be a rule the parser enforces, and the test fails if either side moves.
<!-- SECTION:PLAN:END -->
