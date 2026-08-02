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

## Implemented foundations

- ART-64 provides the versioned Story Arc lifecycle, append-only transition history,
  accepted-event provenance, and active-context selection.
- ART-65 provides the complete event-replayable Story Arc projection data contract.
- Event classification remains a separate task.

See `docs/story-arc-lifecycle.md`, `docs/story-arc-projection.md`,
`docs/architecture/target-state.md`, and ADR-0001.
