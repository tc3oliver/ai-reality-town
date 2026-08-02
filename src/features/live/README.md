# Live feature (placeholder)

## Future responsibility
Render the live state of the world to the audience in real time, sourced from the
canonical projection (and, for high-frequency motion, from AI Town's realtime runtime).

## Boundary with the Canon Read Model
- This is a **read-only presentation** layer over canon projections.
- It must never write canon state, and reading a page must never directly trigger an LLM
  call (no "read → LLM" side effect on the client).

## Phase 0 status
Not implemented. No UI components are added until the canon read path is exposed.
