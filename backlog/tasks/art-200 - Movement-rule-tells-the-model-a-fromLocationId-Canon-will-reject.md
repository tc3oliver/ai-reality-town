---
id: ART-200
title: Movement rule tells the model a fromLocationId Canon will reject
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 19:25'
updated_date: '2026-09-17 19:29'
labels: []
dependencies: []
priority: high
ordinal: 197000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fourth stop of the same class, from the live slot after ART-199. Three scenes authored, then:

  slot          mistwood day 5 noon
  failureStage  validate_canon
  errorCode     LOCATION_PRECONDITION_FAILED
  message       movement fromLocationId does not match current location

## The cause

ART-157's movement rule ends: "fromLocationId must be <scene.locationId>". That is only true when
every participant is actually projected AT the scene's location. A scene groups characters by
INTENT; Canon tracks where each character actually is, and nothing guarantees the two agree. For a
participant projected elsewhere, the prompt is instructing the model to write a value
`validateCanon` refuses.

The scene-level `legalDestinationIds` has the same problem one step further on: it is computed from
`scene.locationId`, so for a participant standing somewhere else the destinations offered are not
connected to where they are, and TELEPORTATION_NOT_ALLOWED would refuse the move even with a
corrected fromLocationId.

## The fix

The ART-157 pattern, per character instead of per scene. Each participant gets their OWN projected
location and the destinations legal FROM it. That is not a refinement -- it is what makes the rule
true -- and it settles four canon rules at once:

  LOCATION_PRECONDITION_FAILED     fromLocationId equals the projection
  TELEPORTATION_NOT_ALLOWED        destinations are the origin's own connections
  UNKNOWN_LOCATION_REFERENCE       inactive and over-capacity destinations are filtered
  LOCATION_PRECONDITION_FAILED     the origin is excluded, so a move always changes location

`legalDestinationsFrom` already computes exactly this from any origin; it was only ever called with
the scene's location.

## Not in scope

Do NOT relax Canon or the schema. Do NOT move characters to make the scene's assumption true -- the
scene author proposes, Canon decides.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each participant is told their own projected location as the only legal fromLocationId
- [ ] #2 Destinations are computed from each participant's own location, not the scene's
- [ ] #3 A participant with no legal destination is told they may not move
- [ ] #4 The worked example demonstrates a movement only for a character who can actually make it
- [ ] #5 A test builds a scene whose participant stands elsewhere and asserts the prompt does not instruct an illegal move
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
1. worldDayLive.ts: ParticipantMovement { fromLocationId, destinations } and participantMovementFor(snapshot, scene), reusing legalDestinationsFrom with each character's own origin.
2. SceneAuthoringPlan gains participantMovement, keyed sceneId -> characterId; buildSceneAuthoringPlan fills it from the same stage-1 snapshot the Director planned against; authorSlotScenes passes the scene's map.
3. WholeSceneSimulationOptions and WholeScenePromptContext gain participantMovement. When present it is authoritative; when absent the ART-157 scene-level legalDestinationIds still applies, which is how every pure test calls it.
4. The movement rule becomes per character, naming each participant's own origin and destinations, and says plainly when a character may not move at all.
5. The worked example demonstrates a movement only for a participant who actually has a destination, and otherwise falls back to the ART-197 memory example.
6. Tests: a scene whose participant is projected somewhere other than the scene location must not be told to write the scene location as fromLocationId; the example must pass validateCanon against a projection where that is true.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: npm run check exit 0, 4818 tests (baseline 4809 + 9).
Three fault injections, each failing the named test it should; 35/35 restored after each:
  1 ignore per-participant movement          -> 3 failed
  2 example origin back to the scene location -> 1 failed
  3 destinations computed from the scene      -> 1 failed
<!-- SECTION:NOTES:END -->
