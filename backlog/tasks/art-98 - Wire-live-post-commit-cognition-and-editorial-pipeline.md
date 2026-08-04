---
id: ART-98
title: Wire live post-commit cognition and editorial pipeline
status: In Progress
assignee: []
created_date: '2026-08-04 05:07'
updated_date: '2026-08-04 06:31'
labels:
  - prd-1.0
  - epic-g
  - launch-readiness
dependencies:
  - ART-97
  - ART-83
  - ART-24
  - ART-25
  - ART-26
  - ART-29
  - ART-30
  - ART-31
  - ART-33
  - ART-34
  - ART-51
priority: high
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second half of the live daily-cycle gap (first half: ART-97). After a canon event is committed, the PRD requires character knowledge/memory updates, story-arc classification/lifecycle transitions, daily episode generation, recap pyramid updates, and editorial release so public read models reflect real content (Section 12, Epic E/F/G, ART-83). ART-24/25/26 (knowledge/memory), ART-29/30/31 (arc classification/count-control/stagnation), ART-33/34 (daily episodes/recap pyramid), ART-51 (editorial lifecycle), and ART-83 are all Done as pure, unit-tested logic, but confirmed by grep that convex/operations/postCommitOrchestration*.ts exposes only bookkeeping internalMutations with no caller anywhere in production code -- nothing invokes the knowledge/memory/arc/episode/editorial chain after a commit today. This task wires a live-invokable post-commit orchestration (triggered after ART-97's commit step) that runs: knowledge/memory updates -> arc classification and lifecycle transitions -> daily episode assembly -> recap pyramid update -> editorial release (rebuild the affected publicRead projections). Do not re-implement the underlying pure logic; wire the existing, already-tested modules together.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After ART-97 live-commits a world day, character knowledge/memory projections, story arc lifecycle state, and daily episode records update automatically with no manual per-step script or CLI call
- [x] #2 Newly committed high-importance events cause the affected read-model projections (character, world, episode, timeline, arc, relationship, liveState, onboarding, arc primer) to rebuild and become servable automatically, not only via manual internalMutation calls
- [x] #3 An integration test proves that after running one or more live world-days (via ART-97), a public reader (getPublishedReadModel) sees updated content reflecting the new events, with no direct LLM call from the public read path
- [x] #4 Story Arc lifecycle respects existing FR-F001-F005 rules as already specified by ART-29/30/31/64 -- this task verifies those guarantees hold when driven live, it does not redefine them
- [x] #5 npm run check passes; the live post-commit entry point is documented in code comments and, if applicable, docs/architecture
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a Convex-backed PostCommitRunStore adapter (createConvexPostCommitRunStore) to convex/operations/postCommitOrchestrationFunctions.ts, mirroring ART-97's createConvexWorldDayRunStore, so the already-tested pure orchestrator (executePostCommitPipeline) gets a durable substrate instead of only bookkeeping mutations.
2. New pure module convex/operations/postCommitLive.ts: a PostCommitLivePort data-access port plus createPostCommitStageHandlers() implementing the 11 PRD 12 stages 11-21 (projection, knowledge, memory, relationship, arc, episode, recap, safety, publication, snapshot, metrics). Every stage is a thin adapter over an existing capability; the only new logic is deterministic derivation of stage inputs from the accepted event (arc-event importance, an ArcEventClassification candidate that is then run through the already-tested parse/validate path, arc role and lifecycle target status, episode numbering), mirroring how ART-97 derives a Director Plan candidate and hands it to parseAndValidateDirectorPlan.
3. New adapter convex/operations/postCommitLiveFunctions.ts binding that port to the deployment: reuses recordArcEventClassification, admitArcToPortfolio, transitionArcLifecycleRecord, updateArcProjection, refreshArcStagnationPrompts, reassessMajorActiveArcEntries, generateAcceptedEventEpisode, generateIncrementalRecap, createEpisodePublication/advancePublication, persistDailySnapshot, authorizeKnowledgeRead/authorizeMemoryRead, and the publicRead rebuild* mutations (world, character, relationship, episode, episodeIndex, timeline, arc, arcPrimer, liveState, onboarding). Exposes runPostCommitPipeline (one accepted event) and runLiveWorldDayCycle (the live entry point: calls ART-97's runQueuedWorldDaySlot then runs post-commit for every committed event, in order).
4. Add story/portfolioFunctions.ts:syncArcPortfolioEntry so a portfolio entry's projection snapshot tracks the authoritative lifecycle status/heat/progress (needed for FR-F003 count control and FR-H003 entry reassessment to work when driven live).
5. Entry point lives in convex/operations because architecture/module-boundaries.json forbids simulation -> operations; operations may depend on every other module.
6. Tests: unit tests for the derivations and stage handlers over an in-memory port (convex/operations/postCommitLive.test.ts), plus a live-shaped integration test that runs several world-day slots through ART-97's executeWorldDay against an in-memory canon store, feeds every committed event through the post-commit pipeline, and asserts a public reader sees non-empty episode/timeline/arc read models with zero provider calls on the read path.
7. Document the live entry point in docs/world-day-execution.md and in code comments.
8. Verify live against the running dev deployment: reserve slots, run runLiveWorldDayCycle, then show getPublishedReadModel for episode/timeline/arc returning real content that was empty before.
9. npm run check green; honest AC/DoD; commit, push, PR, auto-merge, task to In Review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

Live entry point: `operations/postCommitLiveFunctions:runLiveWorldDayCycle` (internalMutation). It calls ART-97's `runQueuedWorldDaySlot` (stages 1-10) and then drives the resumable post-commit pipeline (stages 11-21) for accepted events. Composed in `convex/operations` because module-boundaries.json forbids simulation -> operations while operations may depend on every domain. `runPostCommitPipeline` re-drives one accepted event.

New files:
- `convex/operations/postCommitLive.ts` (pure): `PostCommitLivePort` + `createPostCommitStageHandlers` for the 11 stages, plus deterministic derivations (arc-event importance, an ArcEventClassification candidate that is then validated by the existing `parseArcEventClassification`, roles from arc status, FR-F002 targets read from `ALLOWED_ARC_TRANSITIONS`, episode numbering, recap windows).
- `convex/operations/postCommitLiveFunctions.ts`: Convex adapter binding the port to the existing internal capability mutations (classification, portfolio, lifecycle, arc projection, stagnation, entry recommendation, episode, recap, publication lifecycle, snapshot, knowledge/memory authorization, and every publicRead rebuild*).
- `convex/operations/postCommitLive.test.ts`: 26 tests, including a live-shaped integration test that produces REAL accepted events through ART-97's `executeWorldDay` over an in-memory canon store, runs stages 11-21 for every event against the real story/editorial/recap/publication/read-model builders, and asserts a public reader sees non-empty episode/timeline/arc models whose entries all trace to accepted events.
- `docs/post-commit-pipeline.md`.

Also added: `createConvexPostCommitRunStore` in postCommitOrchestrationFunctions.ts (mirrors ART-97's world-day run store, turning bookkeeping mutations into a real durable substrate), and `story/portfolioFunctions:syncArcPortfolioEntry` so a portfolio entry's projection snapshot tracks the authoritative lifecycle - without it FR-F003 count control and FR-H003 entry reassessment read a stale 'emerging' status forever.

## Decisions

- Post-commit work is a CURSOR over accepted events, not a callback on one call's commits: each call takes the oldest accepted events with no completed run, in canon order. One entry point then covers this call's commits, a previous call's failure, and events accepted before the pipeline existed, and derives arcs/episodes/recaps in canon order.
- Arc pacing: an arc advances at most one lifecycle step per world day, only on a primary membership with importance >= 0.7, and only into the active family when the tier is under its FR-F003 limit. Otherwise the transition is deferred and recorded - never forced, never dropped.
- Stagnation is measured against the world's CURRENT day, not the source event's day, so backfilling an older event cannot trip ARC_STAGNATION_TIME_INVALID.
- FR-K004 reserves the publish/withhold actions for an administrator, so the system-actor pipeline takes a publication record to `ready` and leaves the release decision to an admin. Public read models are a separate mechanism and ARE released automatically, gated by the episode's own safety verdict.
- The `snapshot` stage is isolated (failure recorded on the artifact, pipeline continues) because the daily snapshot is a canon RECOVERY artifact and feeds no public read model.

## Defects found and handled

- ART-99 (created): `canon/snapshotOperations:persistDailySnapshot` fails for any world seeded via `importWorld`; verified failing standalone on the dev deployment. Pre-existing, out of scope, isolated here.
- ART-100 (created): every publicRead rebuild replays the whole accepted-event log, so one post-commit run costs several MB of reads at ~65 accepted events; `maxPostCommitEvents` defaults to 1 to stay under the Convex 16 MiB per-transaction read limit.
- `commitReadModelVersion` read a target's ENTIRE version history on every commit just to clear stale last-known-good rows. Replaced with a `loadLastKnownGood` store method over the existing `by_lkg` index. This was the single largest read cost once rebuilds started running automatically.
- Episodes for world days 0-1 carry empty `arcIds` because those days' episodes were assembled before backfill classified their events, and ART-33 episode assembly is first-wins per world day. Days 2-3 (assembled after classification) carry real arcIds.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired PRD Section 12 stages 11-21 into a live, resumable pipeline that runs automatically after ART-97 commits an accepted event, closing the second half of the live daily-cycle gap. New entry point `operations/postCommitLiveFunctions:runLiveWorldDayCycle` executes a queued world time slot and then drives projection -> knowledge -> memory -> relationship -> arc -> episode -> recap -> safety -> editorial release -> snapshot -> metrics over the existing, already-tested capabilities. No underlying logic was reimplemented; the only new logic derives each capability's input deterministically from the accepted event and hands it to the existing validators.

Verified live against dev deployment colorless-deer-917 (world `mistwood`), where these read models were previously null:
- `getPublishedReadModel episode/episodes:mistwood` -> v12, 4 episodes (World Day 0-3), days 2-3 carrying real arcIds.
- `getPublishedReadModel timeline/timeline:mistwood` -> v68, 68 entries, every entry tracing to an accepted event.
- `getPublishedReadModel arc/arc:arc:mistwood:50` -> v23, status `resolving`, 36 known clues, related episodes 3 and 4.
- `getPublishedReadModel episode/episode:3` -> v1, 5 key scenes, 3 arcs.
- Also live and served: world:mistwood v11, onboarding:mistwood v16, character:he-jun v1, relationship:he-jun:zhao-ming, live:mistwood v19, primer:arc:mistwood:50 v22.
- Three story arcs were created from live scenes and advanced emerging -> active -> escalating -> climax -> resolving through legal FR-F002 transitions only; `viewer_context` recap now covers sequences 0-74 across 21 snapshots.
- Every accepted event 0-74 has a completed post-commit run; re-running the entry point returns an empty `postCommit` list (idempotent, nothing left to do).

Automated: `npm run check` exit 0 (architecture boundaries valid, typecheck, lint, 70 suites / 681 tests, build). New `convex/operations/postCommitLive.test.ts` adds 26 tests, including a live-shaped integration test that produces real accepted events through ART-97's `executeWorldDay` and asserts a public reader sees non-empty episode/timeline/arc read models with no provider on the read path.

Honest limits, both recorded as follow-up tasks: `maxPostCommitEvents` defaults to 1 accepted event per transaction because every publicRead rebuild replays the whole event log (ART-100), and daily canon snapshots cannot be taken on a world seeded through `importWorld` (ART-99, pre-existing and verified failing standalone); the snapshot stage is isolated so it cannot block the editorial release.
<!-- SECTION:FINAL_SUMMARY:END -->
