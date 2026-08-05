# ADR-0004: Retire the AI Town server-side simulation engine

- **Status:** Accepted
- **Date:** 2026-08-05
- **Supersedes:** [ADR-0001](./ADR-0001-ai-town-as-visual-runtime.md)

## Context

ADR-0001 retained AI Town as a full "visual and realtime runtime": its own Convex-backed
game engine (`convex/engine`), world/agent/conversation lifecycle (`convex/aiTown`), an
agent reasoning layer with its own LLM calls (`convex/agent`), and a PixiJS client
(`src/`). PRD 2.0 §10.3/§10.5 establishes that **Canon Simulation is the sole narrative
source** — a second system that reasons about the world, calls an LLM, and mutates its
own state independently of Canon directly violates that invariant. The engine also ran
continuously and autonomously (`aiTown/main:runStep` self-rescheduling roughly once per
second, forever, driven by heartbeat-triggered restarts and two crons), which was an
operational containment incident in its own right, entirely independent of Canon
correctness.

ART-107 audited the actual coupling and found the renderer (`PixiViewport`,
`PixiStaticMap`, `Character`, spritesheets, animations, tilemap data) has **zero**
dependency on AI Town's engine state — it takes plain props. The engine's world execution
logic was the only thing standing between "renderer" and "second narrative source."

## Decision

Retire the AI Town server-side engine entirely (ART-112):

- **Removed:** `convex/aiTown/main.ts` (`runStep` and its self-rescheduling), `game.ts`
  (the simulation loop), `agentOperations.ts`/`agentInputs.ts` (agent reasoning),
  `inputHandler.ts`/`inputs.ts`/`insertInput.ts` (the input queue), `location.ts`,
  `movement.ts`; `convex/agent/conversation.ts`/`memory.ts`/`embeddingsCache.ts`;
  `convex/engine/abstractGame.ts`/`historicalObject.ts`; `convex/world.ts` (heartbeat,
  join/leave/moveTo/sendWorldInput, world-state queries); `convex/messages.ts`;
  `convex/testing.ts` (the engine freeze/resume/wipe/debug controls); the `restart dead
  worlds` and `stop inactive worlds` crons; and every client component/hook that only
  existed to drive them (`Game.tsx`, `PixiGame.tsx`, `Player.tsx`, `PlayerDetails.tsx`,
  `Messages.tsx`, `MessageInput.tsx`, `DebugPath.tsx`, `PositionIndicator.tsx`,
  `DebugTimeManager.tsx`, `FreezeButton.tsx`, `InteractButton.tsx`,
  `useWorldHeartbeat.ts`, `sendInput.ts`, `serverGame.ts`, `useHistoricalTime.ts`,
  `useHistoricalValue.ts`).
- **Retained as data shapes, not lifecycle:** `convex/aiTown/player.ts`, `agent.ts`,
  `conversation.ts` are reduced to their `serialized*` validator plus a minimal, inert
  class (constructor + serialize only — no tick/join/leave/reasoning methods), because
  `convex/aiTown/schema.ts` still needs the validators to keep historical rows schema-valid.
  `playerDescription.ts`, `agentDescription.ts`, `conversationMembership.ts`, `worldMap.ts`,
  `ids.ts` were already minimal and are unchanged. All three `schema.ts` files (aiTown,
  agent, engine) are unchanged — the engine's tables become permanently inert, not deleted;
  no Canon schema change and no data migration.
- **Retained for reuse:** the PixiJS renderer (`PixiViewport.tsx`, `PixiStaticMap.tsx`,
  `Character.tsx`) and its assets (`data/spritesheets/*`, `data/animations/*`,
  `data/gentle.js`, `data/convertMap.js`) — currently unreferenced by any route, held for
  a future Canon-projection-driven Visual Runtime (FR-N002/FR-N010, not this decision).
- `src/App.tsx`'s previously-interactive bare route now renders the existing public
  `Homepage`, the same as every other entry point.

## Consequences

- There is exactly one narrative source: Canon Simulation. The retained renderer has no
  agent, no LLM call, and cannot mutate Canon.
- Public visitors can never start or sustain a simulation — the entry points that could
  (heartbeat-triggered restart, join, move, chat) no longer exist to be reached, gated, or
  accidentally re-enabled; there is nothing left for the FR-K006 kill switch to have to
  guard on this surface.
- The AI Town `worlds`/`engines`/`worldStatus`/etc. tables remain in the schema (inert
  historical data, from before this decision) but are permanently frozen: no code path
  writes to them anymore.
- Production bundle size dropped from ~1,205 kB to ~329 kB (825 → 183 modules) — the
  interactive client's removal is substantial, not cosmetic.
- A future Visual Runtime (FR-N010) must write new adapters from Canon-derived
  projections directly to `Character.tsx`/`PixiStaticMap.tsx`; it cannot resurrect
  `Player.tsx`/`PixiGame.tsx`, which depended on the now-retired engine state shape.

## Rejected alternatives

- Leaving the engine running but disconnected from the public UI — rejected: it would
  still burn LLM budget continuously and independently of viewers, and still be a second
  narrative-generating system, just an invisible one.
- Gating the engine behind the existing FR-K006 emergency stop instead of retiring it —
  rejected: the kill switch is for halting the *authorized* ART simulation pipeline in an
  incident; permanently parking an unrelated, competing engine behind it conflates two
  different concerns and leaves a system that could be un-gated by mistake.
