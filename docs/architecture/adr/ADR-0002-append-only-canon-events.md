# ADR-0002: Use append-only canonical events

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

A persistent social simulation needs an authoritative history that can be audited,
replayed, and reasoned about. Mutating shared state in place makes it impossible to
answer "what happened and when", erases provenance, and invites concurrent-write races.
LLMs are probabilistic; their outputs must be proposals, not direct writes.

## Decision

All accepted canonical changes are **immutable, append-only events**. A simulation
provider (LLM, director, system, admin) may only submit a `ProposedEvent`; it may never
write to canon tables directly. Proposals are validated (structural + canon) and, if
accepted, appended with a monotonic per-world sequence number. Corrections are made with
new events (compensation/correction events), never by editing accepted history in place.

## Consequences

- The canon event log is the single source of truth; projections are derived.
- Idempotency keys make commits safe to retry (a duplicate proposal returns the existing
  event, never a second one).
- Provenance is preserved: every fact carries the `sourceEventId` that established it.
- The history grows monotonically; snapshots mitigate replay cost (future work).

## Rejected alternatives

- In-place mutable world state — rejected: loses provenance and auditability.
- Letting providers write canon tables directly — rejected: no validation boundary, no
  idempotency, unbounded concurrency.

## Follow-up work

- Define compensation/correction event types for future "undo" semantics.
- Snapshot cadence and pruning policy.
