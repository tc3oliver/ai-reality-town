---
id: ART-202
title: >-
  Post-commit cursor is ahead of Canon, so every event since #74 was silently
  skipped
status: To Do
assignee: []
created_date: '2026-09-17 20:17'
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
- [ ] #1 The cause of the overshoot is established from evidence, not inferred
- [ ] #2 A cursor that is ahead of the newest completed post-commit run is detected and reported
- [ ] #3 The 14 skipped events are processed, or a decision not to is recorded with its reasoning
- [ ] #4 A test proves the cursor cannot advance past an event with no completed run
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
