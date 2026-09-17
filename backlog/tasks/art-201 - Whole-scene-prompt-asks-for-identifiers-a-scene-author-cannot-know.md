---
id: ART-201
title: Whole-scene prompt asks for identifiers a scene author cannot know
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 19:49'
updated_date: '2026-09-17 19:50'
labels: []
dependencies: []
priority: high
ordinal: 198000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fifth stop of the same class, from the live slot after ART-200. Three scenes authored, then:

  slot          mistwood day 5 afternoon
  failureStage  validate_canon
  errorCode     UNKNOWN_EVENT_REFERENCE
  message       causal event does not exist

The model put an invented event id in causedByEventIds. `validateCanon` checks every entry against
the world's known event ids, and a scene author is given none -- the worked example carries an
empty array but nothing says it must stay empty.

## The general shape, stated once

Four previous tasks each fixed one instance of the same thing, one live slot at a time. The
remaining instances are all the same question: which identifier fields does the request ask for that
the author has no way to fill correctly?

  causedByEventIds     checked against known event ids; the author has none        -> must be []
  locationId           checked for existence; the author knows the scene's         -> must be the scene's
  fact_created         character/location/item subjects are checked for existence  -> participants, scene
                       and a `world` subject must equal the event worldId             location, or the worldId
  rumor claim subject  the same existence checks as fact_created                   -> same rule
  item_transferred     needs a real item id AND its unique current owner           -> not emittable

Stated in one pass. Each round trip costs a deploy and a full CI cycle, and every one of these
refuses the entire scene.

## Not in scope

Do NOT relax Canon, the parser or the schema. Supplying real causal event ids and item ownership so
those fields become usable is separate work, and is the same question ART-198 records for character
state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every identifier field the author cannot fill correctly is either constrained to values it has, or forbidden
- [ ] #2 causedByEventIds is required to be empty, with the reason stated
- [ ] #3 fact_created and rumor claim subjects are constrained to the scene's own entities
- [ ] #4 A test asserts the prompt constrains each field and that validateCanon refuses the unconstrained form
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
One paragraph covering every identifier the author cannot know, with the scene's literal values inlined as ART-157 and ART-199 do. Tests pair each rule with the validator that enforces it, so prompt text and canon rule cannot drift.
<!-- SECTION:PLAN:END -->
