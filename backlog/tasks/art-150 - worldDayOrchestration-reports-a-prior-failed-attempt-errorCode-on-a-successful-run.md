---
id: ART-150
title: >-
  worldDayOrchestration reports a prior failed attempt errorCode on a successful
  run
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 05:41'
updated_date: '2026-09-09 14:30'
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
- [x] #1 A run that ultimately succeeds carries no errorCode from a prior attempt
- [x] #2 Prior attempt failures remain visible as attempt history rather than being silently discarded
- [x] #3 A test drives fail-then-succeed and asserts the terminal record is clean
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
1. Audit which record the operations surface actually reads, and whether the bug still exists after ART-159/160/165/167.
2. Reproduce fail-then-succeed through the real orchestrators before changing anything.
3. Fix the root cause: the run-store contract had no stated rule about the failure fields, and five implementations each re-derived it. Give it one definition (convex/shared/runRecord.ts) and make every store spread it.
4. AC#2: surface the per-attempt failure history that already exists in worldDayCheckpoints, rather than copying it onto the slot row.
5. Fault injections on every new check; npm run check; npm run e2e; PR with auto-merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed after PR merged; npm run check and npm run e2e green on the merged branch.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A run that failed and was retried to success kept the failed attempt's failureStage/errorCode/errorMessage, so status:'completed' and a provider error code sat in the same record. The cause was in neither orchestrator: both delegate the write to an injected store, and the store CONTRACT never stated the rule, so five implementations each re-derived it and one got it right — the Convex adapters clear the fields for free because db.patch removes a field patched to undefined. That asymmetry is why the deployment stayed correct while the long-run harness reported completed slots carrying codes the deployment would have cleared. convex/shared/runRecord.ts now holds the one definition. AC#2's history was never actually discarded (worldDayCheckpoints keeps one row per attempt); what was missing was a reader, since inspectRun had zero callers — inspectScheduleAndQueue now returns attemptHistory, bounded to 25 slots with the omitted count published. Verified: 7 injections each turning one named test red; npm run check exit 0 (4182 passed, 31 skipped, 244 suites); npm run e2e 88 passed; PR #255 merged.
<!-- SECTION:FINAL_SUMMARY:END -->
