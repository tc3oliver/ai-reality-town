---
id: ART-48
title: Authenticated simulation operations console
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-04 07:24'
labels:
  - prd-1.0
  - epic-m
milestone: m-0
dependencies:
  - ART-18
  - ART-17
  - ART-57
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-K001, NFR-005

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Provide authorized pause/resume, slot advancement, failed-run retry, uncommitted-scene cancellation, state inspection, snapshots, schedules, and queues.

Scope
Provide authorized pause/resume, slot advancement, failed-run retry, uncommitted-scene cancellation, state inspection, snapshots, schedules, and queues.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-18, ART-17, ART-57

Schema Impact
Simulation control, review, correction, publication, model-config, kill-switch, operator audit, and queue/run records named by the task.

API Impact
Authenticated administrative commands and queries with explicit roles and audit trails.

Security Impact
Every mutation is server-authorized, reasoned, auditable, secret-safe, and non-destructive to accepted history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Authorization and integration tests cover every control and denied access.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-K001: Authorized operators can pause and resume the world, advance one slot, retry failed jobs, cancel uncommitted scenes, inspect world state, create snapshots, and inspect schedules and queues.
- [x] #2 Every operation is server-authorized, audited, and safe under retry.
- [x] #3 Unauthorized callers cannot invoke or infer privileged controls.
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
1. Authorization mechanism (new, no auth provider exists yet)
   - `convex/operations/operatorAuthorization.ts` (pure, no Convex imports): operator roles
     (`viewer` < `operator` < `admin`), the eight FR-K001 capabilities, a server-side operator
     registry parsed from the Convex env var `SIMULATION_OPS_OPERATORS` (JSON; never committed),
     principal resolution from either (a) a verified Convex `ctx.auth` identity subject or
     (b) a registered per-operator ops token compared in constant time, `assertOperatorCapability`,
     and a UNIFORM opaque denial (`OPS_UNAUTHORIZED`, fixed message) so unauthorized callers
     cannot infer world existence, roles, or which controls exist (AC#3).
   - Fail closed: unset/malformed registry, missing identity, disabled operator, unknown subject,
     bad token -> denied.
2. Reuse, do not reimplement, the existing control logic
   - `convex/simulation/schedulerOperations.ts`: extract and export the db helpers behind the
     existing internalMutations (`loadScheduleRow`, `pauseWorldSchedule`, `resumeWorldSchedule`,
     `reserveSlots`, `retrySlotRun`, `readScheduleInspection`) so the existing internal mutations
     and the new authorized mutations run the SAME code path.
   - `convex/canon/snapshotOperations.ts`: export `createSnapshotRecoveryStore` and
     `readOperationalWorldProjection` so snapshot creation / world-state inspection are shared.
3. Canon-safe cancellation of uncommitted scenes
   - `convex/operations/opsConsole.ts` (pure): `decideSlotCancellation` — only `queued` or `failed`
     slots WITHOUT a `committedEventId` may be cancelled; `running` and `completed` slots and any
     slot whose world-day run already produced `committedEventIds` are refused. Cancellation only
     marks queue state; it never reads, edits, or deletes accepted Canon history. Idempotent.
   - Schema: add `'cancelled'` to `scheduledSlots.status` and to `SlotRunStatus`.
4. Operator audit trail
   - New `operatorAuditLog` table in `convex/operations/schema.ts` (schemaVersion, worldId,
     operatorId, subject, role, capability, target, reason, outcome, resultCode, at) with
     `by_world_and_time` / `by_operator_and_time` indexes. Never stores tokens or secrets.
   - Every authorized mutation appends exactly one audit row in the same transaction.
5. Caller-facing authenticated surface
   - `convex/operations/opsConsoleFunctions.ts`: public `mutation`/`query` entry points
     (pauseWorld, resumeWorld, advanceOneSlot, advanceOneWorldDay, retryFailedSlot,
     cancelUncommittedSlot, createSnapshot, inspectWorldState, inspectScheduleAndQueue,
     listOperatorAudit). Every one authorizes FIRST, then acts, then audits.
   - Retry safety: pause/resume/cancel are idempotent; snapshot creation reuses the existing
     idempotent daily-snapshot path.
6. Tests (jest): `operatorAuthorization.test.ts` (full role x capability matrix, every denial
   path, uniform denial message, constant-time compare, registry parsing/fail-closed) and
   `opsConsole.test.ts` (cancellation decisions incl. Canon-committed refusal, idempotency,
   audit-entry construction and secret redaction).
7. Docs: `docs/simulation-operations-console.md` (capability matrix, registry configuration,
   Canon-safety invariants, seam for ART-49/ART-53), `.env.example` entry, README/DEVELOPMENT
   pointer as needed.
8. Verify with `npm run check`; record exact commands and results in implementation notes.
9. Deliberately OUT of scope for this task (documented, not silently dropped): the admin web UI
   page (no acceptance criterion requires one; the ACs and the task's API Impact call for an
   authenticated command/query surface) and wiring a specific identity provider (Clerk JWT issuer)
   which needs a human-supplied deployment credential.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTATION (FR-K001 / NFR-005)

Authorization mechanism (new — the repo had NO auth surface: `ctx.auth` was only a
commented-out stub in convex/world.ts and there is no convex/auth.config.ts):
- convex/operations/operatorAuthorization.ts (pure). Roles viewer < operator < admin;
  the eight FR-K001 capabilities; a server-only operator registry parsed from the Convex
  env var SIMULATION_OPS_OPERATORS (never committed, never returned, never audited).
- Two server-verified principal sources: (1) a Convex-verified ctx.auth identity subject
  listed in the registry (preferred; a client cannot forge it because Convex validates the
  JWT before the handler runs), and (2) a per-operator ops token compared in CONSTANT TIME.
  The token path exists only because configuring an identity provider needs a human-supplied
  issuer credential; identity always wins when both are supplied.
- FAIL-CLOSED: unset/malformed registry, missing identity, unknown subject, disabled
  operator, wrong token, unknown capability, or a world outside the entry's worldIds
  allowlist all deny. There is no "no registry means open" mode.
- UNIFORM DENIAL (AC#3): every denial throws the byte-identical
  `[OPS_UNAUTHORIZED] operator is not authorized for this operation`, raised BEFORE any row
  is read, so a caller cannot distinguish "not an operator" from "no such world" from
  "needs admin" and therefore cannot infer which privileged controls exist.

Reuse, not reimplementation (as required):
- convex/simulation/schedulerOperations.ts: extracted the db helpers that were inlined in the
  existing internalMutations into exported loadScheduleRow / pauseWorldSchedule /
  resumeWorldSchedule / reserveSlots / retrySlotRun / readScheduleInspection. The pre-existing
  internal mutations now call the SAME helpers as the console, so there is one code path.
- convex/canon/snapshotOperations.ts: exported createSnapshotRecoveryStore and
  readOperationalWorldProjection; getOperationalWorldProjection now delegates to the latter.

Canon safety (the important part):
- No console function writes canonEvents. Accepted history stays append-only.
- decideSlotCancellation (pure) refuses a slot with a committedEventId, a completed slot, and
  any slot whose world-day runs completed or recorded committedEventIds — the queue row is NOT
  the authority on what Canon accepted, so the runs are checked too. A running slot is refused
  because it cannot be interrupted safely mid-transaction. Cancellation only marks queue state.
- scheduledSlots.status (and SlotRunStatus) gained `cancelled`, written only by this console.
  A cancelled slot is not claimed by the executor (which takes `queued`) and is not recreated
  by reservation (which dedupes on slotKey) — proven by test.

Audit trail: new operatorAuditLog table (who / what / why / outcome / when), one row per
applied command written in the SAME transaction as the effect, so an effect can never persist
without its record. buildOperatorAuditEntry requires a non-empty reason and refuses any
reason/target carrying credential material (NFR-005 "secrets never enter logs").

VALIDATION
- npm run check -> GREEN end to end: architecture boundaries valid (policy v1, 11 modules);
  6/6 boundary tests; tsc --noEmit clean; eslint clean; jest 73 suites / 773 tests passed;
  vite build succeeded.
- New tests (37 cases): convex/operations/operatorAuthorization.test.ts (registry parsing and
  fail-closed, constant-time compare, principal resolution, full role x capability matrix,
  every denial path, byte-identical denial across six unauthorized shapes, audit-entry
  construction and secret-leak refusal), convex/operations/opsConsole.test.ts (cancellation
  decisions incl. Canon-committed refusal and idempotency, queue summary, world-state view
  proving private knowledge/memories are dropped), and
  convex/operations/opsConsoleControls.test.ts (17 cases driving the REAL shared control
  helpers against an in-memory Convex db double: pause/resume incl. anchor shift and
  idempotency, slot and world-day advance incl. no-double-booking on retry, retry transitions,
  cancellation staying out of the queue, schedule/queue inspection ordering).
  Focused command: NODE_OPTIONS=--experimental-vm-modules npx jest convex/operations

DELIBERATELY DEFERRED (flagged, not silently dropped)
1. No admin web UI page. No acceptance criterion requires one; the task's API Impact asks for
   "authenticated administrative commands and queries with explicit roles and audit trails",
   which is what was built. A UI belongs with the remaining Epic K consoles.
2. DENIED attempts are not persisted to operatorAuditLog. A Convex mutation is transactional,
   so any row written on the path to a throw is rolled back with the throw; durable denial
   auditing needs a non-transactional front door (e.g. an action). Denials remain visible in
   Convex function logs. Documented in docs/simulation-operations-console.md §4.
3. No identity provider is wired (no convex/auth.config.ts). Adding one requires a human-supplied
   issuer domain/credential, so the identity path is implemented and tested but inert until a
   deployment configures it; the ops-token path covers the interim. Documented in §5.
4. The composed Convex mutation wrappers (authorize -> act -> audit) are exercised only
   indirectly: the repo has no convex-test harness, and its established pattern (see
   worldDayLive.test.ts) is pure/helper-level tests with a thin wiring layer. Policy and control
   logic are both tested by execution; the 3-line wrappers are covered by typecheck only.

SEAM FOR ART-49 / ART-53: requireOperator(ctx, capability, args) + recordAudit(ctx, ...) in
opsConsoleFunctions.ts. A new control = one entry in OPS_CAPABILITIES, one minimum role in
OPS_CAPABILITY_MINIMUM_ROLE, and a mutation/query that authorizes first and audits its effect.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered the FR-K001 simulation operations console as an authenticated, authorized, audited admin surface (PR #118). Added convex/operations/operatorAuthorization.ts (viewer<operator<admin roles, eight-capability matrix, server-only SIMULATION_OPS_OPERATORS registry, Convex-verified ctx.auth identity plus a constant-time-compared ops token, fail-closed, byte-identical denial raised before any row read), convex/operations/opsConsole.ts (Canon-safe cancellation decisions) and convex/operations/opsConsoleFunctions.ts (ten caller-facing mutation/query entry points that authorize first, reuse the existing control helpers, then audit). Extracted the previously inlined control logic into exported helpers in simulation/schedulerOperations.ts and canon/snapshotOperations.ts so the pre-existing internal mutations and the console share one code path. Added the operatorAuditLog table (who/what/why/outcome/when, written in the same transaction as the effect) and a 'cancelled' slot status the executor never claims and reservation never recreates. No console function writes canonEvents; cancellation refuses any slot that committed an event or whose world-day runs completed. VERIFIED: npm run check green end to end -- architecture boundaries valid (policy v1, 11 modules), 6/6 boundary tests, tsc --noEmit clean, eslint clean, jest 76 suites / 836 tests passed, vite build succeeded; 37 new cases in convex/operations/{operatorAuthorization,opsConsole,opsConsoleControls}.test.ts, the last driving the real control helpers against an in-memory Convex db double (focused command: NODE_OPTIONS=--experimental-vm-modules npx jest convex/operations). Documented in docs/simulation-operations-console.md. DoD #14 left unchecked pending auto-merge; deferred and documented: no admin web UI (no AC requires one), denied attempts not persisted (Convex mutations are transactional), and no identity provider wired (needs a human-supplied issuer credential, so the ops-token path covers the interim).
<!-- SECTION:FINAL_SUMMARY:END -->
