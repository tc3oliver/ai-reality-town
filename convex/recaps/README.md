# Recap projection (boundary placeholder)

The **recaps** layer produces periodic summaries of the world ("previously on…") used for
onboarding new viewers and re-orienting returning ones.

## Responsibility

- Read accepted canon events up to a sequence number / world day.
- Summarize them into concise, audience-facing highlights.

## Boundary

- Recaps are a **read model** over canon. They never write canon state.
- Recap generation may call an LLM, but only as a *proposal* of recap text; the canon
  history itself is never edited by recap generation.

## Phase 0 status

Not implemented. This directory declares the boundary. A future phase will add a recap
generator that consumes the canon projection and emits `RecapProjection` records.
See `docs/architecture/target-state.md`.
