---
id: ART-205
title: >-
  A scene that parses but violates Canon is persisted, so its slot can never
  recover
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 21:07'
updated_date: '2026-09-18 00:06'
labels: []
dependencies: []
priority: high
ordinal: 202000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Structural finding from driving nine live slots on colorless-deer-917 (acceptance) while fixing
ART-196 through ART-204. This is the reason the remaining failures do not heal on retry, and it is
a different kind of defect from the six prompt-contract ones.

## The three facts

1. The whole-scene retry loop in `simulateWholeScene` sees only PARSER rejections. It wraps the
   provider call and `parseWholeSceneOutput`; a scene that parses is returned.
2. Canon validation runs later and elsewhere -- `validate_canon` is stage 8, inside the finishing
   mutation `runQueuedWorldDaySlot`, after the authoring action has returned.
3. `authorSlotScenes` persists every scene that parsed, and on any later pass
   `loadPersistedSceneSimulation` returns it and authoring is skipped (ART-149 reuse).

Together: a scene whose proposals parse but violate Canon is stored, and every retry of that slot
replays the identical stored scene into the identical refusal. The slot cannot recover, no matter
how many attempts it is given, and no provider call is made to try anything different.

## Observed

  mistwood day 5 morning  attemptCount 4  PRIVATE_RELATIONSHIP_DISCLOSURE  -- parked failed
  mistwood day 6 morning  DUPLICATE_CHARACTER_MOVEMENT
  mistwood day 6 noon     DUPLICATE_CHARACTER_MOVEMENT
  mistwood day 6 afternoon DUPLICATE_CHARACTER_MOVEMENT, AFTER ART-204 stated the rule

The last one matters: ART-204 told the model the rule, the model broke it anyway, and nothing in the
system can respond to that. Every prompt fix so far raised the chance a scene is born valid; none of
them can rescue one that is not.

## Why the retry budget does not help

`semanticMaxAttempts` bounds attempts INSIDE `simulateWholeScene`, which never learns that Canon
refused anything. The slot-level attemptCount does grow, but each attempt reuses the stored scene.
So the retry budget is spent on a decision that was already made.

## What a fix would have to decide

Two questions, and both are product decisions rather than obvious repairs:

  - Should a canon-refused scene be DISCARDED so the slot can re-author? That spends allowance
    again and abandons work the model already did, and it needs a bound so a permanently
    unsatisfiable scene cannot loop.
  - Should the refusal be fed BACK to the author as context for a second attempt? That is the
    higher-value answer -- it is the only path that can fix a scene rather than reroll it -- but it
    means canon validation has to reach the authoring side, which currently sits on the far side of
    the action/mutation split for good reasons.

Do not guess between them. Both change how much a world day costs and how a failed slot behaves.

## Related

ART-202 is a separate and more urgent blocker: the post-commit cursor is ahead of Canon, so even a
committed slot produces no public read model.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A slot whose stored scene Canon refuses can make progress rather than replaying the same refusal
- [ ] #2 The chosen approach is recorded with its cost, since both candidates spend provider allowance
- [ ] #3 A test drives a canon-invalid scene through a slot retry and asserts the second attempt differs from the first
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
