# Phase 0 Foundation Scope

## What Phase 0 implements

- **Canon event model** — `ProposedEvent`, discriminated-union `StateChange`,
  `AcceptedEvent`, `WorldProjection` (`convex/canon/model.ts`).
- **Event classification** — typed unions + runtime guards (`convex/canon/eventTypes.ts`).
- **Two-layer validation** — structural and canon, with stable error codes
  (`convex/canon/validators.ts`, `convex/shared/errors.ts`).
- **Idempotent commit** — `validateAndCommitProposedEvent` mutation + reusable
  `commitProposedEvent(store, args)` over a `CanonCommitStore` interface
  (`convex/canon/commit.ts`).
- **Deterministic reducer** — pure `reduceWorldEvent` (`convex/canon/reducer.ts`).
- **Replay** — `replayWorldEvents` (`convex/canon/replay.ts`).
- **Snapshots** — `buildSnapshot`, `cloneProjection`, `replayFromSnapshot`
  (`convex/canon/snapshots.ts`).
- **Convex tables** — `canonEvents`, `canonIdempotencyKeys`, `canonSnapshots`,
  `simulationRuns` (`convex/canon/schema.ts`, `convex/simulation/schema.ts`).
- **Fake simulation provider** — deterministic, no network/LLM
  (`convex/simulation/fakeProvider.ts`).
- **Foundation workflow** — `runFoundationSimulation` mutation + pure
  `executeFoundationRun` orchestration (`convex/simulation/workflow.ts`).
- **Mistwood fixture** — fixed world for repeatable tests
  (`convex/canon/mistwoodFixture.ts`).
- **Story / recap boundaries** — declared, not implemented.
- **Observability** — trace-id plumbing (`convex/observability/`).
- **Tests, docs, CI, open-source scaffolding.**

## What Phase 0 intentionally excludes

- Real LLM provider (Phase 0 uses the deterministic fake provider only).
- Complete character autonomy / agent loop over canon.
- Story arc engine, episode generation, recap generation.
- New-viewer onboarding, audience voting, public operations backend.
- 200 residents, full economy, items, voice, video, multi-world, user-created worlds.
- Public production security audit and server-side authorization.

## Foundation data flow

```
SimulationInput
  → FakeSimulationProvider.proposeEvent
  → ProposedEvent
  → validateEventStructure (structural)
  → commitProposedEvent
      → idempotency check (canonIdempotencyKeys)
      → loadAcceptedEvents → replayWorldEvents (current projection)
      → validateCanon (preconditions vs projection)
      → allocate sequence → atomically append canonEvents + canonIdempotencyKeys
  → CommitResult { eventId, sequenceNumber, deduplicated }
```

## Current limitations

- The commit validation step still reduces from the **full event log** each time (O(n));
  daily replay and recovery reads use verified snapshot acceleration. Commit-side
  acceleration must preserve identical validation semantics.
- Convex transactions provide production serialization; the repository contract and
  in-memory reference store also serialize the entire per-world commit for deterministic
  concurrency tests.
- `@convex-dev/workflow` is **not** installed; the workflow is a single Convex mutation
  with retry-safe idempotency. See `docs/upstream.md` and ADR notes.
- Convex integration (actually running the mutation/action against a deployment) is not
  exercised here; the domain logic is covered by pure/mock tests.

## External setup still required (not Phase 0 blockers)

- A Convex deployment to *run* the live simulation and `dev` server (offline checks do
  not need it).
- A real LLM provider + API key when moving beyond the fake provider.

## Next safe implementation boundary

A single, independently-verifiable next task:

> **Seed a world's initial projection via a genesis snapshot and expose
> `getWorldProjection` to a minimal read path.**

This stays within the canon boundary, adds no LLM, and is verifiable with the existing
deterministic reducer + a mock/fixture snapshot.
