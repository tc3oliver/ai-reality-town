---
id: ART-99
title: Daily canon snapshots fail on seeded worlds
status: To Do
assignee: []
created_date: '2026-08-04 06:14'
labels:
  - prd-1.0
  - epic-b
dependencies: []
priority: medium
ordinal: 99000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
canon/snapshotOperations:persistDailySnapshot fails for any world seeded through canon/worldConfig.ts:importWorld. importWorld inserts an 'initial' canonSnapshots row whose projection holds the seeded locations/organizations (lastSequenceNumber -1), which is not derivable from accepted events alone, so snapshotManager.assertSnapshotMatchesHistory rejects it with SNAPSHOT_CORRUPT when createDailySnapshot chains from the latest snapshot. Verified live: 'npx convex run canon/snapshotOperations:persistDailySnapshot {"worldId":"mistwood","worldDay":2,"createdAt":1785823000000}' fails standalone on the dev deployment. Discovered during ART-98; the ART-98 post-commit pipeline isolates the snapshot stage so this cannot block the editorial release, but the daily recovery snapshot is genuinely not being produced. Fix requires reconciling the ART-22 'snapshot must be replayable from accepted events' invariant with the world-seeding model (either seed the world configuration as canon events, or teach the snapshot manager about a seeded baseline projection).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 persistDailySnapshot succeeds for a world seeded through importWorld
- [ ] #2 assertSnapshotMatchesHistory still rejects a genuinely corrupt snapshot
- [ ] #3 The ART-98 post-commit snapshot stage reports a real snapshotId for a completed world day
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
