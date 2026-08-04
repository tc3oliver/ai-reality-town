# World emergency stop and recovery (FR-K006)

The kill switch halts **new simulation work** for one world while leaving public
content, unfinished runs, and accepted Canon completely intact, then supports an
authorized resume or a non-destructive rollback.

- Decision layer (pure, unit tested): `convex/simulation/emergencyStop.ts`
- Convex wiring (shared helpers): `convex/simulation/emergencyStopOperations.ts`
- Authorized surface (caller-facing `mutation`/`query`): `convex/operations/emergencyStopFunctions.ts`
- State table: `worldEmergencyStops` in `convex/simulation/schema.ts`
- Audit table: `operatorAuditLog` (shared with FR-K001), plus `canonRecoveryAudit` for rollback

## 1. Why this is not `pauseWorld`

The FR-K001 pause (`docs/simulation-operations-console.md`) flips
`worldSchedules.status` to `paused`. That stops the clock cron from **reserving**
new slots — and nothing else. `runQueuedWorldDaySlot` claims the oldest `queued`
row regardless of schedule status, so a paused world with a queue backlog keeps
generating scenes and keeps committing events.

That is correct for an ordinary pause and useless as a kill switch. The emergency
stop is therefore a separate, world-level **admission gate**:

| | Ordinary pause (FR-K001) | Emergency stop (FR-K006) |
| --- | --- | --- |
| Stops the clock reserving new slots | yes | yes |
| Stops the executor draining the queue | **no** | **yes** |
| Stops a manual `advanceSlot` | no | yes |
| Halts a run already in flight | no | yes, at the next stage boundary |
| Minimum role | `operator` | `admin` |

Engaging the stop also pauses the schedule, so both doors are shut. The gate — not
the schedule status — is what actually halts execution.

## 2. Controls

| Command | Capability | Minimum role |
| --- | --- | --- |
| `emergencyStop` (mutation) | `world.emergency_stop` | `admin` |
| `resumeFromEmergencyStop` (mutation) | `world.emergency_resume` | `admin` |
| `activateWorldRollback` (mutation) | `world.rollback` | `admin` |
| `clearWorldRollback` (mutation) | `world.rollback` | `admin` |
| `inspectEmergencyStop` (query) | `world.inspect` | `viewer` |

Authorization is **not** reimplemented here. Every command calls ART-48's
`requireOperator` from `convex/operations/opsConsoleFunctions.ts`, which resolves the
principal against the `SIMULATION_OPS_OPERATORS` registry, applies the role matrix,
and raises the single uniform `OPS_UNAUTHORIZED` denial. Each applied command writes
exactly one `operatorAuditLog` row in its own transaction, so an effect can never be
persisted without its who / what / why / when record.

All three emergency capabilities are reserved for `admin` — even though an ordinary
pause is only `operator` — because each one acts on a whole world.

## 3. What is guaranteed

### Existing public content is unaffected (AC#1)

Nothing in this feature reads or writes `publishedReadModels`. Public reads consult
only that table and never the simulation layer (ADR-0001, `convex/publicRead`), so
every public page keeps serving its last-known-good version for the whole outage.
The stop does not withhold, invalidate, or re-version a single read model.

### Incomplete run state is preserved (AC#2)

Engaging the switch **never** cancels, fails, requeues, or rewrites a
`scheduledSlots` row, a `worldDayRuns` row, or a `worldDayCheckpoints` row. Slot keys
that were `queued` or `running` at activation are copied onto the stop record as
evidence only.

A run that is in flight halts at the next **stage boundary**, never inside a stage:
`guardWorldDayStageHandlers` wraps every `WORLD_DAY_STAGES` handler with the
admission check, so the orchestrator's ordinary failure path runs. Stages that
already completed keep their artifacts, the refused stage is checkpointed as failed
with the stable code `SIMULATION_EMERGENCY_STOPPED`, and no later stage is started.

### No accepted event is lost, and none is committed twice (AC#2)

Because the halt lands at a stage boundary and `commit_accepted_events` is the last
stage, a stop at or before commit means the commit never ran — there is no partial
batch. A stop after commit leaves the accepted events untouched; the completed run
short-circuits on every later call.

On resume, the run restarts at exactly the stage that was refused, using the
already-completed artifacts. Every Run ID and Proposed Event idempotency key derives
from `(worldId, worldDay, timeSlot)`, so the Canon commit boundary deduplicates even
if a stage is re-executed. Nothing in this feature ever writes `canonEvents`.

### Resume and rollback are authorized, and everything is idempotent (AC#3, AC#4)

`resumeFromEmergencyStop` restores the schedule to the status it held **before** the
stop, so a world an operator had already paused stays paused. When it was running,
the shared `resumeWorldSchedule` shifts the real-time anchor by the halted duration
so the public world clock does not jump.

Idempotency is decided in the pure layer:

- Re-activating an engaged switch applies nothing and keeps the original operator,
  reason, instant, and captured schedule status — a second activation must not
  overwrite the captured status, or the later release would resume a world that had
  been deliberately paused before the emergency.
- Releasing a world that is not stopped applies nothing.
- Re-activating the rollback snapshot the head already targets applies nothing.
- Repeats are still audited, as `no_op`, so a duplicated command stays visible.

`activationCount` distinguishes "the incident happened twice" from "the command was
sent twice".

### Rollback is non-destructive

`activateWorldRollback` delegates to the ART-17 primitive (`docs/snapshot-recovery.md`).
It verifies the target snapshot is exactly derivable from the accepted-event prefix,
then moves **one** `canonRecoveryHeads` pointer. `canonEvents` and
`canonIdempotencyKeys` are never edited or deleted, and `clearWorldRollback`
immediately restores the full current projection.

## 4. Operating it

```bash
# Engage. Every command is authorized, reasoned, and audited.
npx convex run operations/emergencyStopFunctions:emergencyStop \
  '{"worldId":"mistwood","reason":"runaway provider spend","operatorId":"ops-admin","operatorToken":"..."}'

# Inspect the switch, the preserved queue, and the valid rollback targets.
npx convex run operations/emergencyStopFunctions:inspectEmergencyStop \
  '{"worldId":"mistwood","operatorId":"ops-admin","operatorToken":"..."}'

# Either resume where it halted...
npx convex run operations/emergencyStopFunctions:resumeFromEmergencyStop \
  '{"worldId":"mistwood","reason":"incident closed","operatorId":"ops-admin","operatorToken":"..."}'

# ...or roll operational reads back to a verified snapshot, reversibly.
npx convex run operations/emergencyStopFunctions:activateWorldRollback \
  '{"worldId":"mistwood","snapshotId":"<id>","reason":"bad batch","operatorId":"ops-admin","operatorToken":"..."}'
```

There is deliberately **no** internal mutation that engages or releases the switch:
activation and release are privileged, reasoned, audited operator commands and must
go through the authorized console. `simulation/emergencyStopOperations:getEmergencyStopState`
is read-only.

## 5. Verification

`convex/simulation/emergencyStop.test.ts` injects an activation at **every** one of
the ten `WORLD_DAY_STAGES`, against the real Mistwood seed and the real stage
handlers, and proves for each: the run halts at exactly that stage with the stable
code, earlier checkpoints stay completed, no later stage starts, nothing partial
reaches Canon, a retry while still engaged runs nothing, and a release resumes from
the halted stage committing exactly the undisturbed event set with unique
idempotency keys and a gapless sequence.

`convex/operations/emergencyStopControls.test.ts` drives the shared control helpers
over an in-memory Convex `db` and proves preservation of queued/running slots and
accepted events, that `serveReadModel` returns the identical published payload before,
during, and after the outage, schedule-status restoration, activation/release/rollback
idempotency, and the admin-only capability matrix.

```bash
npm test -- convex/simulation/emergencyStop.test.ts convex/operations/emergencyStopControls.test.ts
npm run check
```
