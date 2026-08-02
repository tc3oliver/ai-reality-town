# Proposed Event Contract

`ProposedEvent` is the only wire contract through which a simulation or LLM provider
may request a canonical world change. Provider output is untrusted `unknown` data until
`normalizeProposedEventOutput` accepts it; the simulation workflow performs this step
before invoking the Canon commit pipeline.

## Version 1 envelope

Version 1 requires provenance (`idempotencyKey`, `proposedBy`, participants, and causal
event IDs), world time, an event type, and at least one typed state change. The only
supported state-change variants are currently:

- `character_location_changed`
- `relationship_changed`
- `fact_created`

The envelope, proposal source, and each discriminated-union variant use exact keys.
Unknown provider-specific fields are rejected rather than silently persisted. Optional
`metadata` must be a plain object containing only finite, JSON-safe values. Core state
changes must never be represented by metadata or an untyped payload.

## Boundary and failure behavior

The normalizer validates the schema version and complete structure, rejects unsupported
versions and malformed union payloads with stable Canon error codes, and returns an
isolated copy. Canon commit validates the normalized proposal again together with world
preconditions and idempotency. Therefore a provider can propose an event, but cannot
write or bypass Canon state rules.

When extending the contract, update the domain union, runtime/Convex validators,
normalizer, reducer, and tests together. A semantic breaking change requires a new
schema version and explicit compatibility handling; unsupported versions must fail
instead of being interpreted as version 1.
