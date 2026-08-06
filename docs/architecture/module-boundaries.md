# Module Boundaries and Ownership

The executable source of truth is [`architecture/module-boundaries.json`](../../architecture/module-boundaries.json),
version 1. `npm run check:architecture` scans repository imports and fails when a domain
crosses a forbidden dependency edge. `npm run test:architecture` proves the policy rejects
representative reverse dependencies and provider leakage. Both run in `npm run check`.

## Dependency direction

| Module | Code root(s) | May depend on | Owner |
| --- | --- | --- | --- |
| Canon | `convex/canon/` | Shared | Canon Engineering |
| Visual Binding | `convex/visual/` | Canon, Shared | Visual Runtime Engineering |
| Simulation | `convex/simulation/` | Canon, Knowledge, Story, Safety, Observability, Shared | Simulation Engineering |
| Character Knowledge | `convex/knowledge/` | Canon, Shared | Cognition Engineering |
| Story | `convex/story/` | Canon, Knowledge, Shared | Story Engineering |
| Editorial / Recap | `convex/editorial/`, `convex/recaps/` | Canon, Story, Safety, Shared | Editorial Engineering |
| Public Read Model | `convex/publicRead/` | Canon, Knowledge, Story, Editorial, Shared | Public Platform Engineering |
| Viewer | `convex/viewer/` | Public Read Model, Safety, Shared | Viewer Experience Engineering |
| Operations | `convex/operations/` | All server domains except Viewer, plus Shared | Operations Engineering |
| Safety | `convex/safety/` | Shared | Trust & Safety Engineering |
| Observability | `convex/observability/` | Shared | Reliability Engineering |
| Shared | `convex/shared/` | None | Architecture Engineering |

Roots may be absent until their first Backlog task implements them; the boundary already
applies as soon as a source file is added. `convex/agent/` no longer exists (ART-112 /
ADR-0004: the upstream agent reasoning layer was retired). `convex/aiTown/` and
`convex/engine/` now contain only inert data-shape validators and Convex table schemas
kept for historical-row compatibility, not a running engine; they are not authoritative
product domains. The reusable visual runtime is `src/`'s PixiJS renderer components
(`PixiViewport`, `PixiStaticMap`, `Character`), currently unreferenced by any route,
awaiting a future Canon-projection-driven Visual Runtime.

The central invariant is one-way authority: providers propose, Canon validates and commits,
derived domains project accepted history, and Viewer/Public code reads published projections.
Presentation code cannot invoke Simulation, and Canon cannot depend on projections.

## Provider boundary

`convex/simulation/provider.ts` is provider contract version 1. Provider-specific wire
formats, SDK imports, authentication headers, and response conversion belong only below
`convex/simulation/providers/`. Business and domain modules consume the shared contract and
must never import an adapter implementation. The boundary checker rejects known vendor SDKs
outside adapter roots; adapters still cannot write Canon and must return proposed events.

Adding or changing a module edge or provider contract version requires an independently
reviewed architecture change, policy tests, and compatibility/migration evidence when a
persisted contract is affected.

## Requirement ownership

Backlog tasks own individual acceptance evidence. The PRD-to-module routing below prevents
requirements from becoming ownerless:

| PRD area | Primary module owner |
| --- | --- |
| World initialization | Canon Engineering |
| Character state and relationships | Canon Engineering |
| Scheduling, director, intents, scenes | Simulation Engineering |
| Event store, validation, reducer, replay | Canon Engineering |
| Knowledge, memory, rumors | Cognition Engineering |
| Story arcs | Story Engineering |
| Episodes, recaps, onboarding summaries | Editorial Engineering |
| Public pages and live views | Public Platform / Viewer Experience Engineering |
| Voting and progress | Viewer Experience Engineering |
| Admin, correction, publication, kill switch | Operations Engineering |
| Content safety | Trust & Safety Engineering |
| Traces, quality, budgets, degradation | Reliability Engineering |
| Cross-domain and release gates | Architecture Engineering |

Task-to-requirement traceability remains in Backlog (`Requirement IDs` plus the versioned
PRD document reference). Product acceptance is aggregated by ART-63; no conversation state
is accepted as evidence.
