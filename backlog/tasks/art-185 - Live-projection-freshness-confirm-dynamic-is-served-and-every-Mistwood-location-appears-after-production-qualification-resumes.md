---
id: ART-185
title: >-
  Live projection freshness: confirm dynamic is served and every Mistwood
  location appears, after production qualification resumes
status: Blocked
assignee: []
created_date: '2026-09-15 12:20'
updated_date: '2026-09-18 19:20'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Repository-side precheck, done without touching production (2026-09-15)

Everything in this task that does NOT need a deployment has now been checked. The result splits the task cleanly in two.

### The location half: reproducible, explained, and no longer viewer-visible

1. **Initial snapshot location completeness — PASS.** convex/canon/mistwoodSeed.ts authors eight locations and importWorld writes them into the initial snapshot.
2. **Replay restores every seed location — PASS.** replayWorldEvents starts from SEEDED_BASELINE and locations is one of SEED_BASELINE_FIELDS, so a Canon replay has them all.
3. **The public projection loses them — CONFIRMED, and BY DESIGN.** convex/publicRead/liveFold.ts folds locations from EMPTY over location_state_changed alone; its own comment reads "Never seeded". Resuming from a Canon snapshot instead would add the seed locations back and make the incremental fold differ from a full replay, which is exactly what ART-100 AC#3 forbids. CLAUDE.md section 9 records the empty replay as deliberate, to keep seed data out of public read models.
4. **Reproduced deterministically, with no production data.** src/components/live/publicEntityNaming.test.ts uses a fixture in precisely this shape — one published location, characters standing in others — because that is what the live payload looks like.

So the omission is NOT a repository defect. The published payload is correct; mistwood-station is there because an event described it and the other seven are not because none has.

What WAS a defect is the consequence, and it is fixed under ART-186: the text live view rendered 「未知位置」 for a character the animated map was drawing inside a named building, and the character page rendered the raw location id under 所在地. The map has always placed people against mistwoodLocationFootprints, which ships in the client bundle; the text surfaces now use the same authored names. AC#6 and AC#7 are therefore answerable now: the omission is explained and classified, and the viewer-visible half is closed without publishing seed data.

### The dynamic half: still genuinely production-freshness-blocked

Every repository-side link in the chain is present and covered:

- liveState.ts:82/211 declares and fills dynamic; liveState.test.ts:142 pins that it defaults to null and :157 that a supplied projection nests without disturbing the semantic character list.
- liveStateFunctions.ts:917 passes it through the publish path.
- selectPublicDynamicProjection returns null ONLY when the key is absent or null. A present, valid projection is returned — nothing in the selector or the fallback chain downgrades valid data.

The production null therefore has exactly one remaining explanation, which is the one this task already recorded: the served payload is version 19, published 2026-08-04, three days before ART-115 (563dc5e) added the field on 2026-08-07. No repository change can alter what a payload published six weeks ago contains.

### Revised procedure once production qualification resumes

Steps 1-3 stand. Step 4 is now a confirmation rather than an investigation, and step 5 is answered:

4. Expect locations to contain only the locations events have described. That is correct behaviour, not a symptom.
5. Do NOT classify the seed-location omission as a repository defect — it is required by ART-100 AC#3. Confirm instead that the map places characters and that the text live view names their locations, which is ART-186's guarantee.

Partially verified on colorless-deer-917 (Public Acceptance / Staging) 2026-09-17, and the cause is now established.

The stale liveState was NOT a projection defect. rebuildLiveProjection invoked directly published
v20 immediately: publishedAt 2026-08-04 -> 2026-09-17T20:14:28Z, dynamic present with 12 characters
and 0 problems, 0 unbound characters, world time day 3 night -> day 5 evening, servedFrom current.
The projection code is healthy.

What is NOT verified is that the PIPELINE keeps it fresh, and it does not: post-commit runs exist
only through mistwood#event#74 while Canon holds events up to #88, and drainLivePostCommit returns
[] because its cursor is past them. That is ART-202, and it is what ART-185 is actually blocked on.

Remains Blocked. Do not close on the manual rebuild -- an operator running a mutation by hand is not
the freshness guarantee this task is about.

Acceptance qualification 2026-09-18/19, on colorless-deer-917 (Public Acceptance / Staging), deployed
commit 9681fbd.

  AC#1  PASS  current main deployed; four live slots run (day 7 evening, day 7 night, day 8 morning
              twice — the first failed, the second committed).
  AC#2  PASS  served liveState is version 33 (was 19), servedFrom current, publishedAt moved from
              2026-08-04 to 2026-09-18, and the payload carries a non-null `dynamic`.
  AC#3  PASS  getPublicDynamicProjection returns a projection: worldDay 7, timeSlot evening,
              worldStatus running, mapId mistwood-v1, snapshotSequence 93, 12 characters, each with
              a semanticLocationId and a from/to position.
  AC#4  PASS  the live map RENDERS. Screenshot evidence desktop 1440x900 and mobile 393x851: tiles,
              named buildings (Mistwood Station, Lantern Square), character sprites drawn in the
              square. No informational rung, no `no-positions`.
  AC#5  PASS  home reports 第 7 天 / 傍晚 and the live map reports 現在 第 7 天 · 傍晚. 世界時間未知
              does not appear.
  AC#6  PASS  `locations` holds exactly `mistwood-station` — the one location an event has described.
              Confirmed as the correct, deliberate behaviour recorded in the precheck above, not a
              symptom. The character page reads 所在地:Mistwood Chronicle and the live map names
              Mistwood Station, which is ART-186 naming from the client bundle.
  AC#7  N/A   no seed-location defect to classify; see AC#6.

What is still NOT satisfied is the thing this task said it was really about: that the PIPELINE keeps
the projection fresh, rather than an operator running a mutation by hand.

  The world is still `mode: development`, so `drivableWorldIds` excludes it from both crons and
  every drain above was invoked manually. Promoting it needs `changeWorldMode`, which is gated on
  `world.change_mode` and returns OPS_UNAUTHORIZED from the CLI — `CLERK_JWT_ISSUER_DOMAIN` is set
  on acceptance and `SIMULATION_OPS_ALLOW_TOKEN_FALLBACK` is not, so the token branch is closed and
  there is no operator console in `src/` to sign in to. That is a credential blocker, not a
  repository defect.

  And it must not be promoted yet regardless: ART-212. `drainAllLivePostCommit` — the cron — uses a
  default batch of 3 events, which exceeds the Convex 16 MB read limit for this world. The cron
  would fail on every tick.

Remains Blocked, now on ART-212 and on an operator credential rather than on ART-202.
<!-- SECTION:NOTES:END -->
