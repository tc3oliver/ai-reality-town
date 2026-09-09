---
id: ART-172
title: Give a world mode change an audited operator control
status: To Do
assignee: []
created_date: '2026-09-09 18:31'
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
- [ ] #1 An administrator can change an existing world schedule between development and public, and an operator who is not an administrator cannot
- [ ] #2 The change is recorded in operatorAuditLog with the actor, the reason, both modes and the timestamp, in the same transaction as the change itself
- [ ] #3 The command refuses to promote a world whose schedule is paused or emergency-stopped, rather than silently starting a cron against it
- [ ] #4 A repeated call with the same target mode is a no-op that is still audited as such, not an error and not a second change
- [ ] #5 A fault injection proves the administrator gate and the audit: removing either turns a named test red
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
