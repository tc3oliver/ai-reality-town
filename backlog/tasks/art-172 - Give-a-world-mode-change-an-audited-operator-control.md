---
id: ART-172
title: Give a world mode change an audited operator control
status: In Progress
assignee: []
created_date: '2026-09-09 18:31'
updated_date: '2026-09-09 22:53'
labels:
  - prd-2.0
  - epic-k
dependencies: []
priority: medium
ordinal: 172000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during the ART-138 re-audit. `worldSchedules.mode` decides which crons touch a world — `tickAllPublicSchedules`, the runtime-snapshot cron and the vote cron all bind `by_mode_and_status` on `("public","running")` — so it is the single switch that turns a world from private development into the public acceptance environment.

**Nothing can change it.** `configureSchedule` (`convex/simulation/schedulerOperations.ts`) is the only writer of the column and it refuses outright when a schedule already exists (`SCHEDULE_ALREADY_EXISTS`). The operator console has `pauseWorld` and `resumeWorld`, which move `status`, not `mode`. So the only way to promote Mistwood today is a hand patch of the row through the Convex dashboard: unaudited, unreasoned, and invisible to `operatorAuditLog`.

That is a gap in FR-K001 rather than a missing feature request. Every other privileged world action on that console is authorized, reasoned and audited; the one with the largest blast radius is not reachable at all.

ART-138 records the consequence: its AC#10 (a public acceptance environment) cannot be satisfied by any command this repository offers, and the closure record has to tell the owner to use the dashboard.

Scope: an operator-gated mode change on the ART-48 console surface, admin-only for the reason `snapshot.create` and `world.emergency_stop` are — it starts a 60-second cron against a world and is what exhausted the deployment quota once already. It must refuse a mode change that would start scheduling against a world whose schedule is paused or emergency-stopped, and it must be idempotent. Adding a public function is an architectural change: `publicFunctionSurface` in `architecture/module-boundaries.json` and the exhaustive lists in `publicReadOnlyGuarantee.test.ts` must be updated in the same commit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An administrator can change an existing world schedule between development and public, and an operator who is not an administrator cannot
- [x] #2 The change is recorded in operatorAuditLog with the actor, the reason, both modes and the timestamp, in the same transaction as the change itself
- [x] #3 The command refuses to promote a world whose schedule is paused or emergency-stopped, rather than silently starting a cron against it
- [x] #4 A repeated call with the same target mode is a no-op that is still audited as such, not an error and not a second change
- [x] #5 A fault injection proves the administrator gate and the audit: removing either turns a named test red
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`worldSchedules.mode` is the switch every cron binds on — `tickAllPublicSchedules`, the runtime-snapshot cron and the vote cron all query `by_mode_and_status` for `("public","running")`. It is what turns a private development world into the public acceptance environment, and **nothing could change it**: `configureSchedule` is the only writer and refuses once a schedule exists (`SCHEDULE_ALREADY_EXISTS`), while `pauseWorld`/`resumeWorld` move `status`. Promotion meant hand-patching the row in the Convex dashboard — the one privileged world action with no authorization, no reason and no audit row.

## The rule is pure, and the asymmetry is the point

`planScheduleModeChange` decides from state alone, so it is tested directly rather than through a mutation:

- **Promotion requires a running, un-emergency-stopped world.** Promoting a paused world would either do nothing while reporting success, or start public scheduling at whatever moment somebody later resumed it.
- **Demotion is allowed from any state**, because it only takes work away. Refusing to demote a stopped world would leave an operator unable to take it off the public crons precisely when something has gone wrong with it.
- **A repeat is an audited no-op.** Not an error, not a second change. An operator who ran the promotion twice, or two who each thought they had, are facts the trail must carry.

The halt is read from `worldEmergencyStops`, not inferred from the schedule row: the kill switch deliberately leaves `status` and the queue intact, so a halted world reads `running` there. A test asserts exactly that combination.

`test` and `warmup` are not offered. They are configuration-time modes a harness sets at creation; moving a live world into one would detach it from every cron while reading as an ordinary mode change.

## Admin-only

Same reason as `snapshot.create` and `world.emergency_stop`: promotion starts a 60-second cron against a world — what exhausted the deployment quota once already — and decides what the public sees.

Adding a public function is an architectural change, so `publicFunctionSurface`, `publicReadOnlyGuarantee.test.ts`'s module map and `operatorAuthorization.test.ts`'s exhaustive capability list were all updated in the same commit. Each of those refused the change until it was declared, which is the point of them.

## Evidence

| Injection | Tests that went red |
| --- | --- |
| `world.change_mode` downgraded to `operator` | `refuses an operator who is not an administrator, before the row is touched` + `grants operator exactly its documented capabilities` |
| audit row skipped on a no-op | `audits a repeat as a no_op rather than dropping it` |
| promotion stops checking the pause | `refuses to promote a paused world, rather than starting a cron against it` (+1) |
| the halt read as `false` instead of from its table | `reads the kill switch from its own table rather than trusting the schedule row` |

19 tests. `docs/prd-2.0-closure-record.md` §6.3 now gives the owner a command instead of a dashboard instruction, and ART-138 AC#10's blocker is narrowed to the deploy alone.

- `npm run check` — exit 0, 4436 passed, 31 skipped
<!-- SECTION:NOTES:END -->
