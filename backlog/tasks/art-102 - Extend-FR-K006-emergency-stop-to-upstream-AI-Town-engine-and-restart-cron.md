---
id: ART-102
title: Extend FR-K006 emergency stop to upstream AI Town engine and restart cron
status: In Review
assignee:
  - '@oliver'
created_date: '2026-08-04 10:36'
updated_date: '2026-08-04 10:46'
labels: []
dependencies: []
ordinal: 102000
---

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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Audit finding H-5. The FR-K006 emergency stop is an ART-pipeline concept keyed on the public world string ID; the inherited AI Town engine uses Convex worlds IDs with no ART link, so under the single-public-world model the upstream default world maps to MISTWOOD_PUBLIC_WORLD_ID. (1) emergencyStopOperations.ts: add PUBLIC_EMERGENCY_STOP_WORLD_ID + isPublicWorldEmergencyStopped(db) + assertPublicWorldAdmitsSimulation(db) (centralizes the assumption in the simulation module, which may depend on canon). (2) world.ts: restartDeadWorlds early-returns when the public world is stopped (cron no longer restarts halted engines); heartbeatWorld gates its inactive-restart branch; joinWorld + sendWorldInput assert at top. (3) messages.ts writeMessage + aiTown/main.ts sendInput assert at top. (4) Test: extend emergencyStopControls.test.ts with an in-memory db double proving the public-world helpers reflect the public world's stop state. Gate: typecheck + lint + check:architecture + the focused test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
H-5 fixed. Centralized PUBLIC_EMERGENCY_STOP_WORLD_ID + isPublicWorldEmergencyStopped/assertPublicWorldAdmitsSimulation in simulation/emergencyStopOperations.ts; wired into restartDeadWorlds (cron short-circuit), heartbeatWorld (inactive-restart gate), joinWorld, sendWorldInput, messages.writeMessage, aiTown/main.sendInput. Test: emergencyStopControls.test.ts +3 (22 passed): behavioural public-world helper test + structural wiring tests (file's source-reading idiom). Gate: typecheck/lint/architecture clean. PR #138 (auto-merge).
<!-- SECTION:NOTES:END -->
