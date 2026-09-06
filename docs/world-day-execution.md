# Live world-day execution

ART-97 implements PRD FR-C001–FR-C005 and PRD Section 12 stages 1–10 as one runnable loop,
which is the Milestone 2 completion criterion "一個世界日可完整跑完".

`simulation/worldDayLiveFunctions:runQueuedWorldDaySlot` is the transactional entry point.
Given a world it takes the oldest reserved `scheduledSlots` row (or an explicit `slotId`),
transitions it to running, and drives the resumable orchestrator `executeWorldDay` through
its ten stages: load world state, apply scheduled environment events, load active Story
Arcs, generate the daily Director Plan, generate Character Intents, group intents into
scenes, simulate scenes, validate structured output, run Canon validation, and commit
accepted events. The slot is then completed with its committed event, or failed with a
stable error code. `maxSlots` runs consecutive slots so a whole world day executes in one
call. Stages 11–21 are the separate post-commit pipeline in `convex/operations/`; ART-98
chains both halves behind `operations/postCommitLiveFunctions:runLiveWorldDayCycle`, which
is the entry point to use when you want a full daily cycle rather than only the commit —
see [`post-commit-pipeline.md`](./post-commit-pipeline.md).

Each stage is a thin adapter over an already-tested capability — `parseAndValidateDirectorPlan`,
`validateCharacterIntent`, `groupCharacterIntents`, `simulateWholeScene`,
`validateEventStructure`, `validateCanon`, `commitProposedEvent`. What ART-97 adds is
building each capability's input from real world state (`convex/simulation/worldDayLive.ts`)
plus a deterministic, no-network, no-cost author (`convex/simulation/fakeSceneNarrator.ts`).
`FakeWholeSceneProvider` follows the `FakeSimulationProvider` idiom — same input, same
output, no key, no cost — but implements the vendor-neutral `LanguageModelProvider` port
that whole-scene simulation requires; the Phase-0 `FakeSimulationProvider` only proposes a
single movement event and cannot author a scene.

## Which author, and why the live path is two mutations and an action

`sceneAuthor` is a **required** argument. It used to be a default, and that is exactly how the
deterministic fake became the production author: `createWorldDayStageHandlers` was called with no
provider, so the choice was expressed by an absence and a reviewer saw no decision at all. ART-159
removed the default; `createWorldDayStageHandlers` now requires its provider argument, and a
binding that does not choose an author no longer compiles.

| `sceneAuthor` | author | shape | needs |
| --- | --- | --- | --- |
| `deterministic_fake` | `FakeWholeSceneProvider` | one mutation, one transaction | nothing |
| `preauthored` | the configured gateway, via an action | mutation → action → mutation | `LLM_*` in the Convex environment |

The live path cannot be one transaction, because **a Convex mutation may not perform network
I/O**. That is the whole reason ART-72's adapter sat unreachable for so long: there was no
seam to inject it through that could also make an HTTP call. So the slot is split, and only the
provider call leaves the transaction:

```
prepareQueuedWorldDaySlot   (mutation)  stages 1-6, claims the slot, stops at the network
       ↓  SceneAuthoringPlan
authorSlotScenes            (ACTION)    the provider, the route chain, the budget
       ↓  persisted scenes
runQueuedWorldDaySlot       (mutation)  stages 7-10: structural, Canon, safety, commit
```

`preauthored` authors nothing itself. A scene that is not already persisted raises
`SCENE_AUTHORING_DEFERRED` rather than falling back to the fake — a fallback there would put
invented text into Canon every time the gateway was down, which is worse than a failed slot.

Both halves of the split reuse ONE authoring loop (`authorSlotScenes`), so the live path and the
deterministic path cannot disagree about what "already authored" means. Provider construction
stays inside `convex/simulation/providers/`, the adapter root the architecture boundary reserves
for it — which is why the live action lives there too, and why post-commit is a separate call
(`simulation` may not depend on `operations`). That costs nothing: stages 11–21 were never a
callback on a slot's commits, they are a cursor over accepted events.

See [`openai-compatible-provider.md`](./openai-compatible-provider.md) for the route chain,
the failure classification and the deployment variables.

## What drives it (ART-160)

Two crons, and they are counterparts:

| cron | interval | what it does |
| --- | --- | --- |
| `tickAllPublicSchedules` | 1 min | RESERVES due slots (`queued` rows) |
| `driveLiveWorlds` | 2 min | DRAINS them: prepare → author → finalize, per world |
| `drainAllLivePostCommit` | 1 min | stages 11–21 over the accepted-event cursor |

Before ART-160 only the first existed, so a deployed world reserved slots forever and executed
none — draining them was an operator invoking three functions by hand.

### One claim per world, and why that is the whole story

`claimLiveSlot` gives a world exactly **one time-bounded claim**. A live lease means "someone is on
it"; an expired one means "take it over". That single branch answers every way the sequence can be
interrupted, because from the outside they are indistinguishable and the remedy is identical:

| interruption | what happens |
| --- | --- |
| duplicate cron or action delivery | second driver is told `busy` and does nothing |
| action never started | lease lapses, next tick takes over |
| action crashed or timed out | same |
| process restarted | same |
| authoring finished, finalize never ran | same — and the authored scenes are reused, not re-paid for |
| slot already reached Canon | the run short-circuits and commits nothing further |

`busy` means **do nothing** — explicitly not "take the next queued slot". World time is ordered, and
authoring slot N+1 against a world that slot N has not finished advancing produces scenes about a
state that never existed.

`LIVE_SLOT_LEASE_MS` is 12 minutes and **must exceed the platform's action ceiling** (Convex caps
actions at 10). A shorter lease would expire under a healthy run and let a second driver author the
same world — the exact double-spend the lease prevents. The cost is stated: a crashed driver's slot
is unavailable for up to that long.

Resuming is safe rather than tolerated: `executeWorldDay` restarts at its last completed
checkpoint, `authorSlotScenes` reuses persisted scenes, and `commitProposedEvent` dedups on
`idempotencyKey`.

A **paused** world is excluded when the driver lists worlds; an **emergency-stopped** one throws out
of `prepareQueuedWorldDaySlot` *before* anything is claimed, so a refused world is never left
holding a lease. A world that refuses is recorded and the tick moves on — one broken world must not
become a broken tick.

## Concurrency (ART-161)

`authorSlotScenes` runs a bounded worker pool sized by the world's `maxConcurrentCalls`.

An **unconfigured** limit (`null`, the policy default) means **1**, not unbounded. Reading "no
opinion" as "fan out over every scene at once" would make a world that never asked for concurrency
empty a shared key allowance in one burst.

Results are written **by index**, so commit order is scene order regardless of which provider call
returns first. That is load-bearing: Canon's sequence numbers would otherwise depend on gateway
latency, and a replay of the same slot could produce a different world.

A process-local pool bounds nothing on its own. What makes it sound is that a second driver for the
same world **cannot exist** — that is ART-160's lease. The durable `inFlight` counter in
`tokenBudgetCounters` remains the enforcement of record, evaluated on every reservation; the pool
exists so the gate is never asked to grant more than it would allow, which would turn a limit into
a stream of refusals.

## The automatic publication gate (ART-162)

`worldSchedules.publishEnabled` existed from ART-18 and gated nothing — written by the scheduler,
copied onto every reserved slot, read by no production code. It now has exactly one meaning, and
the asymmetry is the design:

> **It can SUPPRESS publication. It can never FORCE it.**

| | `publishEnabled = false` | `publishEnabled = true` |
| --- | --- | --- |
| simulation, Canon commit | unchanged | unchanged |
| Episode / Recap derivation | unchanged | unchanged |
| Safety + editorial lifecycle | unchanged, up to `ready` | unchanged |
| publication status | stops at `ready` | may advance through the lifecycle |
| Public Read Model | not updated | updated |
| what readers see | the last valid version, frozen | current |

`true` grants nothing on its own. It only declines to interfere: content still passes safety, is
still walked through the lifecycle by an authorized operator, and a `withheld` record is still
withheld. There is deliberately **no code path that reads this flag and advances a status**, so
"publishEnabled bypassed the safety gate" is not a bug that can be written without changing
`isPublicationEnabled`'s signature — it takes a schedule row and returns a boolean, with no record
in scope to promote.

### Two boundaries, and only two

- **`commitReadModelVersion`** — consulted *before* anything is read or written. That ordering is
  the requirement, not a detail: a gate that suppressed the insert but still demoted the current
  row would **blank** the public surface instead of freezing it.
- **`advancePublication`** — gates the single `publish` transition. `validate`,
  `begin_safety_review`, `pass_safety_review`, `resume_to_ready` and especially **`withhold`** all
  still run with the gate closed. Refusing to record a safety withhold because publication is
  paused would be a gate that made a world *less* safe while claiming otherwise.

`publicationEnabled` is on the `PublicReadStore` **port**, not an argument to
`commitReadModelVersion`. There are 28 projection writers; a parameter would put the same judgement
in 28 places and the twenty-ninth would forget it. It is required rather than optional, so a new
binding cannot enforce nothing by omission — which is precisely how this field came to gate nothing.

### An unscheduled world publishes

`worldSchedules` is written by the scheduler, so a fixture, an import or a warmup world has
expressed no opinion. Reading absent as suppressed would blank every read model in the offline gate.

## Who gets cast, and how a stranded character gets back in

Scene selection is neglect-first, then rotating. Locations that can hold a multi-character
scene rotate by slot ordinal so consecutive slots do not repeat the same cast, but **any**
location — including one holding a single character — jumps that rotation once its most
neglected occupant has gone longer than `MAX_SLOTS_WITHOUT_APPEARANCE` (one full world day)
without appearing in a committed scene.

That reservation exists because preferring multi-character locations is otherwise a stable
preference: on a seed where some location always holds two people, the solo path never runs
and a character the seed places alone starves forever. ART-60's 30-day harness measured
exactly that — five of Mistwood's twelve residents never appeared in any of 450 committed
scenes. ART-101 fixed it.

A neglected solo character who can reach a location someone else is standing in is planned
as a **travel scene**. FR-C002 requires every planned participant to already be at the scene
location, so the travel scene is planned at the character's **origin** and declares its
intent through `expectedStateChangeTypes: [… 'character_location_changed']` — the plan
schema is closed, so nothing is added to it. The intent stage re-derives the same
destination from the same stage-1 snapshot (`travelDestinationFor`: the connected location
holding the most other characters, ties by location ID) and issues an Intent whose
`desiredLocationId` is that destination, which `validateCharacterIntent` accepts because it
is reachable. FR-C004 grouping then places the Scene at the destination and may merge the
traveller into the residents' Scene there. At most `MAX_TRAVEL_SCENES_PER_SLOT` (one) scene
per slot travels, so a merged cast stays at `MAX_PLANNED_SCENE_PARTICIPANTS` + 1 = 5, inside
the FR-C004 limit of six.

The author never sees the world projection, so it cannot state the movement precondition
Canon requires (`fromLocationId` must equal the character's current location). The
orchestrator states it: `withArrivalStateChanges` prepends the
`character_location_changed` for any participant not yet standing where the Scene happens,
reading the same stage-1 snapshot the Director planned against. It stays a **proposal** —
it passes through `validateEventStructure`, `validateCanon` (connectivity, capacity, one
move per slot, participant membership) and `commitProposedEvent` like any other (ADR-0001).

Retries are safe because identity is derived, not allocated: the world-day Run ID, the
Director/Intent/Grouping/Simulation Run IDs, and every Proposed Event idempotency key come
from `(worldId, worldDay, timeSlot)`. A completed run short-circuits, an interrupted run
resumes at its last safe checkpoint, and a re-proposed event deduplicates at the Canon
commit boundary instead of appending a second event. Scene output classified as withhold or
human-review-required never reaches the commit stage.

On the `deterministic_fake` path everything runs inside one Convex mutation/transaction: the
author needs no network, so there is no action-then-mutation race. On the live path only the
provider call is outside a transaction — Canon validation, safety classification, idempotency and
the commit are all still inside one, and are the same code on both paths. Every entry point is
internal: public reads must never trigger generation.

```bash
npx convex run simulation/schedulerOperations:advanceOneWorldDay '{"worldId":"mistwood","now":0}'

# deterministic, offline
npx convex run simulation/worldDayLiveFunctions:runQueuedWorldDaySlot \
  '{"worldId":"mistwood","maxSlots":5,"sceneAuthor":"deterministic_fake"}'

# live, through the configured provider and route chain
npx convex run simulation/providers/liveWorldDayActions:runLiveWorldDaySlotWithProvider \
  '{"worldId":"mistwood","maxSlots":5}'
npx convex run operations/postCommitLiveFunctions:drainLivePostCommit '{"worldId":"mistwood"}'
```

Focused verification:

```bash
npm test -- --runTestsByPath convex/simulation/worldDayLive.test.ts
npm test -- --runTestsByPath convex/simulation/providers/liveWorldDayWiring.test.ts
```
