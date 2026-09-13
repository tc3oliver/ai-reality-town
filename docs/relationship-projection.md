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

## The PUBLIC relationship dimensions (ART-95, corrected in ART-44, retired as a model in ART-182)

`convex/publicRead/relationshipArcProjection.ts` published `relationship:<pairKey>` — one read
model per character pair, committed on every relationship change — until **ART-182 retired that
publication**. Nothing read it: the FR-I007 graph and the FR-I005 character page both say in their
own source that they read Canon instead, and the PRD asks for the public projection SHAPE rather
than for a published model per pair (FR-I006 is the Story Arc page and names no relationship field;
§13.3 defines Relationship as a product-layer entity).

What survives is the part the graph builder imports: `accumulatePublicRelationshipDimensions` and
the rules below. They are still live, still load-bearing, and still the only correct way to turn a
pair's public history into levels — so this section is kept rather than deleted, with the sentences
that described a published payload marked as history.

### Published dimensions are accumulated LEVELS, not the last delta

`rebuildRelationshipProjection` (deleted by ART-182) used to overwrite its accumulator on every matching event and
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
private deltas into the public number would leak the size and direction of hidden feelings,
defeated by arithmetic rather than by publishing a field. The visibility rejection that catches the
other half of that leak now lives in one place only — `relationshipGraphProjection.ts` — because
its sibling in `buildRelationshipProjection` went with the retired publication.

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

### The payload that is no longer published

ART-95's repair deliberately carried no shape change: widening `RelationshipChange` to six deltas
and a `worldDay` was drafted while ART-44's graph was planned to read the model, and reverted once
that graph moved to Canon (`docs/scoped-relationship-graph.md` §2). The reason given at the time was
that a shape change alters every relationship row's `contentHash`, so every pair in every world
would publish a new version on its next rebuild — churn paid for a field nothing reads.

**"A field nothing reads" turned out to be the whole payload.** ART-182 followed that observation
to its end: the model had two candidate consumers, both shipped, and both declined it. The three
additive v1 dimensions never gained published per-change provenance and now never will, because
there is no per-pair public payload to carry it — the graph publishes all six as levels, per world
day, which is what FR-I007 actually asks for.

Rows written before the retirement are still in `publishedReadModels`. They are inert: `relationship`
is out of `READ_MODEL_KINDS`, so `getPublishedReadModel` will not name the kind and `serveReadModel`
throws on it. The literal stays in the stored `modelKind` union precisely so those rows keep
validating on deploy — see `RETIRED_READ_MODEL_KINDS` and `convex/publicRead/retiredReadModelKinds.test.ts`.
