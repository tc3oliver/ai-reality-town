---
id: ART-198
title: >-
  Live scene authoring cannot use character_state_changed or
  character_knowledge_learned
status: Done
assignee: []
created_date: '2026-09-17 18:39'
updated_date: '2026-09-18 03:00'
labels: []
dependencies: []
priority: medium
ordinal: 195000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from ART-197, which stopped the whole-scene request asking for two stateChange variants
because it cannot give the author what Canon requires for them.

  character_state_changed        validateCanon requires fromValue to EQUAL the character's currently
                                 projected value. Under strict mode fromValue is mandatory, and the
                                 request tells the model nothing about current character state.

  character_knowledge_learned    validateCanon requires sourceEventId to appear in the event's
                                 causedByEventIds AND to be a known event. A scene author has no
                                 event ids; the worked example carries causedByEventIds: [].

Both were offered by WHOLE_SCENE_JSON_SCHEMA and neither could ever be accepted, so they produced
rejections and nothing else. ART-197 removed them from what is asked for. That is honest, and it is
a real capability loss: live authoring can no longer record an emotion change or a knowledge
acquisition, and both are things the product wants.

## The fix, when it is done

The ART-157 pattern. `WholeScenePromptContext` already carries `legalDestinationIds`, derived per
scene from the stage-1 snapshot and passed on `SceneAuthoringPlan`. The same route can carry the
participants' current character state.

One trap found while scoping it: `LiveCharacter.emotionalState` is
`projection.characterStates[id]?.emotion ?? 'steady'`, so it cannot distinguish "the emotion is
steady" from "no emotion is recorded". validateCanon compares against the RAW projected value, and
`equal(undefined, 'steady')` is false — so passing the defaulted value through would reintroduce
CHARACTER_STATE_PRECONDITION_FAILED for every character with no recorded emotion. The raw value has
to travel, with absent meaning "this field may not be changed for this character", exactly as an
empty legalDestinationIds means "nobody may leave".

character_knowledge_learned additionally needs a real causal event id, which is a larger question:
the author would have to be told which accepted events it may cite.

## Evidence this is worth doing

Not yet measured. Before doing it, check what the live world actually produces without these two
variants -- if scenes are rich enough, this is lower priority than it looks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The scene author is given the participants' raw projected state for the fields it may change
- [x] #2 An absent recorded value means that field may not be changed, rather than being defaulted
- [x] #3 A test proves a character with no recorded emotion is not offered an emotion change
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

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in #314. LiveCharacter carries recordedState beside emotionalState: the latter is '?? steady' and right for the Director, and unusable for an author because validateCanon compares fromValue against the RAW value and equal(undefined, 'steady') is false. The rule is now a whitelist quoting the legal fromValue per character and field; anything unrecorded stays prohibited by name. Restricted to the narrative-text fields; non-string values omitted rather than coerced. character_knowledge_learned stays forbidden for a sharper reason -- ART-203 removed causedByEventIds, so there is no event id to cite. Four fault injections; one exposed that the field filter had no test of its own.
<!-- SECTION:FINAL_SUMMARY:END -->
