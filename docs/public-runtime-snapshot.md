# Public Runtime Snapshot

FR-N007 / ART-116. Modules: `convex/publicRead/runtimeSnapshot.ts` (pure),
`convex/publicRead/runtimeSnapshotValidators.ts`, `convex/publicRead/runtimeSnapshotFunctions.ts`
(Convex wiring), table `publicRuntimeSnapshots` in `convex/publicRead/schema.ts`.

ART-115's Public Dynamic Projection answers *what the world looks like right now*. It is
re-derived per accepted Canon event, so a world that stops producing events — a paused
schedule, a failed slot, a provider outage — simply stops producing projections. This module
answers the two questions that follow:

1. **What can we still show?** A snapshot is persisted with its own monotonic
   `snapshotSequence`, so the public view keeps rendering the last valid world state with no
   simulation running at all.
2. **How honest is it?** Elapsed clock is turned into an explicit
   `live | delayed | paused | stale` verdict, so a twelve-hour-old snapshot is never presented
   as though it were updating continuously.

The pure module takes no clock and no `ctx`. `nowMs` is always an argument, so a freshness
verdict is reproducible and a test can sit at any instant.

## The stored contract

| Field | Meaning |
|---|---|
| `schemaVersion` | `1`. Bumped when a stored field is added, removed or reinterpreted. |
| `worldId` | The world this snapshot describes. |
| `runtimeVersion` | Copied from the source projection's `PUBLIC_DYNAMIC_RUNTIME_VERSION`. |
| `snapshotSequence` | **This table's own counter.** Starts at `1`, increments by one per captured row, never regresses. |
| `sourceRuntimeSequence` | The source `PublicDynamicProjection.snapshotSequence` — i.e. the Canon position the content was derived from. `0` for a world with no accepted events. |
| `status` | `live` \| `paused`. **Only these two.** See below. |
| `mapId` | Which map the carried coordinates are measured against. |
| `characterStates` | ART-115's `PublicCharacterMotion[]`, carried verbatim. |
| `activeSceneStates` | ART-115's `PublicActiveScene[]`, widened by ART-122 — `title`, `summary`, `sourceEventIds`, plus the optional spatial fields (`sceneId`, `locationId`, `participantCharacterIds`, `arcIds`, `status`, `publicationStatus`, `startedAt`, `endedAt`). |
| `contentUpdatedAt` | The source projection's `updatedAt` — the last accepted event's `acceptedAt`. Canon-derived, **not** a clock read. |
| `contentHash` | Digest of `(sourceRuntimeSequence, status, mapId, characterStates, activeSceneStates)`. Timestamps excluded. |
| `createdAt` | When this row was captured. |
| `observedAt` | When a capture last confirmed this content and status were still current. |
| `isCurrent` | True for the head. Exactly one per world. |

Indexes: `by_world_and_current [worldId, isCurrent]` (the read path) and
`by_world_and_sequence [worldId, snapshotSequence]` (history).

The snapshot contents inherit ART-115's field whitelist rather than restating it —
`assertActiveSceneState` validates against `PUBLIC_ACTIVE_SCENE_FIELDS` and
`PUBLIC_ACTIVE_SCENE_OPTIONAL_FIELDS` directly, and `buildRuntimeSnapshot` narrows scenes
with ART-115's own `toPublicActiveScene`, so the two contracts cannot drift apart.

**The optional-field back-compat guarantee.** ART-122 (FR-O003) added eight scene fields, and
every one is optional because `assertPublicRuntimeSnapshot` runs on the way **out**:
`serveRuntimeSnapshot` throws rather than degrading, so a required field would make every row
already in `publicRuntimeSnapshots` unreadable and take the public map dark with no way to
rewrite them. For the same reason `RUNTIME_SNAPSHOT_SCHEMA_VERSION` is deliberately **not**
bumped — optional fields do not require it, and a bump would hard-fail every existing row.
Two tests pin both directions: a pre-ART-122 scene shape still validates, and a
fully-populated one does too.

## Freshness is derived, never stored

`status` records what the *world* is doing, and a world can only be running or paused.
`delayed` and `stale` are statements about *our clock* relative to the content — they are not
states the world can be in, and persisting them would create a write path capable of storing a
stale snapshot labelled fresh. So the schema union is `live | paused` and cannot express the
other two at all; the verdict is computed on every read by `classifyRuntimeFreshness`.

That is what makes "a stale snapshot is never presented as continuously updating" a structural
property rather than a promise: a row stored as `live` at `T0` is served as `stale` at
`T0 + 13h` without anything having been rewritten.

### The decision tree

Ordered, first match wins:

| # | Condition | Verdict |
|---|---|---|
| 1 | `status === 'paused'` | `paused` |
| 2 | `observationAgeMs >= 12h` | `stale` |
| 3 | `contentAgeMs < 6h` | `live` |
| 4 | `contentAgeMs < 12h` | `delayed` |
| 5 | otherwise | `stale` |

Where:

```
observationAgeMs   = max(0, nowMs - observedAt)
effectiveContentAt = sourceRuntimeSequence > 0 ? contentUpdatedAt : createdAt
contentAgeMs       = max(0, nowMs - effectiveContentAt)
```

**Why `paused` beats everything.** A paused world is not behind and not broken — it is stopped
on purpose, and its content is exactly as current as it will ever be. Ageing it into `stale`
would report an intentional operator state as a fault.

**Why a stale observation overrides fresh-looking content.** The capture path is what keeps
`status` true. If it has not run in half a day, nobody has checked whether the world is still
running, and reporting `live` would be a guess. Reporting `stale` says "we cannot vouch for
this", which is the honest answer.

**Why `effectiveContentAt` falls back to `createdAt`.** A world with no accepted events has
`PublicDynamicProjection.updatedAt === 0`, because that field is the last event's `acceptedAt`
and there is no last event. Measuring from the Unix epoch would report a world seeded five
minutes ago as decades old. `sourceRuntimeSequence` is the discriminator, not
`contentUpdatedAt === 0`: it is `0` exactly when there is no history.

### Where the thresholds come from

`convex/simulation/scheduler.ts` starts public slots at 00:00, 06:00, 11:00, 15:00 and 19:00,
so consecutive gaps are 6h, 5h, 4h, 4h and (wrapping) 5h. The longest normal gap is therefore
**6h**, and that single observation generates every constant:

| Constant | Value | Reasoning |
|---|---:|---|
| `PUBLIC_SLOT_MAX_GAP_MS` | 6h | The longest gap the schedule normally leaves. |
| `RUNTIME_SNAPSHOT_LIVE_MAX_AGE_MS` | 6h | Content produced within the window it was due in is on time. |
| `RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS` | 12h | One missed slot gap — late, plausibly recoverable. |
| `RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS` | 12h | Two capture windows missed means the capture path itself is down. |

The PRD specifies no numeric staleness threshold anywhere, so these are derived rather than
invented. `publicRead` may not import `simulation`
(`architecture/module-boundaries.json`), so `PUBLIC_SLOT_MAX_GAP_MS` is duplicated — but
`convex/publicRead/runtimeSnapshot.test.ts` imports the real `PUBLIC_SLOT_START_MS` (the
boundary checker skips `*.test.*`) and recomputes the maximum gap from it. A future schedule
change therefore fails that test instead of silently mis-classifying freshness.

## Client-side re-derivation is required

The served envelope carries `freshness`, `contentAgeMs`, `observationAgeMs` **and** a
`thresholds` object, because a Convex query does not re-run when a clock ticks — it re-runs
when its data changes. A client that trusted the `freshness` field alone would keep displaying
`live` indefinitely on a world that had gone quiet.

Clients must therefore re-apply the decision tree locally as their own clock advances, using
the shipped `thresholds` and ages. The renderer's response to each verdict — dimming, badging,
freezing — is FR-O010 / ART-127's degradation ladder, not this task; this task only publishes
the verdict.

## The two capture triggers

| Trigger | Fires on | Catches |
|---|---|---|
| `rebuildLiveProjection` (`liveStateFunctions.ts`) | Every accepted Canon event | Content changes |
| `captureAllPublicRuntimeSnapshots` (hourly cron) | Every public world, running **and** paused | Status changes, and liveness of the capture path itself |

Both are needed. The event-driven trigger alone cannot record a pause, because a paused world
produces no events — its snapshot would keep asserting whatever it said the day the world last
moved. The cron alone would let content sit up to an hour behind Canon. Together they satisfy
"the client can tell Live from Delayed, Paused and Stale" *and* "a stale snapshot is never
presented as continuously updating".

The rebuild captures by a **direct call inside the same transaction**, not by dispatching a
separate mutation, so a snapshot failure rolls the whole rebuild back atomically rather than
leaving a published projection with no snapshot behind it. Canon is unaffected either way: that
transaction writes no Canon at all.

Hourly is a 12× margin under the 12h observation threshold. Because the content digest excludes
timestamps, an idle world costs one `observedAt` patch per run — not a new row.

## Commit outcomes

`commitRuntimeSnapshot` decides in this order:

- **`source_regressed`** — the incoming projection was built from an older Canon position than
  the head already published. That happens when the read-model store falls back to a
  last-known-good version; publishing it would walk the runtime sequence backwards for every
  connected client. The head is left untouched.
- **`deduplicated`** — the content digest matches the head. Only `observedAt` is patched, which
  is what keeps the heartbeat cheap and the sequence stable.
- **`captured`** — a new head at `head.snapshotSequence + 1`.

The new row is inserted **before** the old head is demoted, mirroring `commitReadModelVersion`:
if the insert fails, the previous head is still `isCurrent` and still serving, rather than the
world having no readable snapshot.

Together, the regression guard and the `head + 1` allocation are why a reconnecting client can
never observe a lower `snapshotSequence` than it already saw.

## Why a new table rather than a new `publishedReadModels` kind

`publishedReadModels` dedupes on `contentHash`, which excludes timestamps by design. A snapshot
needs a wall-clock `observedAt` that advances *without the content changing* — that is the
entire mechanism by which staleness becomes visible. Putting it inside a hash-deduplicated
payload leaves two bad options: include it in the hash and append a version row on every
heartbeat, or exclude it and have the observation silently dropped.

Beyond that, PRD 2.0 §14.3 specifies two distinct sequence fields (`snapshotSequence` *and*
`sourceRuntimeSequence`), which a single per-target version counter cannot represent; the task's
own Schema Impact says "new `PublicRuntimeSnapshot` table"; and `canonSnapshots` in
`convex/canon/schema.ts` is the in-repo precedent for a snapshot owning its table.

There is no duplicated projection pipeline: the payload is ART-115's already-validated
`PublicDynamicProjection`, narrowed.

`publicRuntimeSnapshots` is deliberately **absent** from `TablesToVacuum` in `convex/crons.ts`.
Vacuuming by `_creationTime` would delete a long-paused world's only remaining snapshot, which
is precisely the row this feature exists to keep serving.

## Reading

`getPublicRuntimeSnapshot({ worldId })` is a public query returning the envelope or
`null`. It reads `publicRuntimeSnapshots` and nothing else — no Canon read, no schedule read, no
provider call — so a visitor is served while the entire simulation is down.

The server clock is authoritative. This query used to accept an optional `nowMs`, which is the
value the freshness verdict is derived from; ART-128 (FR-O009) removed it, because a caller who
names the instant can make a stale snapshot report `live` or a current one report `stale`. The
pure `serveRuntimeSnapshot` keeps `nowMs` as a parameter so a test can still sit at a chosen
instant, and now rejects a non-finite one. See `docs/public-read-only-guarantee.md`.

The table starts empty and no history is backfilled, so the query returns `null` until the first
capture — the same contract as `getPublicDynamicProjection`.

## Out of scope

| Not built | Task |
|---|---|
| Renderer degradation ladder (dimming, badging, freezing on a verdict) | FR-O010 / ART-127 |
| Operator pause controls — `worldSchedules.status` is read-only input here | FR-Q002 |
| Analytics emission (`live_runtime_stale_seen`) | PRD §17, client-side |
| Scene spatial fields beyond `title`/`summary`/`sourceEventIds` | FR-O003 / ART-122 |
| Backfill of historic snapshots | Not planned |
