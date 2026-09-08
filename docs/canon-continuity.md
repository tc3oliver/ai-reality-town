# Canon continuity validation

ART-15 implements the PRD 1.0 `FR-D004` gate between proposed events and the
append-only Canon store. Structural validation runs first; continuity validation then
uses the current deterministic projection plus configured world references. A failure
throws a stable `CanonError` before an idempotency key or event sequence is reserved.

## Enforced rules

- Movement must name existing characters and locations, start at the projected
  location, follow configured location connections, and occur at most once per
  character and world time slot.
- Dead characters cannot participate in later normal events, and ordinary events
  cannot resurrect them.
- Character knowledge must name its source event, and that event must both exist in
  Canon and appear in the proposal's causal references.
- Every item has at most one projected owner. Transfers must come from that owner and
  may occur only once per item in an event.
- Participants, causal events, locations, characters, and items are checked against
  imported world data. Relationships cannot target the same character and cannot use
  an all-zero unexplained delta.
- Existing sequence and idempotency checks remain mandatory on every retry.

The reducer projects life state, last movement time, sourced character knowledge, and
item ownership from accepted events. Snapshots clone the same metadata, so replay and
snapshot replay use identical inputs and remain deterministic.

## Rejection inspection

Simulation runs persist the failure stage, stable error code, field path, and structured
details separately from Canon.

This section used to claim that `simulation.queries.listValidationFailures` returned those
records for the administrator console. **That claim was wrong.** The query had no callers
anywhere in the repository, and it read `simulationRuns` — a table only the Phase-0
foundation workflow ever writes, not the live world-day pipeline. It has been removed
rather than left as a console surface nothing consumed.

Two real surfaces cover the two questions it appeared to answer:

- **Why was one proposal rejected?** The FR-K002 proposed-event review,
  `listProposedEventReviews` and `reviewProposedEvent` in
  `convex/operations/proposalReviewFunctions.ts`. Both are operator-gated on
  `world.inspect` and return the per-proposal failure stage, stable error code and field
  path.
- **Does the accepted history contain conflicts?** `getContinuityQualityMetrics` in
  `convex/operations/worldQualityFunctions.ts`, also gated on `world.inspect`. It
  re-validates every accepted event in a window against the projection as it stood before
  it, and reports the PRD §16.2 Canon targets. See
  [`world-quality-metrics.md`](./world-quality-metrics.md).

Both are operator-gated, not public: public readers cannot inspect validation internals or
private world state.

## Verification

Focused coverage lives in `convex/canon/continuity.test.ts`, with schema-union and
projection coverage in `proposedEvent.test.ts` and `reducer.test.ts`. The commit tests
also cover duplicate keys and sequence conflicts. Run all project gates with:

```bash
npm run check
```
