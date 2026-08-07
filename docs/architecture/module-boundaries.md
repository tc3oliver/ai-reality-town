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
| Public Client | `src/components/public/` | Public Read Model, Shared | Public Platform Engineering |
| Read-only World Client | `src/components/world/` | Public Read Model, Shared | Public Platform Engineering |

Roots may be absent until their first Backlog task implements them; the boundary already
applies as soon as a source file is added. `convex/agent/` no longer exists (ART-112 /
ADR-0004: the upstream agent reasoning layer was retired). `convex/aiTown/` and
`convex/engine/` now contain only inert data-shape validators and Convex table schemas
kept for historical-row compatibility, not a running engine; they are not authoritative
product domains. The reusable visual runtime is `src/components/world/`'s PixiJS renderer
components (`PixiViewport`, `PixiStaticMap`, `Character`, `ReadOnlyWorld`), rebuilt as a
read-only shell by ART-113 and awaiting the page composition FR-O001 will give it.

The central invariant is one-way authority: providers propose, Canon validates and commits,
derived domains project accepted history, and Viewer/Public code reads published projections.
Presentation code cannot invoke Simulation, and Canon cannot depend on projections.

## Read-only client boundary

`readOnlyClientBoundary` in the policy declares the public surface -- the whole of `src`,
excluding the dev-only `src/editor` level editor -- and the world-write APIs that may not
appear anywhere inside it (`useMutation`, `useAction`, `useConvex`, `ConvexHttpClient`,
`ConvexReactClient`, and the retired a16z input helpers). ART-128 widened this from the two
component directories: the app shell, the client provider and the shared buttons ship in the
same bundle and were not being checked. `src/components/ConvexClientProvider.tsx` carries a
symbol-scoped exemption for `ConvexReactClient` alone -- it legitimately constructs the
client, and remains as unable to issue a write as every other file.

Import direction alone cannot express this: `useQuery` and `useMutation` come from
the same `convex/react` package, so the rule is stated at the symbol level and enforced by
`npm run check:architecture`. `src/components/world/readOnlyWorldSurface.test.ts` asserts the
same property as product acceptance evidence, and additionally covers the affordances the
policy has no opinion about (pointer handlers, control buttons, the non-map fallback route).

The interactive Game components the boundary used to separate the renderer from no longer
exist -- ART-112 retired them with the engine. Re-introducing any world-write capability
therefore means adding a new module outside these roots and declaring its edge here first,
not relaxing the symbol list. See [`read-only-world-shell.md`](../read-only-world-shell.md).

## Public function surface

The read-only client boundary governs what the *browser* can name. It says nothing about the
anonymous caller who never loads the app and posts straight at the deployment URL -- which is
how a public `mutation` in `convex/init.ts` and an unauthenticated `POST /replicate_webhook`
survived unnoticed until ART-128 (FR-O009).

`publicFunctionSurface` closes that gap by declaring every legitimate client-reachable Convex
export (path, name, kind, gate). `validatePublicFunctionSurface` scans `convex/**` for
`query`/`mutation`/`action`/`httpAction` registrations -- anchored on the assignment, so a
function exported under a different name is still found -- and diffs the result against the
allowlist **in both directions**: an undeclared registration fails the build, and so does a
declaration whose function no longer exists, which is what stops the allowlist decaying into
fiction. `httpAction` is listed under `forbiddenRegistrations` and is rejected outright: the
deployment routes zero HTTP endpoints. A public mutation must be `operator`-gated, since
PRD 2.0 §18.1 sets successful anonymous mutations to exactly zero.

See [`public-read-only-guarantee.md`](../public-read-only-guarantee.md) for the full
inventory, the per-AC evidence, and the two Critical findings this gate caught.

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
