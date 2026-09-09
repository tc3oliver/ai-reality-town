---
id: ART-152
title: PRD 1.0 closure matrix aggregate counts disagree with the per-requirement rows
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 05:42'
updated_date: '2026-09-09 14:30'
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
- [x] #1 Every aggregate count in the closure matrix equals the number of rows it summarises
- [x] #2 An automated check fails when a total and its rows disagree
- [x] #3 The check runs as part of npm run check
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
1. Count the classification cells and compare against the stated summary totals; identify why they drifted rather than just correcting them.
2. Make the Classification column a closed vocabulary so counting is possible at all; move the nuance to the verification column.
3. Add the missing summary bucket (P1/P2 delivered) — its absence is what made the drift structural.
4. scripts/docs/check-closure-matrix.mjs + node:test suite, following the check-asset-licenses house pattern.
5. Wire check:closure-matrix and test:closure-matrix into npm run check and check:offline; update CLAUDE.md §7.
6. Fault-inject against the real document.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed after PR merged; npm run check and npm run e2e green on the merged branch.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The closure matrix could not add itself up: P0 delivered read 98 against 108 rows, Deferred P1/P2 read 20 against 3. The drift was structural — the summary had no bucket for a P1/P2 clause that had been DELIVERED, so each of fifteen reclassifications decremented the deferred count and incremented nothing. Counting also required the Classification column to become a closed vocabulary of six tokens; it had held 29 distinct free-text strings, and the nuance moved to the verification column rather than being dropped. Two rows were reclassified on evidence: NFR-007 and §19.3 recorded the 90-day gate as P1-deferred and ART-73 had delivered it. scripts/docs/check-closure-matrix.mjs now runs in npm run check and fails on a stale total, an out-of-vocabulary classification, a sum mismatch, a non-goal recorded as present, or a header that stopped matching (which would otherwise pass vacuously). Verified: 13 node:test cases plus 5 injections against the real document; npm run check exit 0 (4174 passed, 243 suites); npm run e2e 88 passed; PR #256 merged. The check earned its keep twice afterwards, refusing ART-32 and ART-71 until their counts were updated.
<!-- SECTION:FINAL_SUMMARY:END -->
