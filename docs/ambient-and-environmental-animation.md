# Ambient movement and environmental animation (FR-O011 / FR-O012, ART-120)

Canon advances five times a real day. Between two accepted events the world has nothing new to
say for roughly 4.8 hours, and a purely Canon-driven map is a still photograph for all of it.
PRD 2.0 §9.1.2 and §9.1.3 permit narratively meaningless activity to keep the town alive —
under limits, because RISK2-008 warns that ambient motion must never be mistaken for plot.

This document is how those limits are enforced, and which of them are enforced by a test
rather than by discipline.

- Client derivation: `src/components/world/ambientMotion.ts`
- Boundary guard: `src/components/world/ambientMotion.boundary.test.ts`
- Shared kernel: `convex/visualRuntime/{seededRandom,ambientAnchor,motion}.ts`
- Zone anchors: `data/mistwoodAmbientAnchors.ts`
- Day/night wash: `src/components/world/{dayNightTint.ts,DayNightLayer.tsx}`
- Producer side: [`visual-runtime-trajectory-planner.md`](./visual-runtime-trajectory-planner.md),
  [`public-dynamic-projection.md`](./public-dynamic-projection.md)
- Canon-driven motion, which this sits beside:
  [`character-motion-rendering.md`](./character-motion-rendering.md)

---

## 1. Why ambient drift is derived on the client

This is the one architectural decision the whole feature turns on, so it is stated first.

`getPublicDynamicProjection` serves a **stored** payload. It is rebuilt when Canon commits, or
by the hourly snapshot-capture cron — neither of which runs at minute cadence — and
`commitReadModelVersion` deduplicates on a `contentHash` computed over the payload's contents.
Every root field of the projection is Canon-derived for exactly this reason: `updatedAt` and
`snapshotSequence` come from the last accepted event, not from a clock, so an unchanged world
re-derives byte-identically and appends no version row.

Baking a per-minute ambient coordinate into that payload would defeat the deduplication *by
construction*. Every rebuild would produce a different hash, and an idle world would append
roughly 1,440 spurious read-model version rows a day, each one recording that somebody had
taken three steps and stopped.

So the responsibility is split:

| | Server (`visualSyncPlanner.ts`) | Client (`ambientMotion.ts`) |
|---|---|---|
| Publishes | `motionType: 'ambient'` — *drift is permitted here* | nothing |
| Publishes | `worldDay`, `timeSlot` — the seed | nothing |
| Computes | the Canon anchor the character stands on | the drift around it, per frame |
| Cadence | when Canon commits | the animation clock |

The client re-derives the drift using the Visual Runtime's *own* seeded primitives, imported
rather than reimplemented. That is what makes two viewers agree without either of them writing
a coordinate anywhere.

`canonRuntimeSync.test.ts`'s `FR-O011 AC#2` block pins the result: three rebuilds spanning
four hours of ambient time produce one stored row and zero Canon writes, and the payload
derived at the start is `toEqual` the payload derived at the end.

## 2. The seed contract

Ambient behaviour is a pure function of four values, exactly the four PRD 2.0 §9.1.2 names:

```
seed = (characterId, locationId, worldDay, timeBucket)
```

- `characterId` and `locationId` come from the published motion unit.
- `worldDay` is the new optional root field on the projection, taken from the last accepted
  event. A world with no history has no day, and the client seeds from `0` rather than
  inventing one.
- `timeBucket` is `floor((nowMs + phaseOffset) / 60_000)`. One minute is long enough that a
  viewer sees a character settle somewhere rather than pace.

`phaseOffset` is `ambientPhaseOffsetMs(characterId, locationId)`, a per-person, per-zone shift
of the bucket grid. Without it all twelve residents' buckets turn over on the same instant and
the town stands up in unison, which reads as a chorus line.

### Why the anchor order is an arithmetic step

The anchor a character rests on in bucket `n` must be computable **from `n` alone**: a viewer
opens the live map at an arbitrary minute and has to agree instantly with everyone already
watching. ART-114's `selectAmbientAnchorSequence` cannot do that — it walks a stateful PRNG
from a fixed origin, so bucket 29,148,033 would cost 29,148,033 draws.

The replacement, `selectAmbientAnchorForBucket`, is:

```
base   = hash(characterId, locationId, worldDay, "base")   mod L
stride = hash(characterId, locationId, worldDay, "stride") mod (L - 1) + 1
index  = (base + n * stride) mod L
```

`stride` is in `[1, L-1]`, so `index(n) - index(n-1) ≡ stride ≢ 0 (mod L)`: **the anchor never
repeats between consecutive buckets**, algebraically, at O(1) cost. Standing still through two
buckets would read as a frozen character rather than an idling one, so the property matters.

A per-bucket redraw with a one-step look-back was considered and rejected. Patching `h(n) mod L`
by comparing against bucket `n-1`'s hash only moves the collision one step, because `n-1`'s
adjusted index was itself derived by looking back at `n-2`; an exact guarantee that way needs
unbounded recursion, which is the very thing a stateless per-bucket draw exists to avoid.

The cost is that within one world day one character's anchor order is a rotation rather than a
fresh draw. At a minute per bucket a viewer would have to watch one resident for five minutes
to notice, and the day turn reshuffles both `base` and `stride`. Variety *within* a bucket —
when the character sets off, and so how long it stands at each end — is hashed from all four
seed components, so consecutive buckets do not look mechanical even where the order is regular.

## 3. Why ambient movement cannot leave the zone (AC#1)

By geometry, not by pathfinding:

1. `locationVisualBinding.ts`'s `validateLocationVisualBindings` asserts every ambient anchor
   lies inside its own `zonePolygon` (`assertPointInZone`), at import time.
2. It also asserts every `zonePolygon` is convex (`isConvexPolygon`) — a constraint that
   already existed so arrival and overlap could stay exact arithmetic.
3. A convex set contains the segment between any two of its points.

The client interpolates in a straight line between two anchors of one zone. Therefore every
intermediate position is inside that zone, for every value of `nowMs`, with no A* and no
runtime containment check. `ambientMotion.test.ts` samples all eight zones × all anchor pairs ×
26 points and re-asserts it, so the proof fails loudly if either assumption is ever weakened.

**Known limitation, not hidden.** A straight line between two anchors is provably in-zone but
can cross a *blocked prop tile* inside the zone — a table, a crate — so a character may briefly
clip one. Mistwood's zones are small and mostly open, so v1 accepts it. The upgrade path is a
precomputed in-zone route per anchor pair, cached alongside the anchors in
`data/mistwoodAmbientAnchors.ts`; it needs no new published field and no server change.

## 4. Eligibility, and what stays out of it

`settledTrajectory` in `visualSyncPlanner.ts` is the only planner change: a character that has
finished a Canon walk is now `motionType: 'ambient'` instead of `'canon'`. The in-transit
branch is untouched.

`bootstrapTrajectory` deliberately stays `'bootstrap'` → public `'idle'`. A seeded character
who has never moved is a genuinely different state from one who has arrived somewhere, and
folding the two together would delete a legible signal for no visual gain. The **client** gate
is therefore a superset — `{'ambient', 'idle'}` both drift — because to a viewer both are a
person standing inside a Canon zone, and freezing the twelve founding residents until Canon
first moved them would leave the map dead on day one.

`deriveAmbientPose` returns `null`, in this order, and each `null` is a different promise:

| Order | Condition | Promise |
|---|---|---|
| 1 | Reduced Motion | AC#8. First, so no later branch can leak motion past it. |
| 2 | `motionType` not eligible | A `canon` or `replay` unit is a published fact being animated. |
| 3 | `nowMs < arriveAt` | A real walk is never interrupted by drift at its own destination. |
| 4 | fewer than two anchors | Nowhere to drift; stand at the published position. |

## 5. Visual distinction from Canon movement (AC#6)

Four cumulative signals, **no new art** (PRD 2.0 §6 forbids it):

| # | Signal | Where | Pinned by |
|---|---|---|---|
| 1 | **Speed** — 0.4 tiles/s vs Canon's 0.75 | `motion.ts` | `ambientMotion.test.ts` |
| 2 | **Gait** — animation speed 0.06 vs 0.12, so the feet keep time with the distance | `characterAnimation.ts` | `characterStateIndicator.dom.test.tsx` |
| 3 | **Extent** — bounded by one zone's diagonal; a Canon walk crosses the map | geometry | `ambientMotion.test.ts` |
| 4 | **Marker** — a faint dwell ring at the character's feet | `characterAnimation.ts` | `characterStateIndicator.dom.test.tsx` |

The marker sits *under* the character, not overhead. The three ART-119 indicators all float
above the head and all mean "something narratively meaningful is happening here"; ambient drift
means precisely the opposite, so a fourth badge in the same place would say the wrong thing in
the right shape. A soft mark on the ground reads as "lingering", which is what it is. The
published state always wins: a drifting character that is also `speaking` shows the speech
bubble, and ambient only ever fills the gap where there was no marker at all.

**Explicitly rejected: alpha or tint reduction on the character sprite.** A half-transparent
resident reads as a ghost, a loading state or a rendering fault — and since characters are
ambient-eligible for hours at a time between Canon commits, the whole town would look broken
for most of the day.

## 6. RISK2-008 mitigations, each mapped to its enforcing test

RISK2-008 is "ambient motion is mistaken for plot". Every mitigation below is a test, not a
paragraph.

| Mitigation | Enforced by |
|---|---|
| Ambient creates no accepted event and no Canon write | `canonRuntimeSync.test.ts` — *ambient eligibility writes nothing, anywhere* (Canon snapshot identity across rebuilds) |
| Ambient adds no read-model version | same block — three rebuilds four hours apart, one stored row |
| Ambient never changes `semanticLocationId` | `worldViewModel.test.ts` — *never changes the Canon location, however far the character drifts* |
| **Ambient never moves the camera** | `worldViewModel.test.ts` — *the camera cannot see the drift at all*: `focusTargetsFrom` output is identical with and without 30 s of drift, and the test proves the drift is real so the equality is not vacuous |
| Ambient never redirects the story | `primaryLocationId` reads `semanticLocationId`; asserted in the same test |
| Ambient never starts a conversation | `ambientMotion.boundary.test.ts` — no conversation, message or write symbol exists anywhere in the module's bundled closure. The a16z chat engine was retired in ART-112, so the criterion is met by absence, and this asserts the absence |
| Ambient cannot leak private Canon data | `ambientMotion.boundary.test.ts` — the bundled closure is exactly three files, and never `mistwoodRuntime.ts` → `mistwoodLocationBindings.ts` → `mistwoodSeed.ts` |
| The day/night wash asserts no world time nobody accepted | `environmentAnimation.dom.test.tsx` — no slot means no wash; an unknown slot means no wash; the wash is a function of the published `timeSlot` and there is no clock read anywhere in the module |

The camera one deserves its own note. It holds *by construction* — `LiveMapPage` memoises the
camera targets on the projection while memoising the view model on the clock, and
`focusTargetsFrom` interpolates the published `from`/`to`, which drift never touches. It is
pinned by a test anyway, because a plausible future refactor ("just feed the view model's
positions to the camera") would make the camera chase a resident pottering about and the whole
town would look like it was mid-crisis.

## 7. The `clientWorldReadOnly` boundary widening

`architecture/module-boundaries.json` now lets `src/components/world/` depend on
`visualRuntime`. This is the most dangerous edit in ART-120 and it is deliberately narrow.

The danger is that `visualRuntime` is **not uniformly safe to ship**:

```
convex/visualRuntime/mistwoodRuntime.ts
  → convex/visual/mistwoodLocationBindings.ts
    → convex/canon/mistwoodSeed.ts   ← privateProfile, privateGoal, fear, secretContents ×12
```

The boundary checker compares declared module roots, so it cannot tell those three files apart
from the three safe leaves. `ambientMotion.boundary.test.ts` can, and does: it walks the real
import graph and asserts the **bundled** closure (value imports only — type imports are erased
and cannot reach the browser) is exactly

- `convex/visualRuntime/ambientAnchor.ts`
- `convex/visualRuntime/motion.ts`
- `convex/visualRuntime/seededRandom.ts`

and nothing else, ever. Adding a fourth import fails the test. **Do not widen this without that
guard, and do not widen it beyond those three files.**

Verified in the shipped artefact, not only in the graph: `grep` over `dist/assets/index-*.js`
finds zero occurrences of `privateProfile`, `privateGoal`, `secretContents`, `mistwoodSeed` or
`planCharacterTrajectories`, and one occurrence of the ambient kernel's own error code.

### Why the anchors moved to `data/`

The client needs the eight zones' standing positions. Importing
`convex/visual/mistwoodLocationBindings.ts` to get them would have opened exactly the path
above, so the derivation — entry-tile detection, in-zone BFS reachability, farthest-point
anchor spread — moved to `data/mistwoodAmbientAnchors.ts`, the boundary-neutral layer both
sides already share (the same mechanism ART-119 used for the sprite roster). `publicLabel` is
Canon-sourced and stays in `convex/visual/`, which imports the anchors back — so there is still
exactly one derivation, not two that can disagree about where somebody is standing.

`mistwoodLocationBindings.test.ts` pins all eight zones' anchors literally against the values
the pre-move code produced, and asserts the binding and the client table are the *same object*,
not merely equal ones.

## 8. Environmental animation (FR-O012)

### In scope

| Element | How | Asset |
|---|---|---|
| Water | `gentlewaterfall` above and below the mill race, joining ART-109's existing `gentlesplash` | approved, was unused |
| Fire and smoke | `campfire` at the inn's cook pot, the square's market brazier, the hall's courtyard brazier | approved, was **entirely unused** |
| Sparkle | `gentlesparkle` — orchard dust, Chronicle ink motes | approved, was unused |
| Lighting / day-night | one full-map `Graphics` rectangle tinted by the published `timeSlot` | none needed |

Every placement sits on a tile the collision layer **already** blocked. Two things follow: no
character can stand inside a fire or a waterfall, and — because ART-120's ambient anchors are
derived from that same collision layer — adding the decoration moved nobody.
`data/mistwood.test.ts` asserts both.

The day/night wash is driven by the Canon `timeSlot` and **never by a wall clock**. A
clock-driven cycle is the obvious implementation and is a direct RISK2-008 violation: Mistwood
advances on Canon's schedule, not the viewer's, so a wall-clock tint would show the town at
dusk while the last accepted event says it is noon — the map asserting a world fact nobody
accepted. It is also free: `timeSlot` changes at most five times a day, so the draw callback is
stable for hours.

### Descoped, with reasoning

PRD 2.0 §9.1.3 says environmental animation *may* include these, so deferring them is
PRD-legal. Each is deferred for a stated reason, not silently dropped:

| Element | Why deferred |
|---|---|
| **Weather** (rain, snow, fog) | Two independent blockers. No approved asset exists — and more importantly, **Canon models no weather fact**. Inventing weather would have the map assert a world fact nobody accepted, which is a direct RISK2-008 violation. Revisit when Canon models weather, not before. |
| **Tree animation** | Would mean identifying tree tile indices in the tileset and re-blitting them per frame. That is new authoring work with no supporting asset, brittle against any tileset change, and it buys the least motion per unit of risk of anything on the list. |
| **Building ambience / window glow** | Feasible as a second `Graphics` overlay keyed to `timeSlot`, and genuinely nice. Cut as the lowest-value item once the four above were in; it needs no new decision, only time. |

### The Reduced Motion defect this fixed

`PixiStaticMap.tsx` set `autoUpdate = true` and called `play()` on every environmental sprite
**unconditionally**. `useReducedMotion` existed and was threaded to the camera and to nothing
else, so a viewer who had asked their whole operating system to stop animating things still got
a turning waterwheel and running water. This had been live since ART-113.

Fixed by threading `reducedMotion` from `ReadOnlyWorld` into the component and calling
`setEnvironmentAnimationPlaying`, which uses `gotoAndStop(0)` rather than a bare `stop()` —
stopping alone freezes a flame on whichever half-drawn frame it reached, which itself looks like
a rendering fault. The preference is re-read from the container inside the async
`Spritesheet.parse()` callback rather than captured, because that callback resolves after
`applyProps` may already have changed it.

`environmentAnimation.dom.test.tsx` calls the real exported function (a reimplementation in the
test would keep passing if the fix were reverted) and additionally asserts structurally that
`autoUpdate = true` and the unconditional `play()` do not come back.

## 9. What Reduced Motion does and does not do

Deliberately asymmetric, and worth stating because the asymmetry looks like an oversight:

| Thing | Under Reduced Motion | Why |
|---|---|---|
| Ambient drift | **off entirely** — never derived | It is decorative by definition; nothing is lost. |
| Environmental sprites | **stopped**, parked on frame 0 | Same. |
| Camera transitions | snap (`transitionMs === 0`) | ART-118. |
| Day/night wash | **kept**, static | A static colour wash is not motion. Removing it would drop a real signal about the world's state for exactly the viewers least able to pick it up elsewhere. There is no cross-fade to suppress — the tint only changes when Canon does. |
| Canon character interpolation | **kept** | ART-119's decision: freezing it would park a walking character mid-street and snap it to its destination on the next projection, which is precisely the teleport FR-O002 AC#6 forbids. |

## 10. Contract changes

`PUBLIC_DYNAMIC_RUNTIME_VERSION` is now `2`. Two **optional** root fields were added:
`worldDay` and `timeSlot`, both from the last accepted event, both absent for a world with no
history.

Optional and not required, on purpose: `selectPublicDynamicProjection` re-validates the stored
payload on every read, so a required field would reject every payload persisted before ART-120
— including the last-known-good version FR-O010 falls back to — and blank the live map for
every viewer until the next Canon commit rebuilt it, which is hours.

`timeSlot` is validated as a non-empty string rather than as an enum. Pinning Canon's five-slot
vocabulary into the public contract would turn "Canon grew a sixth slot" into a blank live map;
the same tolerant stance `timeBucketForSlot` already takes in the Visual Runtime.
