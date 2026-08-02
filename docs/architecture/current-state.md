# Current State (Upstream Baseline)

A factual snapshot of how AI Town works at the baseline commit, used to decide what to
keep, what to layer on top of, and what not to duplicate. Source: `ARCHITECTURE.md` and
the code under `convex/` and `src/`.

## Existing upstream layers

1. **Game logic — `convex/aiTown/`** — defines world/player/conversation/agent state,
   how it evolves, and how it reacts to inputs. Both humans and agents submit inputs.
2. **Game engine — `convex/engine/`** — `AbstractGame` runs the simulation: feeds
   inputs, advances time in `tick()`, batches ticks into steps, saves/loads state.
3. **Agent layer — `convex/agent/`** — runs inside the game loop and schedules
   async `internalAction`s for LLM work; memory uses Convex vector search.
4. **Client UI — `src/`** — `pixi-react` renders game state; uses `useQuery`/`useMutation`
   plus `useHistoricalValue` for smooth motion.
5. **LLM adapter — `convex/util/llm.ts`** — hand-rolled (no SDK); reads provider config
   from env. Preserved unchanged.

## Existing data ownership

- **Engine tables** (`convex/engine/schema.ts`): `inputs`, `engines`. Engine-exclusive.
- **Game tables** (`convex/aiTown/schema.ts`): `worlds` (the high-frequency document —
  players, conversations, agents, historical location buffer), `worldStatus`, `maps`,
  `playerDescriptions`, `agentDescriptions`, archive tables, `participatedTogether`.
- **Agent tables** (`convex/agent/schema.ts`): agent memory, embeddings, operations.
- **Cross-cutting tables** (`convex/schema.ts`): `music`, `messages`.

The schema is composed by spreading per-module table maps into one `defineSchema({...})`.

## Existing mutation path

State changes happen **only** through the **inputs** system:

1. A client or agent calls `insertInput` → a row in `inputs` with a monotonic `number`.
2. The single-threaded engine, in its next step, calls `handleInput`.
3. `handleInput` checks invariants and mutates in-memory game objects.
4. At step end, `Game.saveStep` computes a diff and the `saveWorld` mutation applies it.

The engine is the sole mutator of game tables; components outside the engine may only
mutate by sending inputs. Engine steps serialize via a `generationNumber`.

## Existing simulation flow

- `tick(now)` advances the simulation; AI Town ticks at 60 Hz (smooth motion).
- Many ticks are batched into a **step** run ~1/second inside one Convex mutation.
- Per step: load world → run ticks (alternating `handleInput` / `tick`) → save diff.
- Historical values (e.g. player position) are tracked within a step by
  `HistoricalObject` and replayed on the client for smooth motion.

## How agents call LLMs asynchronously

`Agent.tick` may `startOperation(ref)` to schedule an `internalAction`. That action can
read via `internalQuery`, run long work (LLM), and write via `internalMutation`. Game
state is not written directly by actions — it is changed by submitting **inputs**.

## Vector memory

After a conversation, GPT summarizes the exchange; an embedding is computed and stored
in Convex's vector database. New conversations embed a query ("what do you think about
X?"), retrieve the nearest memories, and inject them into the prompt. Embeddings are
cached by text hash in `embeddingsCache`.

## Realtime frontend

The UI reads game tables with `useQuery` (regular Convex). `useHistoricalValue` parses
the history buffer; `useHistoricalTime` synchronizes replayed time. `useSendInput`
wraps `useMutation` and awaits the engine's processing of an input.

## Authentication & authorization

- Auth scaffolding for Clerk is present but commented out in
  `src/components/ConvexClientProvider.tsx` (anonymous access today).
- There is no server-side authorization on canon/world mutations beyond Convex defaults.
- **Public production deployment requires a server-side authorization audit** before
  launch. This is explicitly out of scope for Phase 0.

## Existing tests, lint, build, dev scripts

- Tests: Jest + `ts-jest` (ESM preset), colocated `*.test.ts`. Pure utility tests only.
- Lint: ESLint + `@typescript-eslint` (recommended + type-checked); `no-explicit-any: off`.
- Build: `tsc && vite build`.
- Dev: `convex dev` + `vite` in parallel via `npm-run-all`.

## Reusable components (kept as-is)

- The whole engine + game + agent + UI stack is retained as the visual/realtime runtime.
- Schema aggregation pattern (spread per-module tables) is reused for new canon tables.
- Custom string-id validators in `convex/aiTown/ids.ts` inspire the canon id helpers.

## What does NOT serve as a long-term canon source of truth

- The `worlds` document is **high-frequency tick state**: it is diffed and rewritten
  every step, is meant to stay small (a few dozen KB), and is exclusively engine-owned.
  It is not an append-only, durable, authoritative history.
- Inputs are an execution queue, not a validated, idempotent event log.
- Memory/embeddings are agent cognition, not objective world facts.

These gaps are exactly what the **Canon Event** foundation addresses.

## Constraints informing the canon layer

- The reducer must run with no Convex, no network, no env, no clock, no unseeded RNG.
- Canon tables must not collide with upstream table names (`worlds`, `inputs`, etc.).
- Canon mutation/argument shapes need runtime validators (not just TS types).
- AI Town remains the visual runtime; the canon domain is a parallel, authoritative layer.

## Security observations

- Anonymous client access today (auth commented out).
- No server-side authz on mutations.
- See `SECURITY.md` and the authorization-audit requirement in `CLAUDE.md`.

## Integration points (future)

- A future director/agent step will turn LLM output into `ProposedEvent`s committed via
  the canon layer, then mirror canonical facts into AI Town inputs for the visual runtime.
- Phase 0 does **not** wire this integration; it only establishes the canon boundary and
  a deterministic fake provider.
