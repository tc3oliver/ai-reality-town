# ADR-0003: Use deterministic reducers for world projections

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

To trust the canon projection, the same accepted events must always yield the same world
state — independent of where or when they are reduced. If projection logic depends on the
clock, a database, an external API, or unseeded randomness, replay becomes
non-reproducible and bugs become impossible to diagnose.

## Decision

World projections are derived from **ordered accepted events by a pure, deterministic
reducer** (`reduceWorldEvent`). The reducer:

- never mutates its inputs;
- never reads a database, environment variable, clock, or external API;
- never uses unseeded randomness;
- applies state changes in a fixed order and derives relationship keys from a fixed
  function;
- fails loudly on world mismatch, unsupported schema version, and sequence gaps or
  duplicates.

Replay (`replayWorldEvents`) and snapshot-resume (`replayFromSnapshot`) work without
Convex, an LLM, or any external service.

## Consequences

- Projections are fully reproducible and unit-testable with no infrastructure.
- Any nondeterminism (LLM output, timestamps) lives in the *proposal* stage, never in the
  reducer; `acceptedAt` is recorded at commit but never read by the reducer.
- Sequence integrity is enforced at reduce time, so corrupted logs are detected, not
  silently smoothed over.

## Rejected alternatives

- Reducing inside a Convex mutation with DB reads — rejected: nondeterministic and
  untestable offline.
- Sorting events silently on replay — rejected: masks broken input.

## Follow-up work

- Snapshot acceleration for large logs (replay currently reduces from the full log).
- A determinism property test that fuzzes the reducer.
