# Live world-day execution

ART-97 implements PRD FR-C001–FR-C005 and PRD Section 12 stages 1–10 as one runnable loop,
which is the Milestone 2 completion criterion "一個世界日可完整跑完".

`simulation/worldDayLiveFunctions:runQueuedWorldDaySlot` is the single live entry point.
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
single movement event and cannot author a scene. `createWorldDayStageHandlers` takes any
`LanguageModelProvider`, so the ART-72 OpenAI-compatible adapter is injected at that seam
without changing this wiring, and provider construction stays inside the adapter root the
architecture boundary reserves for it.

Retries are safe because identity is derived, not allocated: the world-day Run ID, the
Director/Intent/Grouping/Simulation Run IDs, and every Proposed Event idempotency key come
from `(worldId, worldDay, timeSlot)`. A completed run short-circuits, an interrupted run
resumes at its last safe checkpoint, and a re-proposed event deduplicates at the Canon
commit boundary instead of appending a second event. Scene output classified as withhold or
human-review-required never reaches the commit stage.

Everything runs inside one Convex mutation/transaction: the deterministic author needs no
network, so there is no action-then-mutation race. The entry point is internal — public
reads must never trigger generation.

```bash
npx convex run simulation/schedulerOperations:advanceOneWorldDay '{"worldId":"mistwood","now":0}'
npx convex run simulation/worldDayLiveFunctions:runQueuedWorldDaySlot '{"worldId":"mistwood","maxSlots":5}'
```

Focused verification:

```bash
npm test -- --runTestsByPath convex/simulation/worldDayLive.test.ts
```
