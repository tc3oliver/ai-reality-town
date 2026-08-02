# ADR-0001: Retain AI Town as visual and realtime runtime

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

AI Town ships a complete realtime simulation stack: a Convex-backed game engine
(`convex/engine`), game logic (`convex/aiTown`), an agent/LLM layer (`convex/agent`), and
a PixiJS client (`src/`). Its world state lives in a high-frequency "tick" document that
is diffed and rewritten every engine step and is deliberately kept small (a few dozen
KB). That document is excellent for smooth, realtime visualization but is a poor
long-term, authoritative record: it is mutable, overwritten constantly, and exclusively
owned by the engine.

AI Reality Town needs a durable, authoritative history of *what canonically happened* in
the world — objective facts, public information, character cognition, and rumor kept
separate — that survives engine restarts, supports replay, and can be audited.

## Decision

Retain AI Town as the **visual and realtime runtime**: the map, the tick state, smooth
motion, and the realtime client. Introduce an independent **Canon Event** domain as the
long-term source of truth. The high-frequency AI Town tick state does **not** store the
complete canonical history.

## Consequences

- Two cooperating layers: AI Town (visual/realtime) and Canon (authoritative history).
- The canon projection can be mirrored *into* AI Town inputs for visualization, but AI
  Town state is never treated as canon.
- Replay and audits read from the canon event log, not the engine's tick document.
- Story and recap projections are read models derived from canon, never mutators of it.

## Rejected alternatives

- Storing canon history inside AI Town's `worlds` document — rejected: it violates the
  engine's small-state assumption and is mutated every step.
- Forking AI Town's engine to be append-only — rejected: high cost, fragile, and loses
  upstream sync for the visual runtime.

## Follow-up work

- Define the future director step that turns canon projections into AI Town inputs.
- Decide cadence for snapshotting canon projections.
