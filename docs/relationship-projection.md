# Directional relationship projection

ART-10 implements FR-B002 as an internal Canon read model. A relationship key is
directional (`source|target`), so the reverse direction has independent values and
history.

Each accepted `relationship_changed` event can change trust, affection, resentment,
fear, dependency, and familiarity. Values are deterministically bounded to -100..100;
familiarity is additionally bounded to 0..100. The reducer records the accepted event
ID, sequence, world day, time slot, deltas, reason, and visibility in append-only
projection history.

The additional v1 fields are backward compatible. Missing fear, dependency, and
familiarity deltas normalize to zero, and missing visibility normalizes to `private`.
This keeps previously accepted v1 events and snapshots replayable while ensuring new
normalized proposals have the complete contract.

Relationship state and causal reasons are exposed only through an internal Convex
query. A `private` history entry can contain unrevealed facts and must never be copied
to a public read model. Public editorial projection and disclosure policy belong to
ART-95; this foundation does not publish relationship reasons.

Validation rejects self-relationships, unknown characters, participant mismatches,
non-finite deltas, unsupported visibility values, and all-zero changes. Snapshot and
origin replay must produce identical state and history.

## The PUBLIC relationship projection (ART-95, corrected in ART-44)

`convex/publicRead/relationshipArcProjection.ts` publishes `relationship:<pairKey>` for public
consumption. Two things about it are easy to get wrong, and one of them was wrong until ART-44.

### Published dimensions are accumulated LEVELS, not the last delta

`rebuildRelationshipProjection` used to overwrite its accumulator on every matching event and
assign `trust: change.trustDelta` — and the same for the other five dimensions — so the published
`RelationshipProjection.trust` was the **last event's delta**. A pair that moved +5, +5, +5
published `trust: 5`; a pair that moved +50 and then -1 published `trust: -1`, i.e. a close ally
rendered as an enemy on the strength of one small setback.

The types already named the distinction — `RelationshipChange.trustDelta` against
`RelationshipProjection.trust` — which is what made the defect invisible at the call site. No test
pinned it: the pure builder was always handed levels and had no way to know it was being handed
deltas, and there was no test file for the wiring at all.

`accumulatePublicRelationshipDimensions` now folds all six dimensions across the pair's public
history, clamping per step and flooring familiarity at zero, exactly as the Canon reducer does.

### It folds only the PUBLIC changes, and that is deliberate

The reducer folds every change, public and private, into canonical world state. The public
projection folds only the public ones. They are re-implemented rather than shared, because feeding
private deltas into the public number would leak the size and direction of hidden feelings — the
leak that `buildRelationshipProjection`'s private-visibility rejection exists to prevent, defeated
by arithmetic rather than by publishing a field.

So the published level is "where this relationship stands as far as the public record shows",
which is a smaller number than Canon's and is the only one this surface is entitled to.

### Bounds

`clampPublicRelationshipDimension` coerces a non-finite value to 0 **and then** clamps to Canon's
`[RELATIONSHIP_MIN, RELATIONSHIP_MAX]`. It replaced `BOUNDED`, which did only the first half while
being named as if it clamped, under a docblock that told a reader the dimensions were bounded. The
repair made the code do what both claimed rather than renaming the claim away: Canon's reducer
clamps to that range, so a published level outside it could not correspond to any state the world
is in.

The order of the two steps matters. `Infinity` becomes 0, not 100: it is not "maximum trust", it is
a value nobody can read, and clamping it would publish the strongest possible claim about a
relationship on the strength of a garbage number.

### The payload shape is deliberately UNCHANGED

This repair is a behaviour fix and carries no shape change. Widening `RelationshipChange` to six
deltas and a `worldDay` was drafted while ART-44's relationship graph was planned to read it, and
reverted once that graph moved to Canon (`docs/scoped-relationship-graph.md` §2).

Two reasons. A shape change alters every relationship row's `contentHash`, so every pair in every
world publishes a new version on its next rebuild — churn paid for a field nothing reads. And
mixing it in would make the behaviour fix and the graph reviewable only together.

So the three additive v1 dimensions still have no published per-change provenance, only an
accumulated level. That predates this task. ART-43 is the next consumer of relationship data and
the right place to decide whether the public surface needs them.
