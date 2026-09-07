# Incremental recap pyramid

`convex/recaps/` implements FR-G002 and the Section 13.11 Recap Snapshot
contract. The five persisted summary layers are `scene`, `episode`, `arc`,
`season`, and `viewer_context`; raw Accepted Events remain the source beneath the
pyramid.

Each versioned snapshot records its ID, world, type, target, first and last source
Event IDs and sequence numbers, content, structured provenance payload, version, and
generation time. The payload retains the complete ordered source Event IDs, the IDs
added by the current update, the prior snapshot ID, and whether the version was an
incremental update or explicit regeneration.

## Which levels the live pipeline drives

All five, since ART-164. `deriveRecapTargets` emits one `scene` target per time slot, one
`episode` target per world day, one `arc` target for each arc the committed event actually
*moved*, one `season` target per fixed ten-world-day window, and one `viewer_context` target per
world.

Before ART-164 it emitted `episode` and `viewer_context` only, so `scene`, `arc` and `season`
snapshots existed for no world despite being declared, implemented and unit-tested. The long-run
harness recorded this accurately — it asserted a live run produced exactly those two types — and
passed for as long as three levels were dead.

The arc target is driven by the arcs the event moved rather than by all active arcs: an arc that
did not move has nothing new to summarise, and requesting one would append a version recording no
progress. An arc named by a classification whose projection did not change is a skip, not an
error; membership and progress are different things.

A season is a fixed window (`SEASON_WORLD_DAYS`), not a story judgement, so which season an event
belongs to is derivable from the event alone and a replay cannot re-file it.

## Contiguous and selective sources

Two source contracts, chosen by tier.

**Contiguous** (`scene`, `episode`, `season`, `viewer_context`) — the summary covers every accepted
event in its range, so the event window *is* the source range and it must have no gaps. Unchanged
from ART-34.

**Selective** (`arc`) — an arc's events are scattered through canon among every other arc's, so its
sources are inherently sparse and the contiguous rule would reject every honest arc summary. Such a
snapshot carries a `sourceScope`: the range that was *examined*, while `structuredPayload.newEventIds`
records what was *found* in it. Keeping both is what makes "this arc did nothing between sequence 40
and 90" distinguishable from "nothing between 40 and 90 was ever looked at"; without it a sparse
recap could skip events and look identical to one that had none to skip.

Gaps are legal in a selective window, but the events must still ascend, be unique, and lie inside
the declared scope, and a target may never change between contiguous and selective — that would
leave one target's history half-checked and its cursor read off two different fields.

Arc sources are the events that moved that arc's *projection*, read from
`storyArcProjectionEvents` by the arc's own index and walked newest-first to the cursor, so the read
is proportional to that arc's delta. Scanning canon and filtering by membership is the obvious
alternative and is the O(world history) pattern ART-100 removed from this pipeline.

## Incremental update

Normal updates load the latest target snapshot and query `canonEvents` only from the cursor through
the requested endpoint. The builder requires that new Accepted Events are contiguous and
immediately follow the prior range; for a selective tier that continuity is checked on the *scope*
instead, because the guarantee is that no stretch of canon went unexamined, which is not the same
as the events being adjacent.

The cursor is `recapCursorOf`: the scope end where a target has one, and the last source sequence
number otherwise. For a selective tier the last event that matched can sit behind the range that
was scanned, and resuming from the match would re-examine a stretch already known to hold nothing
for that target. The two answers coincide for almost every live snapshot, so no pipeline test can
tell a wrong rule from a right one — hence one named function, one direct test, and all three ports
reading it.

Cursors are loaded per target, one point read each. They were previously read from a `.collect()`
of every recap snapshot in the world on every event; with per-slot and per-arc targets that would
grow with days times slots.

The first version also requires an explicit bounded start and end sequence. Foreign,
duplicate, gapped, proposed-shaped, or mismatched source values fail validation.
Reusing a snapshot ID with different generation inputs is an idempotency conflict.

## Regeneration and audit

Explicit regeneration queries the complete Accepted Event range represented by the
latest snapshot and appends a new version. Previous versions remain unchanged and
queryable in ascending version order. Both generation modes write only
`recapSnapshots`; neither imports nor invokes Canon commit or reducer paths.

Run focused verification with:

```bash
npm test -- --runTestsByPath convex/recaps/model.test.ts
```

The suite covers every pyramid layer, all required fields, exact Accepted Event
provenance, bounded incremental updates, invalid sources, regeneration history,
internal-only persistence, and Canon isolation.
