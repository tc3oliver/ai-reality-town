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
