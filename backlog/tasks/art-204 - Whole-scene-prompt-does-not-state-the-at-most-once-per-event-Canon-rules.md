---
id: ART-204
title: Whole-scene prompt does not state the at-most-once-per-event Canon rules
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 20:43'
updated_date: '2026-09-17 21:08'
labels: []
dependencies: []
priority: high
ordinal: 201000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sixth stop of the same class, on fresh day-6 slots after ART-203 removed causedByEventIds from the
request. UNKNOWN_EVENT_REFERENCE is gone; two consecutive slots now fail with:

  mistwood day 6 morning -- DUPLICATE_CHARACTER_MOVEMENT at validate_canon
  mistwood day 6 noon    -- DUPLICATE_CHARACTER_MOVEMENT at validate_canon
  'a character may move at most once per event'

validateCanon enforces a family of at-most-once-per-event rules and the prompt states none of them.
The reachable ones, given the stateChange variants the request still offers:

  DUPLICATE_CHARACTER_MOVEMENT       one character_location_changed per character per event
  CHARACTER_ALREADY_MOVED_THIS_SLOT  and at most one movement per character across the whole slot
  INVALID_LIFE_STATE_CHANGE          one character_life_changed per character per event
  INVALID_RUMOR_CHANGE               one rumor_belief_changed per character per rumor per event,
                                     and one rumor_corrected per rumor per event

The fact-versioning rule (one event may not version the same fact twice) was already stated by
ART-201; this is the rest of the family.

The slot rule is worth stating separately from the event rule: a character may appear in only one
scene per slot, but a scene may propose several events, and a second movement in a later event of
the same slot is refused by a different code.

## Not in scope

Do NOT relax Canon. The model is proposing something invalid; the request should say so.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every at-most-once-per-event rule a scene author can break is stated
- [x] #2 The per-slot movement rule is stated as well as the per-event one
- [x] #3 A test pairs each stated rule with the validator that enforces it
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
Shipped in #312. validateCanon enforces a family of at-most-once-per-event rules and the prompt stated none. The per-slot movement rule is stated separately from the per-event one because they are different refusals with different codes. Verified: npm run check exit 0; one fault injection failing 2 named tests, with a single-movement negative control. Live result: the model still broke the rule on a later slot, which is ART-205 rather than a prompt gap.
<!-- SECTION:FINAL_SUMMARY:END -->
