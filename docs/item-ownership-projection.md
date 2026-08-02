# Item and asset ownership projection

`item_transferred` requires an explicit prior owner (`null` only for first custody), target
owner, item, and causal reason. Canon compares that prior owner to the unique projected or
seed owner, rejects same-target and duplicate same-event transfers, and validates all
references before commit.

Each Accepted Event updates the single `itemOwners` entry and appends an immutable
`itemOwnershipHistory` record containing previous/new owner, reason, Event ID, sequence,
world day, and time slot. Snapshot/replay deep-clones the ledger. Commit idempotency means a
retry returns the original Accepted Event and never appends a second ownership version.
