---
id: ART-157
title: >-
  Whole-scene prompt never names a legal destination, so every movement proposal
  is rejected
status: To Do
assignee: []
created_date: '2026-09-06 06:47'
labels:
  - bug
  - prd-1.0
dependencies: []
priority: critical
ordinal: 157000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verified live on the dev deployment 2026-09-06. runQueuedWorldDaySlot on mistwood day 4 noon returned status: failed, failureStage: validate_canon, errorCode: UNKNOWN_LOCATION_REFERENCE ('destination location does not exist'), committedEventIds: [].

Root cause, read off the code rather than inferred:

- The scene payload sent to the model is JSON.stringify(scene) where scene: GroupedScene (sceneSimulation.ts:391). GroupedScene (sceneGrouping.ts:16-30) carries the scene's OWN locationId and nothing else about the map — no other location ids, no connections, no occupancy, no capacity.
- wholeSceneSystemPrompt (sceneSimulation.ts:242-259) asks for character_location_changed and shows an example whose destination is the literal placeholder 'destination-location-id' (:250).
- So the model is asked for a destination, shown a placeholder, and given no legal value to choose. Canon then correctly refuses it at validators.ts:537.

The provider is not at fault and neither is the validator: probeConfiguredOpenAICompatibleProvider reports chat and embedding both compatible. LLM providers may only propose, and the append-only guarantee held — zero canon was written. The defect is that the proposal can never be valid.

Why the existing suites are all green: the fake provider knows the world, so it proposes real location ids. Nothing exercises 'a provider that only knows what the prompt told it'.

Note for whoever picks this up: validators.ts rejects a movement on four separate grounds — unknown (:530), non-existent (:537), INACTIVE (:540) and capacity exceeded (:593). Supplying bare location ids fixes only the first two; the set the prompt offers has to be filtered to active locations with capacity headroom, or the world will simply fail later on the other two.

Cost evidence captured in the same run (feeds ART-100): that single FAILED slot, committing nothing, read 1369 documents / 3105906 bytes — about 3.0 MiB of the 16 MiB transaction budget at only 78 accepted events.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A scene prompt carries the legal destination set (existing, active, with capacity headroom) for the scene's location, derived from the world projection rather than from the model's imagination
- [ ] #2 Running one real world-day slot against the configured provider commits at least one accepted event instead of failing at validate_canon with UNKNOWN_LOCATION_REFERENCE
- [ ] #3 A regression test drives the whole-scene path with a provider that only knows what the prompt told it, and asserts the slot no longer fails, so the defect cannot return silently
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
