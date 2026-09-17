---
id: ART-197
title: Whole-scene prompt does not state the Canon rules a scene author can break
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 18:37'
updated_date: '2026-09-17 18:37'
labels: []
dependencies: []
priority: high
ordinal: 194000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second failure of the same class as ART-196, found by the next live slot on colorless-deer-917
(acceptance) once authoring started working. Three scenes were authored -- up from zero -- and the
slot then failed one stage later:

  failureStage: validate_canon
  errorCode:    PRIVATE_RELATIONSHIP_DISCLOSURE
  message:      a private relationship change cannot carry a public summary

## The shape of the defect

`strictObject` derives `required` from `properties`, so under strict mode EVERY property of every
node is mandatory. That has two consequences the prompt never mentions:

1. Every proposedEvents item MUST carry a `publicSummary`. `validateCanon` refuses a
   `relationship_changed` whose `visibility` is `private` on an event that has one -- and `private`
   is one of the two enum values the schema offers. So the request offers a combination Canon
   rejects unconditionally, exactly as ART-196's worked example did.
2. `character_state_changed` MUST carry a `fromValue`, and `validateCanon` requires it to equal the
   character's currently projected value. The request tells the model nothing about current
   character state, so that variant cannot be used correctly by any author.
   `character_knowledge_learned` MUST carry a `sourceEventId` that appears in the event's
   `causedByEventIds`, and a scene author has no event ids at all.

The prompt states the movement rule (ART-157), the rumor chain rules (FR-E005) and the non-empty
stateChanges rule (ART-196). It states none of the rest.

## Also: ART-196 chose the riskier example

ART-196's no-destination worked example used `character_state_changed` on `emotion`. That is legal
STRUCTURALLY -- which is all `validateEventStructure` checks, and all its test checked -- but
`validateCanon` requires `fromValue` to match the projection, so the example would have been
refused in every scene where the character's emotion was not the literal in the example.
`character_memory_formed` has only two canon rules, both about the character being a scene
participant, so it is safe in every scene.

## Not in scope

Do NOT relax Canon, the JSON schema or any validation threshold. Supplying current character state
so `character_state_changed` becomes usable again is real work and is its own task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The prompt states every Canon rule a scene author can break with the fields the schema offers
- [ ] #2 The request stops asking for stateChange variants it cannot supply the context for
- [ ] #3 The worked example is legal under validateCanon, not only under validateEventStructure
- [ ] #4 A test drives the real prompt example through validateCanon against a seeded world projection
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
1. Worked example -> character_memory_formed: two canon rules, both satisfied by naming a scene participant, so it is legal in every scene. Corrects ART-196's character_state_changed choice.
2. Prompt states the reachable rules in prose: relationship visibility must be public because every event carries a publicSummary; every characterId in a stateChange must be a scene participant; relationship endpoints must differ and at least one delta must be non-zero; character_state_changed and character_knowledge_learned must not be emitted, because this request cannot give the author the current state or the causal event ids those two need.
3. The test drives the real prompt example through validateCanon with a seeded projection, not only validateEventStructure -- that gap is what let ART-196 ship the riskier example.
4. Follow-up task for supplying character state so character_state_changed becomes usable again.
<!-- SECTION:PLAN:END -->
