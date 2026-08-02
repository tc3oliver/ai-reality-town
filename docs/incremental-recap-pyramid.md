# Incremental recap pyramid

`convex/recaps/` implements FR-G002 and the Section 13.11 Recap Snapshot
contract. The five persisted summary layers are `scene`, `episode`, `arc`,
`season`, and `viewer_context`; raw Accepted Events remain the source beneath the
pyramid.

Each versioned snapshot records its ID, world, type, target, first and last source
Event IDs and sequence numbers, content, structured provenance payload, version, and
generation time. The payload retains the complete ordered source Event IDs, the IDs
added by the current update, the prior snapshot ID, and whether the version was an
incremental update or explicit regeneration.

## Incremental update

Normal updates load the latest target snapshot and query `canonEvents` only from
`prior.sourceToSequenceNumber + 1` through the requested endpoint. The builder
requires that new Accepted Events are contiguous and immediately follow the prior
range. It combines the prior summary with only these new events; it does not reload
the world's earlier Event history.

The first version also requires an explicit bounded start and end sequence. Foreign,
duplicate, gapped, proposed-shaped, or mismatched source values fail validation.
Reusing a snapshot ID with different generation inputs is an idempotency conflict.

## Regeneration and audit

Explicit regeneration queries the complete Accepted Event range represented by the
latest snapshot and appends a new version. Previous versions remain unchanged and
queryable in ascending version order. Both generation modes write only
`recapSnapshots`; neither imports nor invokes Canon commit or reducer paths.

Run focused verification with:

```bash
npm test -- --runTestsByPath convex/recaps/model.test.ts
```

The suite covers every pyramid layer, all required fields, exact Accepted Event
provenance, bounded incremental updates, invalid sources, regeneration history,
internal-only persistence, and Canon isolation.
