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
