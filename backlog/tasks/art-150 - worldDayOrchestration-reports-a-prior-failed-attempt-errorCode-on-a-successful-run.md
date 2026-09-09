---
id: ART-150
title: >-
  worldDayOrchestration reports a prior failed attempt errorCode on a successful
  run
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-29 05:41'
updated_date: '2026-09-09 11:20'
labels:
  - prd-1.0
dependencies: []
priority: medium
type: bug
ordinal: 150000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a world-day run fails and is subsequently retried to success, the orchestration record still carries the earlier attempt errorCode. A successful run is therefore indistinguishable from a failed one at the operations surface, which makes the operator console and any failure-rate metric derived from it wrong. Surfaced during ART-59 delivery. Note this directly undermines ART-90 (Canon rejection and safety-withhold metrics), which will read these records.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A run that ultimately succeeds carries no errorCode from a prior attempt
- [ ] #2 Prior attempt failures remain visible as attempt history rather than being silently discarded
- [ ] #3 A test drives fail-then-succeed and asserts the terminal record is clean
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit which record the operations surface actually reads, and whether the bug still exists after ART-159/160/165/167.
2. Reproduce fail-then-succeed through the real orchestrators before changing anything.
3. Fix the root cause: the run-store contract had no stated rule about the failure fields, and five implementations each re-derived it. Give it one definition (convex/shared/runRecord.ts) and make every store spread it.
4. AC#2: surface the per-attempt failure history that already exists in worldDayCheckpoints, rather than copying it onto the slot row.
5. Fault injections on every new check; npm run check; npm run e2e; PR with auto-merge.
<!-- SECTION:PLAN:END -->
