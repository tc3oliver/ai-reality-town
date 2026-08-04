# Live post-commit cognition and editorial pipeline

ART-98 implements PRD Section 12 stages 11–21 as one runnable chain that starts the moment
ART-97 commits an Accepted Event. Together the two tasks close the Milestone 2 live
daily-cycle gap: a world day now runs end to end and the result is servable public content.

## Entry point

`operations/postCommitLiveFunctions:runLiveWorldDayCycle` is the single live daily-cycle
entry point. It calls ART-97's `runQueuedWorldDaySlot` (stages 1–10, up to the Canon
commit) and then runs the resumable post-commit pipeline for every accepted event:

```
projection → knowledge → memory → relationship → arc → episode → recap →
safety → publication → snapshot → metrics
```

```bash
npx convex run simulation/schedulerOperations:advanceOneSlot '{"worldId":"mistwood","now":0}'
npx convex run operations/postCommitLiveFunctions:runLiveWorldDayCycle '{"worldId":"mistwood"}'
npx convex run publicRead/readModelFunctions:getPublishedReadModel \
  '{"worldId":"mistwood","modelKind":"episode","modelRef":"episodes:mistwood"}'
```

`operations/postCommitLiveFunctions:runPostCommitPipeline` runs stages 11–21 for a single
already-accepted event, which is what an operator uses to re-drive one commit.

The chain is composed in `convex/operations` rather than in the world-day executor because
`architecture/module-boundaries.json` lets `operations` depend on every domain while
`simulation` may not depend on `operations`.

## What each stage does

Every stage is a thin adapter over an already-tested capability. The pipeline sequences
them; it does not reimplement them.

| Stage | Capability it drives |
| --- | --- |
| `projection` | `publicRead` world + character rebuilds (ART-I005) |
| `knowledge` | authorized knowledge ledger read (ART-24/25) |
| `memory` | authorized subjective-memory read (ART-26) |
| `relationship` | `publicRead` relationship rebuild for every pair the event moved (ART-I006) |
| `arc` | classification, portfolio count control, lifecycle transitions, arc projection, stagnation prompts (ART-29/30/31) |
| `episode` | daily episode assembly for every finished world day (ART-33) |
| `recap` | incremental recap pyramid, day and world level (ART-34) |
| `safety` | the ART-52 verdict episode generation already recorded |
| `publication` | ART-51 publication lifecycle plus every affected public read-model rebuild |
| `snapshot` | ART-22 daily canon snapshot |
| `metrics` | durable metrics hook linked to the world-day trace (ART-57) |

The knowledge and memory ledgers are canon replays, so the commit itself IS the update;
those stages read them back through the authorization boundary and record what the event
added. Nothing in the pipeline writes Canon.

## Derived stage inputs

The only new logic (`convex/operations/postCommitLive.ts`) derives each capability's input
deterministically from the accepted event and the current world state, exactly as ART-97
derives a Director Plan candidate and hands it to `parseAndValidateDirectorPlan`:

- **Importance** comes from the event itself: participant count, state-change count, and
  whether it produced public copy, bounded to 0…1.
- **Classification** attaches the event to open arcs that share a core character; when none
  match and the event is weighty enough (importance ≥ 0.6, at least two participants) it
  proposes a new arc. The candidate is then validated by `parseArcEventClassification`, so
  the FR-F001 membership, primary and new-arc rules are enforced by the story layer.
- **Roles** follow the arc's status (`emerging`→development, `active`→escalation,
  `escalating`→turning_point, `climax`→climax, `resolving`→resolution).
- **Lifecycle targets** are read from the FR-F002 legal-transition table. An arc advances
  only on a primary membership with importance ≥ 0.7, at most one step per world day
  (pacing), and only into the active family when the tier is under its FR-F003 limit —
  otherwise the transition is deferred and recorded, never forced.
- **Episode numbers** are the 1-based position of a finished world day in world history.
- **Recap windows** advance a per-target cursor: a day-level `episode` recap and a
  world-level `viewer_context` recap. Arc and season levels need a non-contiguous source
  window, which ART-34's incremental range contract does not provide.

## Idempotency and failure isolation

The run ID is `postcommit:<worldId>:<sequenceNumber>`, so a completed run short-circuits and
a failed run resumes at the stage that failed. Each capability keeps its own idempotency
boundary (episode per world day, recap snapshot ID, publication content ref, read-model
content hash), so a replay produces no duplicates.

`runLiveWorldDayCycle` treats post-commit work as a cursor over accepted events rather than
a callback on the events one call committed: each call takes the oldest accepted events
that have no completed run, in canon order. One entry point therefore covers events it just
committed, a previous call's failure, and events accepted before the pipeline existed, and
arcs, episodes and recaps are always derived in canon order. `maxPostCommitEvents` bounds
one transaction and defaults to 1 — see the read-budget limitation below — so call it
repeatedly until `postCommit` comes back empty.

A downstream failure never edits or deletes an accepted event — the pipeline only records a
durable checkpoint. The `snapshot` stage is additionally isolated: the daily snapshot is a
canon RECOVERY artifact and is not an input to any public read model, so a snapshot failure
is recorded on the artifact instead of aborting the editorial release that already
completed.

### Known limitation: per-transaction read budget

Every `publicRead` rebuild re-derives its payload by replaying the whole accepted-event
log. Measured on the dev deployment at ~65 accepted events, one post-commit run already
costs several megabytes of document reads, so `maxPostCommitEvents` defaults to 1 to stay
under the Convex 16 MiB per-transaction limit. Making the projection builders incremental
is tracked as ART-100; until then the live cycle processes one accepted event per call.

### Known limitation: daily snapshots on seeded worlds

A world seeded through `canon/worldConfig.ts:importWorld` cannot currently take a daily
snapshot at all. `importWorld` inserts an `initial` snapshot whose projection holds the
seeded locations and organizations, which are not derivable from accepted events; the
snapshot manager's `assertSnapshotMatchesHistory` invariant rejects it, and
`canon/snapshotOperations:persistDailySnapshot` therefore fails standalone for such a
world. This predates the post-commit pipeline and is tracked separately (ART-99).

## Editorial authority

The pipeline runs as a `system` actor. FR-K004 reserves `publish` and `withhold` for an
administrator, so the pipeline takes a publication record as far as `ready` and leaves the
final release decision to an admin. Public read models are a separate mechanism and ARE
published automatically — they are gated by the episode's own safety verdict, and reads go
through `getPublishedReadModel`, which touches no canon table and no provider.

## Verification

```bash
npm test -- --runTestsByPath convex/operations/postCommitLive.test.ts
```

The test drives real world days through ART-97's `executeWorldDay` over an in-memory Canon
store, runs stages 11–21 for every accepted event against the real story, editorial, recap,
publication and read-model builders, and asserts a public reader sees non-empty episode,
timeline and arc read models whose every entry traces to an accepted event.

ART-60 drives the same two halves for 7 and 30 consecutive world days and machine-checks the
result against PRD Section 19.3 — see
[`long-run-simulation-harness.md`](./long-run-simulation-harness.md).
