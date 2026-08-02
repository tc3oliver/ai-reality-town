# CLAUDE.md

Long-lived engineering rules for AI Reality Town. Keep this concise; prefer discoverable
code and `package.json` scripts over restating details here.

## Project purpose

A persistent AI social simulation and interactive reality-show world **built on AI Town**.
AI Town remains the visual/realtime runtime; an independent **Canon Event** domain is the
long-term source of truth.

## Current phase

**Phase 0 — Foundation.** Append-only canon events, deterministic reducer/replay,
deterministic fake simulation provider, offline tests, CI, docs. No real LLM, no full
product. See `docs/foundation-scope.md`.

## Architecture boundaries

- **Simulation** → proposes `ProposedEvent` only; **never** writes canon.
- **Canon** → append-only event store + deterministic projection; the source of truth.
- **Story / Recap / UI** → read models derived from canon; never write canon.
- **AI Town** → visual/realtime runtime; high-frequency tick state is **not** canon.

## Canon source of truth

The `canonEvents` table is the authoritative history. `WorldProjection` is derived from it
by the pure reducer. LLMs (and any provider) may only *propose* events.

## Append-only event policy

Accepted events are immutable. Corrections are new events, never in-place edits.

## Reducer determinism

`reduceWorldEvent` is pure: no DB, env, clock, or unseeded randomness. Same events ⇒ same
projection. Never turn it into a Convex mutation or add side effects.

## Idempotency

Commits are keyed by `idempotencyKey` per world. A duplicate proposal returns the existing
event, never a second one. Retries must rely on this, not on ad-hoc guards.

## Schema migration safety

New Convex tables are added via the spread pattern in `convex/schema.ts`
(`...canonTables`, `...simulationTables`). Don't duplicate upstream data models; don't
lower TS strictness to satisfy a migration.

## How to add an event type

See `docs/DEVELOPMENT.md` ("How to add a new event type"). Always extend the
discriminated union; never use `Record<string, unknown>` for a core canon change.

## Commands

- `npm run check:offline` — typecheck + lint + foundation tests (no Convex/key/network).
- `npm run typecheck` | `npm run lint` | `npm run test:foundation` | `npm test` |
  `npm run build`.
- `npm run dev` — live simulation (needs a Convex deployment).

## Definition of Done

`check:offline` (and `build` where relevant) passes; new behavior is tested; no secrets;
no lowered strictness; no skipped failing tests; docs/ADRs updated for architectural
changes.

## PR & git workflow

- Branch from `main`; conventional commit prefixes; one purpose per commit.
- `origin` = this repo; `upstream` = `a16z-infra/ai-town`.
- **Never push to `upstream`. Never force push.** Never commit secrets.

## Where PRDs and ADRs belong

- ADRs: `docs/architecture/adr/`. Architecture: `docs/architecture/`.
- PRDs / large backlogs are intentionally **not** maintained in Phase 0.
