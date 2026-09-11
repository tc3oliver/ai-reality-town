---
id: ART-181
title: A rules-only slot leaves the prior attempt's failed world-day run standing
status: To Do
assignee: []
created_date: '2026-09-11 19:30'
labels: []
dependencies: []
type: bug
ordinal: 179000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the FR-M004 ladder has dropped to rung 4 or 5, `prepareQueuedWorldDaySlot` routes the slot to `runRulesOnlySlot` (`convex/simulation/worldDayLiveFunctions.ts:495`) instead of `executeSlot`. That is correct — a rules-only slot has nothing to author, and routing it through the action would put an empty network call between the same two mutations.

What it also does is skip the **run store** entirely. `executeSlot` passes `createConvexWorldDayRunStore(ctx.db, now)` to `executeWorldDay`, which creates and settles a `worldDayRuns` row keyed on `worldDayRunId(slot)`. `runRulesOnlySlot` writes `scheduledSlots` (via `completeScheduledSlotRef` / `failScheduledSlotRef`) and nothing else.

The run id is derived from the slot identity, so a retry reuses it — and the sequence that produces the inconsistency is the ladder’s own designed recovery, not an exotic one:

1. A slot is authored and fails; `failRun` leaves `worldDayRuns` at `status: "failed"` with the provider’s `failureStage` / `errorCode` / `errorMessage`.
2. `FAILURES_BEFORE_ESCALATION` is reached and `advanceDegradation` moves the world to `rules_only`.
3. The slot is retried. `policy.rulesOnly` is now true, so `runRulesOnlySlot` runs, commits its deterministic events and completes the slot.
4. `scheduledSlots` says `completed`. `worldDayRuns` still says `failed`, with a provider error code, for the same (world, day, slot).

This is the same symptom ART-150 fixed for the authored path — a successful run carrying a prior attempt’s failure — and ART-150’s fix cannot reach it, because that fix made the run-store CONTRACT clear the failure fields on completion and this path never calls the store at all.

Readers of the stale row: `inspectRun` (`worldDayOrchestrationFunctions.ts`), the proposal-review surface (`proposalReviewStore.ts:168`, which maps `worldDayRuns.errorCode` + `failureStage` to a rejection reason), and `runsForSlot` in the operations console.

**Not affected, checked rather than assumed:** `cancelUncommittedScene` cannot be tricked into cancelling committed Canon by this. `decideSlotCancellation` refuses on `slot.committedEventId` and on `slot.status === "completed"` before it ever looks at the runs, and `runRulesOnlySlot` sets both.

Scope: settle the EXISTING run record when a rules-only slot finishes. Do not create one where none exists — a `worldDayRuns` row means a world-day run executed the ten-stage pipeline, and minting one for a rules-only slot would be a new false claim in place of a stale one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A slot that fails while authoring and then succeeds at rung 4 or 5 leaves no run record claiming the slot failed
- [ ] #2 The prior attempt's failure stays visible as attempt history rather than being erased, exactly as ART-150 requires of the authored path
- [ ] #3 A rules-only slot in a world that never authored one creates no world-day run record
- [ ] #4 A rules-only slot that itself fails records that failure rather than leaving a stale success
- [ ] #5 A fault injection proves it: removing the run-store settlement turns a named test red
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
