# Story projection (boundary placeholder)

The **story** layer derives narrative projections — arcs, tensions, and beats — from the
append-only canon event log.

## Responsibility

- Read accepted canon events.
- Project them into human-readable narrative structures (story arcs).
- Expose those projections to presentation/recap layers.

## Boundary

- The story layer is a **read model** over canon. It must never write canon state.
- Story content is derived, not authoritative. Corrections happen via new canon events,
  never by editing story projections in place.

## Phase 0 status

Not implemented. This directory declares the boundary so later phases can add a story
projection reducer (`reduceStoryEvent`) following the same determinism rules as the canon
reducer. See `docs/architecture/target-state.md` and ADR-0001.
