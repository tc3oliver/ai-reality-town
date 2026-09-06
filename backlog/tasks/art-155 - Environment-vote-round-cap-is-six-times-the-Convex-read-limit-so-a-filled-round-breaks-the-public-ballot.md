---
id: ART-155
title: >-
  Environment vote round cap is six times the Convex read limit, so a filled
  round breaks the public ballot
status: To Do
assignee: []
created_date: '2026-09-06 02:40'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 155000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ART-62 re-audit finding N-1 (new). `convex/viewer/environmentVote.ts:72` sets `MAX_SUBMISSIONS_PER_ROUND = 100_000`, but Convex refuses a query that reads more than 16,384 documents — a limit this repo already cites for itself in `convex/operations/tokenBudgetFunctions.ts:71`. Two call sites `.collect()` an entire rounds ballot rows with no bound: the public `getEnvironmentVoteBallot` query (`convex/viewer/environmentVoteFunctions.ts` around :108-111) and the round-closing cron path (around :244-247). Once a round accumulates ~16k ballot rows, the public ballot query throws for every visitor and the cron can never close the round, so the surface stays permanently broken rather than degrading. The submission path is anonymous and has no server-side rate limiter, so reaching that row count needs no credentials. `VOTE_ROUND_FULL` does not help: it is only reached at 100,000, long after the read limit bites, and refused-but-recorded attempts still allocate rows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The public ballot query and the round-closing path both read a bounded number of ballot rows, independent of how many submissions a round received
- [ ] #2 A round that has accumulated more rows than the Convex per-query document limit still returns a correct tally and can still be closed by the cron
- [ ] #3 The per-round submission cap is consistent with whatever read strategy is chosen, and its docstring states the real limiting factor rather than an unrelated number
- [ ] #4 A test drives a round past the read limit and fails if either path regresses to an unbounded collect
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
