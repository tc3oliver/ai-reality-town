# Structural event validation

Every proposal passes `validateEventStructure` before the Canon commit pipeline reads or
writes repository state. Provider wire output uses the same validator through
`normalizeProposedEventOutput`; Convex argument validation is an additional transport
boundary, not a replacement for the domain validator.

The version 1 validator checks the schema version, required and exact object keys, event
and state-change discriminated unions, participant uniqueness and bounds, finite numeric
values, idempotency keys, non-negative safe world days, summary limits, technical
reference syntax, and recursively JSON-safe acyclic metadata. Technical identifiers are
ASCII, begin with an alphanumeric character, use only `A-Z`, `a-z`, `0-9`, `.`, `_`,
`:`, `#`, `|`, or `-`, and are at most 160 characters.

Failures return `CanonValidationError`; callers classify failures only by stable `code`
and `path`, never by matching the human-readable `message`. Unsupported contract
versions use `UNSUPPORTED_SCHEMA_VERSION`; other structural failures use
`INVALID_EVENT_SHAPE` with the rejected field or union path. Validation finishes before
repository access, so rejected proposals cannot create an event or idempotency record.

When adding fields or union variants, update the TypeScript contract, Convex validators,
normalizer exact-key lists, structural validator, reducer where applicable, and the
table-driven contract tests together.
