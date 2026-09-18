---
id: ART-202
title: >-
  Post-commit cursor is ahead of Canon, so every event since #74 was silently
  skipped
status: Done
assignee: []
created_date: '2026-09-17 20:17'
updated_date: '2026-09-18 03:00'
labels: []
dependencies: []
priority: critical
ordinal: 199000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while verifying ART-185 on colorless-deer-917 (Public Acceptance / Staging) on 2026-09-17,
immediately after the first successful live slot in this repository's history.

## Evidence

The live slot committed six accepted events, mistwood#event#83 .. #88, and reported
status: completed. Then:

  npx convex run operations/postCommitLiveFunctions:drainLivePostCommit '{"worldId":"mistwood"}'
  -> []                       (twice, minutes apart)

  inspectPostCommitRun postcommit:mistwood:74  -> completed, all six checkpoints completed
  inspectPostCommitRun postcommit:mistwood:75  -> run: null
  inspectPostCommitRun postcommit:mistwood:82  -> run: null
  inspectPostCommitRun postcommit:mistwood:83  -> run: null
  inspectPostCommitRun postcommit:mistwood:88  -> run: null

  listReadModelVersions liveState live:mistwood
  -> 19 versions; v19 is current, published 2026-08-04, built from mistwood#event#74

So no post-commit run exists for any event after #74, and none has ever run.

## Why that means the cursor is ahead

`drainPostCommitBacklog` reads canonEvents with sequenceNumber > cursor and returns an outcome for
every candidate that is not settled. A run row is "settled" only when its status is completed.
Since no run rows exist above #74, events 75..88 cannot be settled -- so the only way the function
returns [] is that its candidate page is EMPTY, which means
`postCommitCursors.settledThroughSequenceNumber` for mistwood is at or above 88.

Everything Canon has accepted since #74 has therefore been skipped as already settled, without ever
being processed and without anything recording that it was skipped.

## Impact

Stages 11-21 have not run for 14 accepted events: no projections, no knowledge, no memory, no arcs,
no episodes, no recaps, no safety gate, no editorial publication and no public read-model rebuild.
`rebuildLiveProjection` invoked DIRECTLY published liveState v20 immediately, with `dynamic` present
and 12 characters -- so the projection code is healthy and the pipeline simply never called it.

This is the actual blocker behind ART-185: the stale liveState was not a projection defect, it was
a cursor that had moved past the events that would have refreshed it.

## Not yet established

HOW the cursor got ahead. `drainPostCommitBacklog` is the only writer and it advances only over
settled events, so it cannot have done this by itself. Candidates worth checking, in order:

  - a rollback or recovery operation that removed postCommitRuns rows while leaving the cursor;
    `canonRecoveryHeads` exists in this deployment and inspectEmergencyStop reports snapshots;
  - a direct cursor write from an operator tool or a migration;
  - an earlier code version whose advance rule differed.

Do NOT reset the cursor on the acceptance deployment before the cause is known -- re-running
post-commit over 14 events is safe by idempotency, but a cursor that can silently overshoot will do
it again, and the reset would destroy the evidence.

## The gate that should have caught it

Nothing reports "the cursor is ahead of the newest completed run". That invariant is cheap to
check and is the one thing that would have made this visible on the day it happened rather than six
weeks later.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The cause of the overshoot is established from evidence, not inferred
- [x] #2 A cursor that is ahead of the newest completed post-commit run is detected and reported
- [x] #3 The 14 skipped events are processed, or a decision not to is recorded with its reasoning
- [x] #4 A test proves the cursor cannot advance past an event with no completed run
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CORRECTION: the original diagnosis in this task was WRONG. There was no cursor overshoot.

Established 2026-09-17 by running drainLivePostCommit repeatedly on colorless-deer-917:

  call 1 -> []            call 5 -> 78,79,80 completed
  call 2 -> []            call 6 -> 81,82,83 completed
  call 3 -> []            call 7 -> 84,85,86 completed
  call 4 -> 75,76,77      call 8 -> 87,88    completed
                          call 9 -> []  (genuinely caught up)

All 14 events post-committed with status completed, and liveState advanced 19 -> 30 with dynamic
present. The cursor invariant is correctly implemented and never crossed a hole.

## What was actually happening

drainPostCommitBacklog reads ONE bounded page: page = DEFAULT_MAX_POST_COMMIT_EVENTS (3) +
POST_COMMIT_CURSOR_CATCHUP (32) = 35. A call whose whole page is already settled advances the
cursor by 35 and returns [] without doing any work. Starting from an absent cursor row (-1) it took
three such calls to walk the settled prefix of events 0..74 before the fourth reached event 75.

I called it twice, got [] twice, and concluded the cursor was ahead of Canon. It was behind.

## The real defects

1. drainLivePostCommit returns [] for two states that need opposite responses: 'caught up, nothing
   to do' and 'the cursor advanced, call me again'. Nothing distinguishes them. That ambiguity is
   what produced a wrong CRITICAL diagnosis, and it is the defect to fix.

2. The six-week stall has a different cause entirely: drivableWorldIds filters
   mode === 'public' && status === 'running'. The mistwood schedule row is mode: 'development', so
   BOTH crons -- driveLiveWorlds and drainAllLivePostCommit -- have always skipped this world. A
   non-public world accumulates an unbounded post-commit backlog and nothing reports it.

3. Nothing reports post-commit backlog or holes at all. No query answers 'which accepted events
   have no completed run'.

Re-scoped accordingly: pin the invariant that was already correct, fix the ambiguity, make the
backlog observable, and provide the dry-run + reconciliation surface.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in #314. THE ORIGINAL DIAGNOSIS IN THIS TASK WAS WRONG and is corrected in its notes: there was no cursor overshoot. The drain reads one bounded page of 35, so a call whose page is entirely settled advances the cursor and returns [] without doing work; from an absent cursor row it took three such calls to cross events 0-74. I called it twice, got [] twice, and filed a CRITICAL defect. The cursor was three pages BEHIND and the invariant it was accused of breaking was correctly implemented and already tested. All 14 events then processed cleanly and liveState went v19 -> v30. The real defects fixed: the empty-result ambiguity (now cursorBefore/cursorAfter/caughtUp/remaining, with caughtUp requiring a SHORT page), no visibility into backlog or holes (inspectPostCommitBacklog, including cronWillNeverDrain), and no reconciliation path (reconcilePostCommit: Canon untouched, per-event skip so a second run is a no-op by construction, dry-run by default). Verified on acceptance: cursor 88 = advanceTo, 89 complete, 0 missing, reconciliation run twice with repaired: [] both times. Also established the actual six-week cause: drivableWorldIds selects mode 'public', and mistwood is 'development', so both crons have always skipped it.
<!-- SECTION:FINAL_SUMMARY:END -->
