---
id: ART-152
title: PRD 1.0 closure matrix aggregate counts disagree with the per-requirement rows
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-29 05:42'
updated_date: '2026-09-09 11:31'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Count the classification cells and compare against the stated summary totals; identify why they drifted rather than just correcting them.
2. Make the Classification column a closed vocabulary so counting is possible at all; move the nuance to the verification column.
3. Add the missing summary bucket (P1/P2 delivered) — its absence is what made the drift structural.
4. scripts/docs/check-closure-matrix.mjs + node:test suite, following the check-asset-licenses house pattern.
5. Wire check:closure-matrix and test:closure-matrix into npm run check and check:offline; update CLAUDE.md §7.
6. Fault-inject against the real document.
<!-- SECTION:PLAN:END -->
