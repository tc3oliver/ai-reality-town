# Development

## Prerequisites

- Node.js 20+ and npm (developed on Node v20.19.2, npm 10.8.2).
- Git, and the GitHub CLI (`gh`) for repo/PR operations.
- A Convex deployment **only if you intend to run the live simulation** (`npm run dev`).
  All offline checks (`typecheck`, `lint`, `test`, `build`) work without one.

## Install

```bash
npm ci
```

## Common commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` — type-check the whole project. |
| `npm run lint` | ESLint (type-checked). |
| `npm run check:architecture` | Enforce the versioned domain dependency policy. |
| `npm run test:architecture` | Run positive and negative boundary-policy tests. |
| `npm run test:foundation` | Only the canon + simulation domain tests. |
| `npm test` | The full Jest suite (upstream utilities + foundation). |
| `npm run check:offline` | typecheck + lint + foundation tests (no Convex/key/network). |
| `npm run check` | typecheck + lint + full tests + build. |
| `npm run build` | `tsc && vite build` (offline-safe). |
| `npm run dev` | Convex backend + Vite frontend (requires a Convex deployment). |

## Test convention

This project follows **upstream AI Town's test convention**: Jest with `ts-jest` (ESM
preset) and **colocated `*.test.ts` files**. There is intentionally no root `tests/`
directory and no second framework. The Mistwood fixture lives at
`convex/canon/mistwoodFixture.ts` (colocated with the canon module) rather than under
`tests/fixtures/`; this deviation is deliberate and matches how AI Town colocates tests.
Its fixed seed, isolation guarantees, focused command, and long-run ownership are recorded
in [`docs/testing/fixtures.md`](testing/fixtures.md).

## Branch naming

- `foundation/phase-0` — the Phase 0 foundation branch.
- `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>` — typical work branches.
- Keep `main` always green.

## Commit rules

- One purpose per commit; don't mix unrelated formatting.
- Conventional-style prefixes are used (`feat:`, `fix:`, `test:`, `docs:`, `chore:`,
  `ci:`).
- Never `--no-verify`. Never commit secrets, `node_modules`, caches, or Convex
  credentials.
- Lockfile changes go in their own commit.

## How to add a new event type

1. Add the literal to `EVENT_TYPES` in `convex/canon/eventTypes.ts`.
2. If it carries new state, add a new variant to the `StateChange` discriminated union in
   `convex/canon/model.ts` (never a generic `Record<string, unknown>` for core changes).
3. Extend the Convex validator in `convex/canon/proposedEvent.ts`
   (`stateChangeValidator`) to match.
4. Add structural checks in `convex/canon/validators.ts` and any canon preconditions.
5. Handle the new change in `convex/canon/reducer.ts` (the `switch` is exhaustive).
6. Add tests.
7. Bump/record validation version if semantics change materially.

## Canon invariants (must hold)

- Accepted events are append-only and immutable. Corrections are new events.
- The reducer is pure: no DB, env, clock, or unseeded randomness.
- Providers only propose; only the commit pipeline writes canon.
- Sequence numbers are monotonic per world; gaps/duplicates fail loudly.

## Definition of Done (per PR)

- `npm run check:offline` (and `npm run build` where relevant) passes locally.
- New behavior has tests; existing tests still pass.
- No secrets, no lowered strictness, no skipped/deleted failing tests.
- Docs/ADRs updated if architecture or invariants changed.
- PR template checklist completed.

## Where things live

- **ADRs:** `docs/architecture/adr/`.
- **Architecture docs:** `docs/architecture/`.
- **Upstream/baseline records:** `docs/upstream.md`, `docs/baseline.md`.
- **Scope:** `docs/foundation-scope.md`.
- **Long-lived engineering rules:** root `CLAUDE.md`.
- **Module ownership and dependency policy:** `docs/architecture/module-boundaries.md` and
  `architecture/module-boundaries.json`.
- **Product requirements and delivery:** versioned PRD docs and tasks in Backlog.md.
- **World import contract:** `docs/world-configuration.md`.
- **Primary character seed contract:** `docs/character-seed.md`.
- **Provider proposal boundary:** `docs/proposed-event-contract.md`.
- **Structural event validation:** `docs/structural-event-validation.md`.
- **Canon continuity validation:** `docs/canon-continuity.md`.
- **Deterministic reducer contract:** `docs/deterministic-reducer.md`.
- **Snapshot and non-destructive recovery:** `docs/snapshot-recovery.md`.
- **Event-derived character state:** `docs/character-state-projection.md`.
- **Directional relationship projection:** `docs/relationship-projection.md`.
- **Story Arc lifecycle:** `docs/story-arc-lifecycle.md`.
- **World scheduler and run state:** `docs/world-scheduler.md`.
- **Initial tension warmup gate:** `docs/tension-readiness.md`.
- **Pre-generation safety gate:** `docs/pre-generation-safety.md`.
- **Secret-safe LLM tracing:** `docs/llm-tracing.md`.

## Conduct & security

See `CODE_OF_CONDUCT.md` and `SECURITY.md`. Report vulnerabilities privately via GitHub's
private vulnerability reporting, not in public issues.
