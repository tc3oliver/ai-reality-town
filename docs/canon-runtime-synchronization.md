# Canon/Runtime synchronization

FR-N006 / ART-117. Modules: `convex/visualRuntime/visualSyncPlanner.ts`,
`convex/publicRead/publicDynamicProjection.ts`, `convex/publicRead/liveStateFunctions.ts`.
Tests: `convex/publicRead/canonRuntimeSync.test.ts`.

Canon states a semantic fact — "Lin Yingxue is at the clinic". The viewer needs a journey: a
sprite that leaves the paper shop, walks a road, and arrives. Something has to turn the first
into the second, and PRD 2.0 §10.5 constrains how: there must be an honest in-transit phase,
and a character must never be published in two places at once.

**There is no synchronization mechanism.** No queue, no sync record, no retry counter, no
persisted movement phase. The projection is a pure function of accepted Canon plus an
instant, re-derived on every rebuild. This document explains why that is the stronger answer
and what the resulting contract obliges consumers to do.

## Why no `RuntimeSyncRecord`

PRD 2.0 §14.5 specifies a `RuntimeSyncRecord` table holding a per-command status, timestamps,
an error code and a retry count. It was specified against §15's imperative pipeline, before
ART-114 and ART-115 were built. What those tasks actually shipped is a different shape:

```
accepted Canon events + seed placements + nowMs
        -> planCharacterTrajectories()      (pure, total, no clock, no ctx)
        -> buildPublicDynamicProjectionResult()  (pure, allowlisted)
        -> the published liveState payload
```

Every arrow is a pure function. Nothing between Canon and the payload holds state, so there
is no state to fall out of sync, and correspondingly nothing to reconcile, retry or record.
The properties §14.5's table was meant to *operate* are instead properties the architecture
cannot violate:

| FR-N006 acceptance criterion | How it holds without a sync record |
|---|---|
| A Canon location change becomes a valid runtime destination | `visualSyncPlanner.ts` folds `character_location_changed` facts in `sequenceNumber` order and paths the last hop. A destination with no Location Visual Binding yields **no trajectory and a problem**, never a guessed position. |
| An in-transit state is visible while the character moves | The published `animationState` is `walking` while `nowMs < arriveAt` and `idle` after. Both `startedAt` and `arriveAt` are published, so the client re-derives the phase rather than trusting a stored one. |
| Located at the target only after arrival | See [The `semanticLocationId` rule](#the-semanticlocationid-rule) — the contract publishes the arrival instant, and the consumer gates the label on it. |
| Runtime failure never writes incorrect Canon | `convex/visualRuntime/` cannot import a Canon write path at all: `architecture/module-boundaries.json`'s `canonWriteBoundary`, enforced by `npm run check:architecture` and by `visualRuntime.purity.test.ts`'s import-graph walk. A bad write is a compile/CI failure, not a runtime risk. |
| Retries never create duplicate Canon events | Vacuous, and provably so: nothing on this path writes Canon. Re-deriving is idempotent by construction, and an unchanged world produces a byte-identical payload that the read-model store's `contentHash` deduplicates instead of appending a version row. |
| Never published at two locations at once | Three independent layers: the planner emits one unit per character id; `assertPublicDynamicProjection`'s `seen` set throws on a duplicate `characterId` on both write and read; the client collapses by highest `motionSequence`. |
| Stable error codes and observable metrics | `VisualRuntimeProblemCode` is a closed union, surfaced as counts — see [Operator signal](#operator-signal). |

Building the table anyway would have been a regression, not merely redundant work. It would
require publishing `movementPhase`, which means deleting it from
`PUBLIC_DYNAMIC_FORBIDDEN_FIELDS` and the leakage test that proves it cannot escape — widening
PRD §10.4's own contract past what the PRD specifies. Worse, it would create a second,
*writable* source of truth for movement phase, which can disagree with the derivation. That
disagreement is precisely the drift class §10.5 exists to prevent.

The table is therefore deliberately not implemented. `docs/prd-2.0-requirement-matrix.md`
records the same decision on the FR-N006 row.

## The `semanticLocationId` rule

> `semanticLocationId` is **the location this motion resolves to**, not necessarily where the
> character is standing right now.

A character's `semanticLocationId` becomes the destination the instant the Canon event is
accepted — while `animationState` is still `walking`, `from !== to`, and `nowMs < arriveAt`.
This is correct: Canon's statement *is* already true, and only the visual walk is outstanding.
But it makes the field unsafe to read as a position.

**Any consumer rendering a location LABEL must gate on arrival**, using either:

- `nowMs >= arriveAt`, or equivalently
- `animationState !== 'walking'`.

Before that point the honest caption is "heading to X", never "at X". Rendering the latter
puts a caption on a sprite the viewer can see is still mid-road, which PRD 2.0 §10.5 forbids.
Consumers reading `semanticLocationId` for the map *position* need no such gate — `from`,
`to`, `startedAt` and `arriveAt` already describe the interpolation completely.

`convex/publicRead/canonRuntimeSync.test.ts`'s AC#3 block pins this behavior so a later edit
cannot quietly change it.

### Known consumer: `worldCharacterProjection.ts`

`convex/publicRead/worldCharacterProjection.ts` publishes Canon's `currentLocationId`
directly, with no in-transit qualifier. It is a separate projection with its own Canon-derived
truth, and it is **not** wrong — but it answers "where does Canon say this character is",
which is not "where is this character standing".

Today this is latent rather than live: `currentLocationId` is typed in
`src/components/public/characterRoute.ts` and not yet rendered. ART-124's character card is
the first page that will render it. When it does, it must reconcile against the Dynamic
Projection's `arriveAt` for the same character before captioning a location, or it will
display "at the clinic" beside a sprite that is visibly still walking there. ART-119's
transit labelling faces the same obligation from the other direction.

ART-117 deliberately did not change `worldCharacterProjection.ts`. Adding an in-transit
qualifier there would put movement phase into a second projection, re-creating the dual source
of truth this design avoids. The rule belongs to the consumer that composes the two.

## Operator signal

`planCharacterTrajectories` returns `problems` alongside its trajectories: one
`VisualRuntimeProblem` per character it could not place, each carrying a stable code.

| Code | Meaning | Effect on the payload |
|---|---|---|
| `VISUAL_RUNTIME_UNBOUND_LOCATION` | The Canon location has no active Location Visual Binding. | The character is **omitted** — no position can be published without inventing one. |
| `VISUAL_RUNTIME_NO_PATH` | The collision layer offers no walkable route. | The character is placed at the destination, standing, with no animated walk. Degraded, not faked. |

Before ART-117 this list was computed and discarded. A character could vanish from the map
because someone forgot a binding, and nothing anywhere recorded that it had happened.

`buildPublicDynamicProjectionResult` now returns a `RuntimeProblemSummary` next to the
projection, and `rebuildLiveProjection` includes it in its result:

```ts
{
  modelRef, version, deduplicated,
  dynamicCharacterCount,
  dynamicProblemCount,                 // total, across all codes
  dynamicProblemsByCode,               // e.g. { VISUAL_RUNTIME_UNBOUND_LOCATION: 1 }
}
```

Two deliberate constraints:

- **The summary is a sibling of the projection, never a field of it.** `problems` is named in
  `PUBLIC_DYNAMIC_FORBIDDEN_FIELDS`; it is an operator concern, and a viewer has nothing to do
  with the fact that a binding is missing.
- **Counts, not records.** The individual problems name `characterId`s. The summary travels
  back through a mutation result, which is easier to keep dull than to keep private.

**ART-133** (FR-Q001, the operator metrics dashboard) is the intended consumer.
`dynamicProblemCount > 0` is the alertable condition: it means the published payload is
missing characters, or showing them without the walk that got them there. The by-code
breakdown distinguishes the two causes, which have different fixes — an unbound location is a
binding-authoring gap, a missing path is a collision-layer gap.
