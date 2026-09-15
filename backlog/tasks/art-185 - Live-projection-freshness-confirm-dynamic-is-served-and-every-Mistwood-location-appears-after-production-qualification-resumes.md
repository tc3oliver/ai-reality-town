---
id: ART-185
title: >-
  Live projection freshness: confirm dynamic is served and every Mistwood
  location appears, after production qualification resumes
status: Blocked
assignee: []
created_date: '2026-09-15 12:20'
updated_date: '2026-09-15 12:20'
labels: []
dependencies:
  - ART-183
  - ART-184
priority: high
ordinal: 183000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The live map at /ai-town/live/mistwood renders no map. It shows an empty frame, the sentence 目前沒有任何可用的角色位置資料。and the heading 實況地圖 above instructions for panning and zooming a map that is not there. It also reports 世界時間未知 while the home page simultaneously reports 第 3 天 night, so two views of the same world disagree.

This task is NOT to be judged a repository defect yet. The evidence currently points at deployment staleness, and the deciding test cannot run until production qualification resumes.

What is established:

- The served liveState for mistwood is version 19, published 2026-08-04, servedFrom current.
- Its payload keys are activeArcs, activeScenes, characters, locations, publishedEpisodeStatus, recentEvents, schemaVersion, worldId, worldTime. There is no dynamic key at all.
- The dynamic field was added to convex/publicRead/liveState.ts on 2026-08-07 by ART-115, commit 563dc5e. The served data therefore predates the field by three days.
- convex/publicRead/publicDynamicProjection.ts:823 returns null when dynamic is absent, which is the documented behaviour for a pre-ART-115 payload. getPublicDynamicProjection consequently returns null and the degradation ladder falls to its informational rung with reason no-positions.
- The last accepted event is mistwood#event#74 and the newest snapshot is worldDay 4 dated 2026-08-05. The world has not run for roughly six weeks.

A second, possibly independent problem is visible in the same payload and must not be lost: locations contains exactly ONE entry, mistwood-station, while the characters in the same payload sit at mistwood-square, mistwood-hall, mistwood-mill and mistwood-paper. CLAUDE.md section 9 records that convex/publicRead replays from empty deliberately to keep seed data out of public read models, and that seeded locations live only in the initial snapshot importWorld writes. If that is the cause, a redeploy will not fix it and the map will still have nowhere to place anyone.

Ordered procedure once production qualification resumes. Do not start it before ART-183 and ART-184 are merged with CI green.

1. Deploy current main.
2. Run one live slot.
3. Confirm a new liveState version is served and that its payload carries a non-null dynamic.
4. Check whether every Mistwood location appears in the projection locations array.
5. Only if dynamic is restored and locations are still missing, classify the seed-location omission as a repository defect and fix it under this task.

Blocked on production qualification, which is PAUSED by release policy until ART-183 and ART-184 are merged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Current main is deployed and one live slot has run
- [ ] #2 The served liveState for mistwood is a version newer than 19 and its payload carries a non-null dynamic
- [ ] #3 getPublicDynamicProjection returns a projection rather than null for mistwood
- [ ] #4 The live map renders positions rather than falling to the informational rung with reason no-positions
- [ ] #5 The live view and the home page agree on world day and time slot; 世界時間未知 does not appear while the home page shows a known day
- [ ] #6 Every Mistwood location a character occupies is present in the projection locations array, or the omission is explained and classified
- [ ] #7 If locations are still missing after a successful dynamic rebuild, the seed-location omission is classified as a repository defect, fixed, and covered by a regression test that does not require production data
- [ ] #8 The finding is recorded in the PRD 2.0 closure record with the deployed commit SHA and the served liveState version
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
