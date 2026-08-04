---
id: ART-100
title: Incremental public read-model projection updates
status: To Do
assignee: []
created_date: '2026-08-04 06:21'
labels:
  - prd-1.0
  - epic-i
dependencies: []
priority: medium
ordinal: 100000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every publicRead rebuild* function re-derives its payload by replaying the whole accepted-event log (canonEvents collect + replayWorldEvents), and the post-commit pipeline (ART-98) now invokes those rebuilds automatically after every accepted event. Measured on the dev deployment at ~65 accepted events, one post-commit run already costs several MB of document reads, and runLiveWorldDayCycle has to cap itself at one accepted event per transaction to stay under the Convex 16 MiB per-transaction read limit. As canon grows this becomes a hard ceiling on the live daily cycle. Fix by making the projection builders incremental (fold the new accepted event into the current published payload, or read from a canon snapshot plus the tail) instead of full replays.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post-commit run's document reads do not grow linearly with total accepted-event count
- [ ] #2 runLiveWorldDayCycle can process a whole time slot (3+ events) in one transaction on a world with hundreds of accepted events
- [ ] #3 Projection payloads remain byte-identical to the full-replay output for the same canon prefix
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
