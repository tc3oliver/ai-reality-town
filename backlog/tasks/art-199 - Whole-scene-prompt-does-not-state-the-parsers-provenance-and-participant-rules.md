---
id: ART-199
title: >-
  Whole-scene prompt does not state the parser's provenance and participant
  rules
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 19:01'
updated_date: '2026-09-17 21:08'
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
- [x] #1 The prompt states the provenance triple and requires it copied verbatim
- [x] #2 The prompt states that every characterId in every collection must be a scene participant
- [x] #3 The prompt states the uniqueness rules the parser enforces
- [x] #4 A test drives a model-shaped output violating each stated rule and asserts the parser refuses it
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: npm run check exit 0, 4809 tests (baseline 4800 + 9).
Fault injection: drop the parser-rules paragraph -> 7 named tests failed; baseline 26/26 restored.
Each case asserts both halves, so a prompt sentence with no parser behind it and a parser rule the
prompt does not state are both test failures.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in #308. parseWholeSceneOutput requires every proposed event to copy the scene's worldId, worldDay and timeSlot verbatim and to name only its participants; nothing said so. Every parser rule that refuses a whole scene is now stated in one pass, with the scene's values inlined. Each test asserts the rule twice -- that the parser refuses the violation and that the prompt states it -- so the two cannot drift. Verified: npm run check exit 0; one fault injection failing 7 named tests.
<!-- SECTION:FINAL_SUMMARY:END -->
