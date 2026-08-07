# Visual Runtime and movement trajectory planner

FR-N010 / ART-114. Module: `convex/visualRuntime/`.

Canon says *where a character is* in semantic terms — "Wu Zhen is at `mistwood-square`". It says
nothing about coordinates, and PRD 2.0 §10.6 requires that it never does. The Visual Runtime owns
the other half: turning that semantic fact, plus the Location Visual Bindings from ART-110, into
the motion the viewer draws.

It is a pure function. `planCharacterTrajectories(input)` takes accepted events, seed placements,
a walkable grid, the bindings and an explicit planning instant, and returns a snapshot. There is
no `ctx`, no database handle, no clock and no provider anywhere in its dependency graph.

## The trajectory contract

`planCharacterTrajectories` returns a `VisualRuntimeSnapshot`: exactly one `MovementTrajectory`
per character it can place, plus a list of `VisualRuntimeProblem`s for the ones it cannot.

| Field | Meaning |
|---|---|
| `characterId`, `mapId` | Who, and which map the coordinates are measured against. |
| `motionType` | `bootstrap` (no accepted event yet) or `canon` (derived from a fact). `ambient` and `replay` are declared for ART-120 / ART-121 and are never produced here. |
| `movementPhase` | `bootstrap`, `in-transit`, or `arrived`, decided against the supplied `nowMs`. |
| `from`, `to` | Tile coordinates. `to` is always inside the zone `semanticLocationId` names. |
| `startedAt`, `arriveAt` | The source event's `acceptedAt`, and that plus the travel time. `arriveAt >= startedAt` always. |
| `direction`, `animationState` | What sprite to draw: one of eight compass directions, and `idle` or `walking`. |
| `motionSequence` | Monotonic per character. `0` for a bootstrap, `sequenceNumber + 1` for a fact. |
| `semanticLocationId`, `originLocationId` | The Canon locations the motion ends at and started from. |
| `waypoints` | Route points with the instant each is reached. The client interpolates between them. |
| `sourceEventIds` | The accepted events this motion was derived from; empty for a bootstrap. |

Coordinates are map tile coordinates, the same space as `data/mistwood.ts` and the location
bindings: tile `(tx, ty)` covers `(tx, ty)`–`(tx + 1, ty + 1)`, and a character standing on it sits
at `(tx + 0.5, ty + 0.5)`.

### Invariants

1. **Exactly one unit per character.** Two units would let the viewer see one person in two places.
2. **`motionSequence` never regresses.** It is derived from the source event's sequence number, not
   from a counter, so re-deriving an older prefix of history cannot hand a client a higher sequence
   than the one it already holds.
3. **`arriveAt >= startedAt`.**
4. **Every `to` satisfies `hasArrivedAtLocation`.** Arrival means containment in the bound polygon,
   never equality with a stored coordinate.
5. **Same input, same bytes.** Verified by re-deriving each fixture and comparing serialisations.

## The anchor chain

A character's current position depends on where its previous move left it. So the planner replays
each character's `character_location_changed` facts in `sequenceNumber` order and walks an *anchor
chain*:

1. **Chain head.** The seeded bootstrap anchor if the character has a seed placement; otherwise the
   seeded anchor of the first fact's `fromLocationId`.
2. **Each intermediate fact** moves the head to that location's anchor, resolved with **that fact's
   own `worldDay` and `timeSlot`** — not the current clock. Keying the chain off "now" would make
   yesterday's arrival point drift every time the world advanced, and the walk in progress would
   start from a place the character was never drawn standing in.
3. **Only the last fact is pathed.** The earlier hops are history; they exist purely to find the
   origin point of the hop that is actually happening. This is what keeps the cost of a read
   proportional to the number of characters rather than to the length of history.

`sequenceNumber` is used for ordering rather than `acceptedAt` because it is the only total order
Canon guarantees. The planner therefore does not care what order the caller read the events in.

### Cases

| Situation | Result |
|---|---|
| No fact, seed placement present | Bootstrap: `idle`, `from === to`, `motionSequence` 0, `sourceEventIds` `[]`. |
| Last fact, `nowMs < arriveAt` | In transit: `walking`, `from` = chain head, `to` = destination anchor, full waypoints. |
| Last fact, `nowMs >= arriveAt` | Arrived: `idle`, `from === to` at the destination. |
| Destination location unbound | No trajectory at all, plus a `VISUAL_RUNTIME_UNBOUND_LOCATION` problem. |
| No walkable route | Retry against the zone's `entryAnchors` (at most four attempts total); if all fail, an arrived unit at the destination plus a `VISUAL_RUNTIME_NO_PATH` problem. |

Problems are returned, not thrown: one unbound location must not stop the other eleven residents
being drawn. But an unbound *destination* publishes nothing, because a guessed position would put a
character somewhere Canon never said they were.

The no-path degradation deliberately does **not** animate a walk. A `canon` walk is never drawn
through a wall; the character simply appears where Canon says they are, and the problem is reported
so the map or the bindings can be fixed.

### Pathfinding determinism

`pathPlanner.ts` is a 4-connected A* with a Manhattan heuristic — admissible and consistent for unit
step costs, so the first path found is optimal. The usual source of nondeterminism in A* is ties: two
nodes with equal `f` can be surfaced in either order depending on heap internals. The open set is
therefore ordered by a **total** key — `f`, then `h`, then `y`, then `x` — on which no two distinct
tiles can tie. Neighbours are expanded in a fixed order and the node budget is `width * height`.

Two runs over the same grid produce byte-identical paths, which is what stops a character drifting
when a second server or a client re-derives the same trajectory.

## The seeded anchor algorithm

Ambient placement must look varied without *being* random: no coordinate is ever written back to the
backend to reconcile a disagreement, so every derivation has to agree independently.

```
key   = characterId ␀ locationId ␀ worldDay ␀ timeBucket      (␀ = NUL, U+0000)
value = FNV-1a 32-bit over key
anchor = binding.ambientAnchors[value % binding.ambientAnchors.length]
```

NUL is the delimiter because it cannot appear in a Canon id; `|` or `:` could, which would let two
different seeds collide on one key.

`timeBucket` comes from `timeBucketForSlot()` (the index of the Canon time slot) for Canon-derived
motion, or `timeBucketForInstant()` (a one-minute bucket of an explicitly supplied instant) for the
ambient drift FR-O011 will build on. Neither reads a clock.

### Golden vectors

FNV-1a 32-bit, pinned in `seededRandom.test.ts`:

| Input | Hash |
|---|---|
| `""` | 2166136261 |
| `"mistwood"` | 914440865 |
| `wu-zhen ␀ mistwood-station ␀ 0 ␀ 0` | 951869534 |
| `lin-yingxue ␀ mistwood-inn ␀ 2 ␀ 3` | 811433193 |

Worked bootstrap examples against the real Mistwood bindings:

- `lin-yingxue` seeded into `mistwood-paper`. Hash 917250371, five ambient anchors,
  `917250371 % 5 = 1`, so the anchor is `{ x: 32.5, y: 4.5 }`.
- `su-meizhen` seeded into `mistwood-clinic`. Hash 3949955907, `% 5 = 2`, so the anchor is
  `{ x: 19.5, y: 23.5 }`.

`createSeededPrng()` is an xorshift32 used only by `selectAmbientAnchorSequence()`. Seed 0 is the
generator's fixed point and is remapped to the golden-ratio constant, so a hash that happens to land
on 0 still yields a usable stream.

## The bootstrap rule

`convex/publicRead/liveState.ts` derives its character set from location and life-change events
only. Mistwood's twelve seeded residents carry an `initialLocationId` in their `worldCharacters`
payload, but Canon emits no event at world init to restate it — so a freshly seeded world would
publish no position for anybody until their first accepted event.

`seedBootstrap.ts` closes that gap by **derivation, not fabrication**:

- the position is computed on read from the seed payload plus the Location Visual Binding;
- **no synthetic `character_location_changed` event is written.** A Canon event that no provider
  proposed and no rule accepted would corrupt the append-only history the whole system is audited
  against;
- nothing is persisted, so there is no second source of truth to go stale;
- the anchor is keyed off `BOOTSTRAP_WORLD_DAY = 0` and `BOOTSTRAP_TIME_BUCKET = 0`, and the
  timestamps off `BOOTSTRAP_INSTANT_MS = 0`, so the position is stable before the world has a day or
  a slot and a static character does not twitch between derivations.

A seed placement is a *default*, never an override: the moment a character has an accepted location
fact, the fact wins, and `motionSequence` (`sequenceNumber + 1`) always outranks the bootstrap's `0`.

## Why the module imports neither `convex/canon` nor `convex/util`

FR-N010 AC#2 and AC#3 require that the runtime contains no LLM call path and never writes to the
Canon event store. Stating that as "no Canon *write* import" would still leave a read edge that a
later refactor could widen, so the module has no Canon edge at all — `AcceptedEventLike` is declared
structurally in `visualSyncPlanner.ts`, and a real `AcceptedEvent` satisfies it without the
dependency arrow ever pointing at Canon.

`convex/util` is excluded for a subtler reason. The repository boundary checker only compares
*declared module roots*, and `convex/util` is owned by no module — an import into it would pass
unnoticed. So the binary heap in `pathPlanner.ts` and the FNV-1a hash in `seededRandom.ts` are
written out here rather than imported from `convex/util/minheap` and `convex/canon/snapshots.ts`.
The duplication is the point: it is what makes the dependency surface checkable.

The one exception is `mistwoodRuntime.ts`, the single leaf that knows a concrete map exists. It
imports `data/mistwood` and the Mistwood location bindings, and those bindings read the Canon seed
for their labels. Keeping that edge in one leaf file — which the planner does not import — is what
keeps the planner's own closure provably Canon-free.

### How this is enforced

Three independent checks, because each catches what the others miss:

1. **`visualRuntime.purity.test.ts` — exact per-file import allowlist.** Adding *any* dependency to
   the module fails here first, so widening the boundary has to be deliberate.
2. **Forbidden-token scan** of each file's source (comments stripped): `convex/_generated`,
   `internalMutation`, `mutation(`, `ctx.db`, `insert('canonEvents`, `commitProposedEvent`,
   `reduceWorldEvent`, `util/llm`, `simulation/providers`, `openai`, `anthropic`, `generative-ai`,
   `fetch(` — plus `Date.now`, `Math.random`, `process.env` and `crypto.getRandomValues`. This
   catches a write reached through a namespace or a string rather than a direct import.
3. **A transitive walk of the planner's real import graph**, breadth-first from
   `visualSyncPlanner.ts`, asserting that nothing reachable lives under `convex/canon/`,
   `convex/util/` or `convex/simulation/providers/`, that every specifier is relative (the runtime
   has no package imports at all), and that the closure is exactly the eight expected files.

On top of that, `architecture/module-boundaries.json` declares
`visualRuntime` with `mayDependOn: ["visual", "shared"]` — Canon is omitted entirely — and a
`canonWriteBoundary` section that `scripts/architecture/check-boundaries.mjs` enforces two ways:
a forbidden module may not import a declared Canon write path, and no file under a forbidden
module's roots may so much as name `internalMutation`, `ctx.db.insert`/`patch`/`replace`/`delete`,
`canonEvents`, `commitProposedEvent`, `validateAndCommitProposedEvent`, `reduceWorldEvent`,
`seedWorldCharacters` or `importWorld`. `npm run check:architecture` fails the build otherwise.

## Testing without a provider

`fixtures.ts` is source, not test code: FR-N003's projection and FR-N006's sync state machine both
need a world they can plan against without a provider, a database or a network call, and duplicating
these shapes in each of their test files would let them drift apart.

- `MISTWOOD_SEED_PLACEMENTS` — the twelve `id` / `initialLocationId` pairs, mirrored from
  `convex/canon/mistwoodSeed.ts` and pinned against it by `fixtures.test.ts`.
- `createZeroEventFixture()` — a freshly seeded world with no accepted history.
- `createSingleMoveFixture()` — one resident walking the station-to-square road.
- `createMultiHopFixture()` — three hops for one resident across two world days.

Each takes an optional planning instant so a test can step across an `arriveAt` boundary. Every
other value is fixed, so a fixture planned twice produces the same bytes.

## Out of scope

The published projection contract has since landed — see `docs/public-dynamic-projection.md`
(FR-N003 / ART-115) for the field whitelist that narrows a `MovementTrajectory` down to the
PRD 2.0 §10.4 `PublicCharacterMotion` this module's output is published as.

Still out of scope here: the Canon–Runtime sync state machine
(FR-N006 / ART-117), ambient behaviour semantics beyond anchor *selection* (FR-O011 / ART-120),
client interpolation and rendering (FR-O002 / ART-119) and Visual Replay (ART-121). No trajectory
table is persisted: trajectories are computed on read, which avoids both a second stale source of
truth and a write path in a module that is meant to have none.
