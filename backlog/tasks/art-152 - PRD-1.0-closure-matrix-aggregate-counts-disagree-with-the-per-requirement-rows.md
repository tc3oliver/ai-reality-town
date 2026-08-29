---
id: ART-152
title: PRD 1.0 closure matrix aggregate counts disagree with the per-requirement rows
status: To Do
assignee: []
created_date: '2026-08-29 05:42'
labels:
  - prd-1.0
dependencies: []
priority: medium
type: bug
ordinal: 152000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
docs/prd-1.0-closure-matrix.md carries summary totals that do not add up to the per-requirement rows beneath them, so the document that exists to prove closure state is itself internally inconsistent. This matters beyond tidiness: PRD 2.0 §26 and ART-138 forbid claiming completion without objective evidence, and a closure matrix whose own arithmetic is wrong cannot serve as that evidence. Fix the counts and add a check so the totals cannot drift from the rows again.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every aggregate count in the closure matrix equals the number of rows it summarises
- [ ] #2 An automated check fails when a total and its rows disagree
- [ ] #3 The check runs as part of npm run check
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
