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

Snapshots use a versioned envelope and canonical integrity hash. Before resume or
operational rollback, the snapshot must equal replay of the accepted-event prefix.

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

## Implemented follow-up

- Daily snapshot resume reduces only events after the latest verified checkpoint.
- Property-style tests cover every supported event schema and state-change variant.
- Operational rollback uses an audited recovery pointer and never deletes Canon history.
