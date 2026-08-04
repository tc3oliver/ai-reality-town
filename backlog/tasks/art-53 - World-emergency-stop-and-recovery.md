---
id: ART-53
title: World emergency stop and recovery
status: In Review
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-04 07:49'
labels:
  - prd-1.0
  - epic-m
milestone: m-0
dependencies:
  - ART-48
  - ART-51
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-K006

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Stop new simulation work while preserving public content, incomplete runs, and accepted events, then support authorized resume or non-destructive rollback.

Scope
Stop new simulation work while preserving public content, incomplete runs, and accepted events, then support authorized resume or non-destructive rollback.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-48, ART-51

Schema Impact
Simulation control, review, correction, publication, model-config, kill-switch, operator audit, and queue/run records named by the task.

API Impact
Authenticated administrative commands and queries with explicit roles and audit trails.

Security Impact
Every mutation is server-authorized, reasoned, auditable, secret-safe, and non-destructive to accepted history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Failure-injection tests cover activation at each run stage, reads, resume, and rollback.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-K006: Kill Switch stops new simulation jobs without affecting existing public content.
- [x] #2 FR-K006: Incomplete run state and every accepted event are preserved.
- [x] #3 FR-K006: Authorized operators can resume or perform non-destructive rollback.
- [x] #4 Activation, repeated activation, resume, and rollback are audited and idempotent.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Model the kill switch as SIMULATION state, not operations state. `worldSchedules.status='paused'` only stops slot RESERVATION; the live executor still claims already-queued slots. Add a world-level `worldEmergencyStops` row (one per world, engaged/released) in `convex/simulation/schema.ts` so the live orchestration can consult it (module boundary forbids simulation -> operations).
2. New pure module `convex/simulation/emergencyStop.ts` (no Convex imports): result codes, `EMERGENCY_STOP_ERROR_CODE`, `decideEmergencyStopEngage`/`decideEmergencyStopRelease` (idempotent: repeat engage/release is a recorded no-op), `assertSimulationAdmitted`, `summarizeEmergencyStop`, and `guardWorldDayStageHandlers(handlers, isHalted)` which wraps EVERY `WORLD_DAY_STAGES` handler with an admission check so a stop engaged mid-run aborts at the next stage boundary through the orchestrator's existing checkpoint/fail path.
3. New wiring `convex/simulation/emergencyStopOperations.ts`: `loadEmergencyStop`, `assertWorldAdmitsSimulation`, `engageWorldEmergencyStop` (captures pre-stop schedule status, REUSES `pauseWorldSchedule`, records preserved queued/running slot keys, never cancels or fails them, never touches canonEvents), `releaseWorldEmergencyStop` (REUSES `resumeWorldSchedule` only when the world was running before the stop, so the public clock does not jump), `readEmergencyStopState`, plus a read-only `getEmergencyStopState` internalQuery.
4. Halt the live run machinery: in `convex/simulation/worldDayLiveFunctions.ts` (a) refuse to claim any slot when a stop is engaged, and (b) wrap the stage handlers with the per-stage guard. Both edits are small and additive.
5. Reuse ART-48 authorization EXACTLY: add three admin-only capabilities (`world.emergency_stop`, `world.emergency_resume`, `world.rollback`) to `convex/operations/operatorAuthorization.ts`, and export ART-48's existing `requireOperator`/`recordAudit`/`operatorNow` wiring helpers from `opsConsoleFunctions.ts` (additive `export` keywords only) rather than building a second gate.
6. New `convex/operations/emergencyStopFunctions.ts`: authenticated `mutation`s `emergencyStop`, `resumeFromEmergencyStop`, `activateWorldRollback`, `clearWorldRollback` (the latter two expose the existing non-destructive `activateRecoveryHead`/`clearRecoveryHead` primitives behind the operator gate) and query `inspectEmergencyStop`. Every mutation authorizes first, then writes exactly one `operatorAuditLog` row in the same transaction.
7. Tests. `convex/simulation/emergencyStop.test.ts`: failure injection activating the stop at EVERY `WORLD_DAY_STAGES` entry against the real Mistwood seed port + in-memory canon store, asserting (a) the run fails at exactly that stage with the stable emergency code, (b) checkpoints before it stay completed so incomplete run state is preserved, (c) zero events reach Canon when the stop lands at or before commit, (d) release + rerun resumes at the halted stage and commits exactly once with no duplicate idempotency keys, (e) a stop after a completed run preserves the accepted events. `convex/operations/emergencyStopControls.test.ts`: engage/resume/rollback over an in-memory Convex db double, proving idempotency, schedule-status restoration, preservation of queued/running slots and canonEvents, audit rows, and that `serveReadModel` keeps returning the same published payload throughout (public reads never touch simulation).
8. Docs: new `docs/world-emergency-stop.md`; cross-link from `docs/simulation-operations-console.md` and `docs/snapshot-recovery.md`.
9. `npm run check` green, honest AC/DoD, implementation notes + final summary, commit, push, PR, auto-merge, task to In Review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DESIGN DECISION — why the kill switch is not `pauseWorld`. The FR-K001 pause flips `worldSchedules.status` to `paused`, which stops the clock cron from RESERVING slots and nothing else: `runQueuedWorldDaySlot` claims the oldest `queued` row regardless of schedule status, so a paused world with a queue backlog keeps generating and keeps committing. FR-K006 therefore adds a separate world-level ADMISSION GATE (`worldEmergencyStops`, one row per world) that the executor consults before claiming a slot. Engaging also pauses the schedule so both doors are shut, but the gate is what actually halts execution.

DESIGN DECISION — the switch lives in the simulation module, not operations. The module boundary policy forbids simulation -> operations, and the live executor must be able to read the gate, so the table and the shared helpers sit in `convex/simulation/` while the authorized console sits in `convex/operations/` — exactly the split already used for `worldSchedules` + `schedulerOperations` vs the FR-K001 console.

DESIGN DECISION — halting at a STAGE BOUNDARY, not inside a stage. `guardWorldDayStageHandlers` wraps each of the ten `WORLD_DAY_STAGES` handlers with the admission check, so a stop that engages mid-run raises through the orchestrator's ordinary failure path: completed checkpoints keep their artifacts, the refused stage is checkpointed as failed with the stable code `SIMULATION_EMERGENCY_STOPPED`, no later stage is started, and nothing partial reaches Canon. Because `commit_accepted_events` is the last stage, a halt at or before commit means the commit never ran. Resume restarts at exactly the refused stage and the commit boundary dedups by `(worldId, worldDay, timeSlot)`, so the same run cannot commit twice. This was implemented as a wrapper rather than a change to `worldDayOrchestration.ts` to keep ART-97/98's orchestrator untouched.

DESIGN DECISION — release restores the PRE-STOP schedule status, not an assumed 'running'. Releasing an emergency stop on a world an operator had already paused leaves it paused. When it was running, the shared `resumeWorldSchedule` shifts the real-time anchor by the halted duration so the public world clock does not jump. A repeated activation deliberately does NOT overwrite the captured status, or a later release would resume a world that had been deliberately paused before the emergency.

REUSE — no second auth mechanism. Added three admin-only capabilities to ART-48's `OPS_CAPABILITIES`/`OPS_CAPABILITY_MINIMUM_ROLE` and exported ART-48's existing `requireOperator`/`recordAudit`/`operatorNow`/`credentialArgs`/`commandArgs` wiring (additive `export` keywords only) so the new mutations pass through the same registry, role matrix, uniform `OPS_UNAUTHORIZED` denial, and `operatorAuditLog` trail. Rollback wraps the ART-17 `activateRecoveryHead`/`clearRecoveryHead` primitives rather than reimplementing recovery. All three emergency capabilities are `admin` because each acts on a whole world.

PRESERVATION IS ENFORCED BY OMISSION. The feature writes only `worldEmergencyStops` and (via the shared scheduler helpers) `worldSchedules.status`. It issues no write to `canonEvents`, `scheduledSlots`, `worldDayRuns`, `worldDayCheckpoints`, or `publishedReadModels`. A test asserts the slot rows and canon rows are byte-identical across an engage, and that `serveReadModel` returns the identical published payload before, during, and after the outage.

ALSO CLOSED: `advanceSlot` (FR-K001) now refuses while a world is stopped, because reserving a slot queues new simulation work. The clock cron was already covered by the pause.

VALIDATION. Focused: NODE_OPTIONS=--experimental-vm-modules npx jest convex/simulation/emergencyStop.test.ts convex/operations/emergencyStopControls.test.ts -> 2 suites / 46 tests passed. Full: npm run check -> architecture boundaries valid (policy v1, 11 modules), 6/6 boundary tests, tsc --noEmit clean, eslint clean, jest 79 suites / 961 tests passed, vite build succeeded. Re-run green after merging origin/main (23b7136).

DEFERRED (no AC requires it): no admin web UI for the switch; denied attempts still are not persisted to `operatorAuditLog` (Convex mutations are transactional — the pre-existing ART-48 gap, documented in docs/simulation-operations-console.md §4); no identity provider wired, so the ops-token path remains the interim (needs a human-supplied issuer credential).

PR #126 merged into main (merge commit 162e844) with both required checks green: CI 'Offline checks (typecheck, lint, test, build)' SUCCESS and Bootstrap 'Autonomous control plane + offline quality' SUCCESS. DoD #14 satisfied.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered the FR-K006 world emergency stop and recovery as an admin-authorized kill switch that halts NEW simulation work for one world while preserving public content, incomplete runs, and every accepted event, then supports an authorized resume or a non-destructive rollback.

WHAT CHANGED. Added convex/simulation/emergencyStop.ts (pure: admission gate, engage/release idempotency decisions, pre-stop schedule-status capture, and guardWorldDayStageHandlers which wraps all ten WORLD_DAY_STAGES handlers), convex/simulation/emergencyStopOperations.ts (shared Convex helpers engage/release/read plus a read-only internalQuery; there is deliberately no internal mutation that flips the switch unaudited), the worldEmergencyStops table, and convex/operations/emergencyStopFunctions.ts (emergencyStop, resumeFromEmergencyStop, activateWorldRollback, clearWorldRollback, inspectEmergencyStop). Wired the gate into convex/simulation/worldDayLiveFunctions.ts at both the slot-claim and the per-stage boundary, and into opsConsoleFunctions:advanceSlot so a manual advance cannot queue work during a stop.

WHY IT IS NOT pauseWorld. The FR-K001 pause only stops the clock reserving slots; the executor still drains the queue. The emergency stop is a separate world-level admission gate, so the executor claims nothing and no world-day stage starts. All three new capabilities are admin-only.

GUARANTEES. Nothing in the feature writes canonEvents or publishedReadModels, and no queued, running, or checkpointed row is cancelled, failed, or rewritten — so a halt cannot lose an accepted event, discard work in progress, or change what the public read path serves. A halt lands at a stage boundary, so completed checkpoints keep their artifacts, no partial batch is committed, and resume restarts at exactly the refused stage without committing twice. Release restores the schedule status held before the stop and absorbs the outage into the clock anchor. Activation, repeated activation, resume, and rollback are idempotent and each writes exactly one operatorAuditLog row in its own transaction.

REUSE. Authorization is ART-48's, exactly: three capabilities added to the existing matrix and the existing requireOperator/recordAudit wiring exported and reused, so there is no second gate. Rollback wraps ART-17's activateRecoveryHead/clearRecoveryHead, which move one canonRecoveryHeads pointer and never edit or delete accepted history.

VERIFIED. Failure injection at EVERY one of the ten world-day stages against the real Mistwood seed and the real stage handlers proves, per stage, that the run halts there with the stable code, earlier checkpoints stay completed, no later stage starts, nothing reaches Canon, a retry while still engaged runs nothing, and a release resumes from the halted stage committing exactly the undisturbed event set with unique idempotency keys and a gapless sequence. Control-path tests prove slot and canon rows are byte-identical across an engage, that serveReadModel returns the identical published payload before/during/after, schedule-status restoration, idempotency, and the admin-only matrix. Focused command: NODE_OPTIONS=--experimental-vm-modules npx jest convex/simulation/emergencyStop.test.ts convex/operations/emergencyStopControls.test.ts -> 2 suites / 46 tests passed. Full: npm run check -> architecture boundaries valid (policy v1, 11 modules), 6/6 boundary tests, tsc --noEmit clean, eslint clean, jest 79 suites / 961 tests passed, vite build succeeded; re-run green after merging origin/main. Documented in docs/world-emergency-stop.md, cross-linked from docs/simulation-operations-console.md, docs/snapshot-recovery.md, and docs/DEVELOPMENT.md. DoD #14 left unchecked pending auto-merge.
<!-- SECTION:FINAL_SUMMARY:END -->
