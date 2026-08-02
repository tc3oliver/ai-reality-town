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
details separately from Canon. The internal `simulation.queries.listValidationFailures`
query returns those records for the administrator console. It is intentionally an
internal query: public readers cannot inspect validation internals or private world
state. The operations UI that consumes the query is owned by the Admin Console task.

## Verification

Focused coverage lives in `convex/canon/continuity.test.ts`, with schema-union and
projection coverage in `proposedEvent.test.ts` and `reducer.test.ts`. The commit tests
also cover duplicate keys and sequence conflicts. Run all project gates with:

```bash
npm run check
```
