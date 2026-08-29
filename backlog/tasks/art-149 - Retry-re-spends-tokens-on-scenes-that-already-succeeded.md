---
id: ART-149
title: Retry re-spends tokens on scenes that already succeeded
status: To Do
assignee: []
created_date: '2026-08-29 05:41'
labels:
  - prd-1.0
  - epic-o
dependencies: []
priority: high
type: bug
ordinal: 149000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a world-day run is retried after a partial failure, scenes that already completed successfully are re-simulated, so their tokens are spent a second time. With a real provider this is a direct, silent cost multiplier on exactly the runs that are already going badly, and it interacts with ART-59: the re-spend consumes budget that the first attempt already consumed. Surfaced during ART-59 delivery. The fix should make a retry resume from the last successful scene rather than replay the whole slot.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A retry after a partial failure does not re-invoke the provider for scenes that already produced accepted output
- [ ] #2 Token accounting for a retried run reflects work actually performed, not work replayed
- [ ] #3 A test drives a partial failure followed by a retry and asserts the provider call count for the already-succeeded scenes is zero
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
