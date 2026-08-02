# Deterministic world reducer

The Canon reducer is the pure projection boundary for PRD 1.0 `FR-D005` and
`NFR-003`. `reduceWorldEvent(projection, acceptedEvent)` returns a new projection and
has no database, Convex runtime, network, environment, clock, or random dependency.
State changes are applied in their declared order; event sequence order is never sorted
or repaired implicitly.

The reducer explicitly rejects a mismatched world, an unsupported event schema version,
a duplicate sequence, or a sequence gap. Every accepted state-change union variant must
be handled by the exhaustive switch before TypeScript can compile.

`convex/canon/reducer.purity.test.ts` is an executable architecture guard. It verifies
the reducer's import allowlist and forbidden runtime capabilities, then repeatedly
reduces isolated copies of a full event containing every supported state-change variant.
It runs once for every declared supported schema version. Existing reducer and replay
tests cover ordering, mutation isolation, gaps, duplicates, and world conflicts.

Run the focused evidence with:

```bash
npm test -- --runInBand convex/canon/reducer.test.ts convex/canon/reducer.purity.test.ts convex/canon/replay.test.ts
```
