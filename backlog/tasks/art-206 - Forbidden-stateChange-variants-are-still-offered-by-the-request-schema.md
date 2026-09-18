---
id: ART-206
title: Forbidden stateChange variants are still offered by the request schema
status: Done
assignee:
  - '@claude'
created_date: '2026-09-18 00:56'
updated_date: '2026-09-18 03:00'
labels: []
dependencies: []
priority: high
ordinal: 203000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From a live slot on colorless-deer-917 after ART-198/202/205 deployed. The ART-195 detail named it
exactly:

  mistwood day 6 evening
  [SCENE_SIMULATION_FAILED] whole-scene provider failed:
  [INVALID_EVENT_SHAPE] CanonError at output_validation (retryable):
  [INVALID_EVENT_SHAPE] sourceEventId has invalid reference format

The model emitted a character_knowledge_learned with a malformed sourceEventId. ART-197 and ART-198
tell it never to emit that variant -- and WHOLE_SCENE_JSON_SCHEMA still lists it among
stateChangeVariants, so the request is simultaneously offering the variant and forbidding it.

ART-203 already established the resolution for exactly this shape: a field the author cannot fill
correctly should not be one the model is invited to fill. Prose is weaker than structure, and the
same is true one level up -- a variant the request cannot support should not be in the schema the
request sends.

## Variants to remove

  character_knowledge_learned    needs a sourceEventId in causedByEventIds; ART-203 removed
                                 causedByEventIds from the request entirely, so this is
                                 structurally impossible from here
  item_transferred               needs an item id and its unique current owner
  location_state_changed         needs a location's full current properties
  organization_state_changed     needs an organization id and its current state

## Explicitly NOT removed

character_state_changed stays: ART-198 supplies the recorded values, so it is now usable for the
characters and fields the scene names. Removing it would undo that.

## Not in scope

Do NOT relax Canon, the parser or any validator. This narrows what is ASKED for, which lowers no
threshold.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The request schema offers no stateChange variant the request cannot supply the context for
- [x] #2 character_state_changed remains offered, because ART-198 supplies what it needs
- [x] #3 A test asserts the removed variants are absent from the serialized schema the model reads
- [x] #4 The prose prohibition and the schema agree, rather than contradicting each other
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
Shipped in #315. A live slot died on a character_knowledge_learned with an invented sourceEventId: the prompt forbade the variant and the schema went on offering it. Removed the four variants the request cannot supply context for; character_state_changed stays because ART-198 supplies what it needs. The ART-141 test asserting the schema describes EVERY canon variant is updated rather than deleted and says why -- invention is still impossible because an omitted variant is schema-invalid under additionalProperties: false, which is stronger than the prose it replaces. The expectation is derived from STATE_CHANGE_TYPES minus an explicit exclusion list, so a new canon variant is offered by default.
<!-- SECTION:FINAL_SUMMARY:END -->
