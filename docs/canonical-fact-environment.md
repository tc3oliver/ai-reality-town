# Canonical facts and world environment

Every `fact_created` change becomes a versioned fact only after its proposal is accepted
into Canon. A projected fact includes a deterministic fact ID, typed subject, predicate,
primitive value, visibility, `validFromEventId`, and nullable `validUntilEventId`.

An Accepted Event with the same subject and predicate closes the prior active version and
appends a new one; history is never deleted or edited in the Event Store. World-subject
facts whose subject is the current world additionally feed `worldEnvironment` (current
values) and `environmentHistory` (all versions). Reducer, snapshot, and replay paths clone
these records and require no database, clock, randomness, model, or external service.
