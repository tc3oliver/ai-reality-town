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
| `episode` | daily episode assembly for every finished world day (ART-33), plus the four FR-G003 recap formats for each (ART-164) |
| `recap` | incremental recap pyramid, all five FR-G002 levels (ART-34/ART-164) |
| `safety` | the ART-52 verdict episode generation already recorded |
| `publication` | the FR-G004 coverage and spoiler gate (ART-164), the ART-51 publication lifecycle, and every affected public read-model rebuild |
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
- **Recap windows** advance a per-target cursor across all five FR-G002 levels: a slot-level
  `scene` recap, a day-level `episode` recap, one `arc` recap per arc the event moved, a
  `season` recap per fixed ten-day window, and a world-level `viewer_context` recap. The arc
  level is *selective* — its sources are the events that moved that arc's projection, carried
  with a `sourceScope` recording the range examined. ART-164 added that contract; until then arc
  and season needed a non-contiguous window ART-34's range rules did not provide, and neither
  level ran for any world. See `docs/incremental-recap-pyramid.md`.

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

### Per-transaction read budget

A post-commit run's document reads no longer grow with the world's accepted-event count
(ART-100). Every rebuild that used to replay the whole log now resumes from something
maintained:

| what | resumes from |
| --- | --- |
| world / character / relationship-graph projections, knowledge, memories | the newest `canonSnapshots` row plus the events after it |
| the Live projection and the Visual Replay | `liveRebuildCheckpoints` (four folds) and `replaySceneCandidates` (a ranked scene index) |
| completed world days, episode days | `worldDayLedgers` |
| `runLiveWorldDayCycle`'s own candidate scan | `postCommitCursors`, a bounded page behind a settled-through cursor |
| the onboarding summary's tail scan | a `MAX_SCANNED_EVENTS` cap, above which it is flat |

Measured on `postCommitLiveFunctions.readMeasurement.test.ts` at 210 and 410 accepted
events, a post-commit run reads an **identical** number of `canonEvents` rows at both
sizes. `maxPostCommitEvents` therefore defaults to **3** — a whole time slot in one
transaction — rather than 1.

Every one of those tables is a DERIVED cache. Each is a fold of accepted Canon, holds no
fact that is not already in it, and can be discarded and rebuilt (`rebuildLiveProjection`
takes `rebuildFromScratch`). Losing one costs a catch-up, not a fact.

**What still grows, honestly.** Two reads remain O(world days) rather than O(1):
`rebuildEpisodeIndexProjection` reads every daily episode, and so does
`rebuildTimelineProjection`. The first is *payload-bound* — the model it publishes IS the
list of every episode, so it cannot read fewer rows than it publishes without paginating
the public contract. The second is not, and bounding it to the days it actually timelines
is the next thing to do here. Neither grows with events per day.

## The coverage and spoiler gate

`validate` is not a bare lifecycle step. Stage 19 first runs the FR-G004 gate
(`runEpisodeCoverageGate`), and only a releasable verdict advances the record. Until ART-164 both
coverage-gate functions had zero production callers, so nothing checked at publication time that a
high-importance Accepted Event was covered or explicitly excluded, that a major public relationship
change or an arc turning point was mentioned, or that an unreleased secret had reached public copy.

The gate **returns** its verdict rather than throwing. This stage is not failure-isolated: a throw
aborts `rebuildLiveProjection` and `rebuildOnboardingSummary`, so a coverage refusal would stop a
*safety* withhold from reaching the public surface. Refusing to publish must never be the reason
unsafe content stays up. `validateEpisodeCoverageGate` — which throws, and which also performs the
transition — remains the right shape for an operator calling it directly.

The gate performs **no** publication transition. The publication stage owns every transition, and a
verdict function that advanced a record as a side effect of being asked a question would give the
pipeline two owners of the lifecycle.

A refusal is not a run failure. The candidate is simply never validated, so it stays at
`generated`, whose only legal action is `validate` — it therefore cannot reach `published` by any
route, which falls out of the lifecycle rather than needing a rule of its own. The episode read
model and the FR-G005 share formats are gated on the verdict too: share formats are public copy,
and a coverage refusal leaves the Episode row `ready`, so the share generator cannot refuse for
itself the way it can for a withhold. The report is persisted on both outcomes, because a gate that
recorded only refusals would leave "checked and passed" indistinguishable from "never ran".

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

## Knowing whether post-commit is caught up (ART-202)

`drainLivePostCommit` used to return a bare array of outcomes, and an **empty** array meant two
opposite things:

- every accepted event has a completed run; and
- this call spent its page advancing the cursor over already-settled events, and there is more to
  do — call again.

The drain reads one bounded page: `DEFAULT_MAX_POST_COMMIT_EVENTS` (3) + `POST_COMMIT_CURSOR_CATCHUP`
(32) = 35. A world whose cursor row is absent starts at `-1` and needs one call per 35 settled
events before it reaches the first unprocessed one.

That ambiguity produced a wrong `CRITICAL` defect report. The drain was called twice against the
acceptance deployment, returned `[]` twice, and was read as "the pipeline is caught up". It was three
pages behind: the fourth call processed event 75 and the next four worked through to 88, all
`completed`, and liveState advanced from v19 to v30. The cursor invariant it was accused of breaking
was correctly implemented and already tested.

The drain now returns `cursorBefore`, `cursorAfter`, `caughtUp` and `remaining`. `caughtUp` requires
the page to be **short** as well as owing nothing — a full page says nothing about what lies beyond
it, and claiming otherwise would put the ambiguity back in the one case where the caller most needs
to call again.

### Why the world sat still for six weeks

A different cause, and one nothing reported: `drivableWorldIds` selects `mode: 'public'` **and**
`status: 'running'`. A world in development mode is skipped by **both** crons — the live driver and
the post-commit drain. The acceptance world was in exactly that state while fourteen accepted events
accumulated with no derived work.

`inspectPostCommitBacklog` answers that directly. `cronWillNeverDrain` is the shape of a world that
cannot catch up on its own, however long it is left.

### Reconciliation

`reconcilePostCommit` repairs only what is owed. It touches **no Canon**: no accepted event is
modified, deleted, re-sequenced or superseded, and no correction or retcon is written. The accepted
events are facts; what is missing is the derived work stages 11–21 owe them.

It is not "re-run everything from N and hope dedup holds". Each event is checked individually and
skipped when its run already completed, so a second call over the same range is a no-op **by
construction** rather than by the downstream writes happening to be idempotent. It dry-runs by
default.

The cursor is advanced last and re-derived from the world, never from the repairs. Repairing event 3
while 2 is still owed must not carry the cursor over 2 — and a sub-range reconciliation must not
carry it over the range below the scan at all, which is what `scanCoversCursor` states.

## ART-210 — a public read must not cost more because the world is older

`drainLivePostCommit` at its **default** batch of three events exceeded Convex's 16 MB
per-transaction read limit on the acceptance deployment, after two live slots:

```
Uncaught Error: Too many bytes read in a single function execution (limit: 16777216 bytes)
```

One event at a time still worked, so the world was drained by hand. That is not a workaround:
`drainAllLivePostCommit` — the cron — uses the same default, so the pipeline would have failed on
every tick the moment the world was promoted to `public`, and nothing would have advanced.

### Measured, not guessed

Whole-world reads for mistwood at Canon sequence 98:

| table / target | rows | bytes |
| --- | ---: | ---: |
| `publishedReadModels` (all) | 415 | 3.19 MB |
| — `timeline\|timeline:mistwood` | 82 | 1.48 MB |
| — `liveState\|live:mistwood` | 33 | 0.40 MB |
| — `world\|world:mistwood` | 14 | 0.29 MB |
| `canonEvents` | 99 | 0.24 MB |
| `storyArc*` + `worldCharacters` | 127 | 0.12 MB |

Every distinct byte the drain can touch is about **3.5 MB**. Thirteen megabytes of reads against
three and a half megabytes of data means the same rows, read again and again — which is what ruled
out the obvious suspects. The four whole-world `storyArc*` collects in `loadWorldState` look like
the violation and are 0.12 MB; they are also memoised per drain.

### The repetition

`serveReadModel` called `loadTargetVersions` — a `.collect()` of every version a target had ever
published — and then used exactly **two** of those rows: the current one and the last-known-good
one. Both already had their own index, `by_current` and `by_lkg`, and the commit path already used
them for precisely this reason. `PublicReadStore.loadLastKnownGood` says so in its own docblock:
*"a projection rebuilt on every accepted event would otherwise re-read every prior payload it ever
published."* That argument was written down and applied to one of the two sides.

Every internal caller paid it once per event — `publishedEventSummaries`, the display-name resolver
once per character, the runtime snapshot reader — and so did every public page view.

### The fix

`loadTargetVersions` is **removed** from `PublicReadReadStore` rather than left beside a bounded
sibling; the read-only port now carries `findCurrent` and `loadLastKnownGood`, which the write port
already had. A port that still offers the whole history is a port someone reaches for again.

`selectServedVersion` is unchanged. It makes two passes keyed on the flags — `isCurrent`, then
`isLastKnownGood` — and re-checks `status` on both, so a row flagged servable while withheld is
refused exactly as before.

### What the test counts

`convex/publicRead/boundedPublicRead.test.ts` counts the rows the store was **asked** for rather
than reading the implementation, so a reintroduced whole-history read fails whatever it is called.
The decisive case is not "few rows" — it is that a target with three versions and a target with
three hundred cost the **same**.

One injection is worth recording because it did *not* bite. An earlier comment claimed the current
row had to be concatenated first, "because the selection rule is a `find`". Reversing the order
changed no test: the rule keys on flags, not on position. The comment was wrong and is now corrected,
and the case asserts the stronger property — either order serves the current version.
