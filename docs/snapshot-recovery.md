# Snapshot, replay, and recovery

PRD 1.0 `FR-D006`, `NFR-003`, and `NFR-008` are implemented by versioned Canon
snapshots and an audited operational recovery head.

## Daily checkpoint contract

`persistDailySnapshot` is the internal end-of-world-day operation. It is idempotent for
`worldId + worldDay`, resumes from the latest verified snapshot, replays only subsequent
accepted events, and stores the complete projection with a canonical integrity hash.
The world-day orchestration task invokes this operation after publishing the daily read
model. An initial snapshot is created by atomic world import.

Before any snapshot is used, the domain verifies:

- snapshot schema version, world, day, sequence, and finite creation time;
- its integrity hash using a key-order-independent canonical serialization;
- exact equality with replay of the immutable accepted-event prefix;
- strict continuation without gaps, duplicates, unsupported event versions, or world
  conflicts.

## Non-destructive rollback

Rollback never edits or deletes `canonEvents` or `canonIdempotencyKeys`. The internal
`activateRollback` operation verifies an existing snapshot against accepted history and
sets a single `canonRecoveryHeads` pointer for operational reads. Activation and clearing
append operator, reason, target, and time to `canonRecoveryAudit`. Clearing the pointer
immediately restores the full current projection.

The pointer is deliberately separate from Canon commit: accepted history remains the
source of truth and continues to be fully auditable. Admin UI and kill-switch tasks will
authorize and present these internal operations; they are not public APIs.

FR-K006 now provides that authorized entry point: `activateWorldRollback` and
`clearWorldRollback` in `convex/operations/emergencyStopFunctions.ts` wrap
`activateRecoveryHead`/`clearRecoveryHead` behind the operations-console `admin` gate
and the `operatorAuditLog` trail, and `inspectEmergencyStop` lists the snapshots that
are valid rollback targets. See `docs/world-emergency-stop.md`.

## Verification

`snapshotManager.test.ts` executes 30 world days and proves daily idempotency,
full-replay/snapshot equality on every day, corruption and version detection, explicit
sequence-gap failure, reversible rollback, and byte-for-byte preservation of all 30
accepted events.

```bash
npm test -- --runInBand convex/canon/snapshotManager.test.ts convex/canon/replay.test.ts
npm run check
```
