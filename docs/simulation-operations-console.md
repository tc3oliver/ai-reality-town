# Simulation Operations Console (FR-K001, NFR-005)

The operations console is the **authenticated, authorized, audited** administrative
surface for controlling a running world. It is deliberately **not** part of the
public read path.

- Policy (pure, unit tested): `convex/operations/operatorAuthorization.ts`
- Canon-safety decisions (pure, unit tested): `convex/operations/opsConsole.ts`
- Convex wiring (caller-facing `mutation`/`query`): `convex/operations/opsConsoleFunctions.ts`
- Audit table: `operatorAuditLog` in `convex/operations/schema.ts`

## 1. Controls

Every FR-K001 bullet maps to exactly one capability and one caller-facing function.

| PRD control (FR-K001) | Capability | Function | Minimum role |
| --- | --- | --- | --- |
| 暫停世界 (pause the world) | `world.pause` | `pauseWorld` (mutation) | `operator` |
| 恢復世界 (resume the world) | `world.resume` | `resumeWorld` (mutation) | `operator` |
| 手動推進時段 (advance a slot) | `slot.advance` | `advanceSlot` (mutation, `wholeWorldDay` for a full day) | `operator` |
| 重跑失敗工作 (retry a failed job) | `run.retry` | `retryFailedSlot` (mutation) | `operator` |
| 取消未提交場景 (cancel an uncommitted scene) | `scene.cancel` | `cancelUncommittedScene` (mutation) | `operator` |
| 查看當前世界狀態 (inspect world state) | `world.inspect` | `inspectWorldState` (query) | `viewer` |
| 建立 Snapshot (create a snapshot) | `snapshot.create` | `createWorldSnapshot` (mutation) | `admin` |
| 查看排程與 Queue (inspect schedules and queues) | `schedule.inspect` | `inspectScheduleAndQueue` (query) | `viewer` |

Supporting queries: `listOperatorAudit` (the audit trail for a world) and
`describeOperatorSession` (what the calling operator may do). Both require
`schedule.inspect`, so the console cannot be enumerated anonymously.

Snapshot creation is reserved for `admin` because it writes a durable recovery
artifact, mirroring the admin-only reservation already used by the publication
lifecycle (FR-K004).

## 2. Authorization model

Roles are ordered `viewer` < `operator` < `admin`. The operator registry lives
**only** in the Convex deployment environment variable `SIMULATION_OPS_OPERATORS`
and is never committed, never returned to a caller, and never written to the
audit trail.

```jsonc
// npx convex env set SIMULATION_OPS_OPERATORS '<the JSON below, one line>'
[
  { "operatorId": "ops-admin",  "role": "admin",    "subjects": ["clerk|user_123"] },
  { "operatorId": "ops-runner", "role": "operator", "subjects": ["clerk|user_456"], "worldIds": ["mistwood"] },
  { "operatorId": "ops-bot",    "role": "operator", "subjects": [], "token": "<generated ops token>" },
  { "operatorId": "ops-old",    "role": "admin",    "subjects": ["clerk|user_789"], "disabled": true }
]
```

Two principal sources are supported, both verified server-side:

1. **Identity (preferred).** `ctx.auth.getUserIdentity()` returns a Convex-verified
   JWT identity; its `subject` (or `tokenIdentifier`) must appear in a registry
   entry's `subjects`. The client cannot forge it because Convex validates the JWT
   before the handler runs.
2. **Ops token (bootstrap/automation).** The caller supplies `operatorId` plus
   `operatorToken`; the server compares it in constant time against the registry
   entry's `token`. This path exists because the deployment does not yet have an
   identity provider configured (no `convex/auth.config.ts`). Configure an issuer
   and populate `subjects` to retire it.

When a verified identity is present it always wins; the token is ignored.

**Fail-closed.** An unset or malformed `SIMULATION_OPS_OPERATORS`, a missing
identity, an unknown subject, a disabled operator, a mismatched token, an unknown
capability, or a world outside the entry's `worldIds` allowlist all deny. There is
no "no registry means open" mode.

**Uniform denial.** Every denial throws the identical
`[OPS_UNAUTHORIZED] operator is not authorized for this operation`, raised *before*
any row is read. An unauthorized caller therefore cannot distinguish "you are not
an operator" from "that world does not exist" from "that capability needs admin",
and so cannot infer which privileged controls exist (AC#3).

## 3. Canon and idempotency safety

- No console function writes `canonEvents`. Accepted history stays append-only.
- **Cancellation discards queue state only.** `cancelUncommittedScene` refuses a
  slot that recorded a `committedEventId`, a `completed` slot, and any slot whose
  world-day runs completed or recorded `committedEventIds` — the queue row is not
  the authority on what Canon accepted. A `running` slot is refused because it
  cannot be interrupted safely mid-transaction; wait for it to finish or fail.
- **Retry-safe.** Pause, resume, and cancel are idempotent and report
  `changed: false` on a repeat. `advanceSlot` reuses the scheduler's `slotKey`
  deduplication so a repeated advance cannot double-book a slot.
  `createWorldSnapshot` reuses the canon snapshot manager's existing daily-snapshot
  deduplication.
- The controls are not reimplemented: pause/resume/advance/retry delegate to the
  shared helpers in `convex/simulation/schedulerOperations.ts` and snapshots/state
  to `convex/canon/snapshotOperations.ts`, which the pre-existing internal
  mutations also call.

`scheduledSlots.status` gained a `cancelled` terminal value. It is written only by
this console, never by the scheduler, and never for a slot that produced Canon. A
cancelled slot is not picked up by the executor (which claims `queued` rows) and is
not re-reserved (reservation is keyed by `slotKey`).

## 4. Audit trail

Each applied command appends exactly one `operatorAuditLog` row **in the same
transaction as its effect**, so an effect can never be persisted without its
record. A row carries who (`operatorId`, verified `subject`, `role`, `source`),
what (`capability`, `target`), why (`reason`, required and non-empty), the result
(`outcome`, `resultCode`) and when (`at`).

`buildOperatorAuditEntry` rejects any `reason`/`target` that looks like credential
material, so an ops token can never reach the audit trail (NFR-005: secrets must
not enter logs or traces).

**Known gap.** *Denied* attempts are not written to `operatorAuditLog`. A Convex
mutation is transactional, so a row written on the path to a throw is rolled back
with the throw. Denials are observable in the Convex function logs. Persisting
denials durably needs a non-transactional writer (for example an action-based
front door) and is intentionally deferred.

## 5. Deployment prerequisites

1. `npx convex env set SIMULATION_OPS_OPERATORS '<registry JSON>'`.
2. For the identity path, configure an identity provider (`convex/auth.config.ts`
   plus the provider's issuer domain) and list each operator's `subject`. This
   requires a human-supplied deployment credential and is not configured in this
   repository.

Until step 2 is done, only the ops-token path can authenticate. Generate tokens
with a CSPRNG, store them in a password manager, and rotate by editing the
registry variable.

## 6. Extension seam

`requireOperator(ctx, capability, args)` and `recordAudit(ctx, …)` in
`opsConsoleFunctions.ts` are the reusable seam for the remaining Epic K consoles
(event review, Canon correction). Adding a control means adding a capability to
`OPS_CAPABILITIES`, a minimum role to `OPS_CAPABILITY_MINIMUM_ROLE`, and a
`mutation`/`query` that authorizes first and audits its effect.
