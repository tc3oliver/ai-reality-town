---
id: ART-155
title: >-
  Environment vote round cap is six times the Convex read limit, so a filled
  round breaks the public ballot
status: Done
assignee:
  - '@claude'
created_date: '2026-09-06 02:40'
updated_date: '2026-09-06 03:02'
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
- [x] #1 The public ballot query and the round-closing path both read a bounded number of ballot rows, independent of how many submissions a round received
- [x] #2 A round that has accumulated more rows than the Convex per-query document limit still returns a correct tally and can still be closed by the cron
- [x] #3 The per-round submission cap is consistent with whatever read strategy is chosen, and its docstring states the real limiting factor rather than an unrelated number
- [x] #4 A test drives a round past the read limit and fails if either path regresses to an unbounded collect
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
1. Reproduce the size mismatch from code: `MAX_SUBMISSIONS_PER_ROUND` vs the Convex 16,384-document per-query limit, and confirm both `.collect()` call sites.
2. Make the tally a counter on the round row (`votesByCandidate`), maintained in the vote transaction. Increment-only is sound only because `candidateId` is write-once; record what must change first if `MAX_ACCEPTED_VOTES_PER_DEVICE_PER_ROUND` is ever raised.
3. Split `closeRound` into a tally-shaped entry point so the cron can decide without enumerating ballots, with the ballot-shaped one delegating to it — so the two are provably the same decision.
4. Lower `MAX_SUBMISSIONS_PER_ROUND` below the read limit and export the limit, so the ceiling and the limit stop being two facts that contradict each other.
5. Migrate rounds opened before the counter existed, once, from the cron — including while they are still open, not only when they close.
6. Test through the REGISTERED handlers with a db double that refuses an over-large read the way Convex does. A double without that limit would let the original code pass.
7. Fault-inject the unbounded collect and require the read-cost tests to turn red.

FOUND MID-TASK, and folded in because the bound is unsound without it: audit finding N-2. `VOTE_ROUND_FULL` fell through to the insert, so a round at its ceiling kept allocating one row per new device forever, into a table that is never vacuumed. "A round fits in one query" rests on ROWS being capped, not just votes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented 2026-09-06

The tally is now a counter on the round row (`environmentVoteRounds.votesByCandidate`), maintained in the same transaction as the ballot write. The anonymous ballot query and the closing cron each read exactly one document and never touch `environmentVoteBallots`.

Increment-only is sound because `candidateId` is write-once — `MAX_ACCEPTED_VOTES_PER_DEVICE_PER_ROUND` is 1, so no device can move its vote between candidates. The schema comment states what must change first if that limit is ever raised, because a decrement path would be needed and its absence would be invisible.

`closeRound` was split into `closeRoundFromTally`, with the ballot-shaped entry point delegating to it, so the migration read and the fast path are provably the same decision rather than two implementations of it.

`MAX_SUBMISSIONS_PER_ROUND` lowered 100,000 -> 4,096, i.e. BELOW the Convex read limit rather than six times above it. Not because anything still enumerates ballots — nothing does — but so the ceiling and the limit stop contradicting each other and any future path that does enumerate a round can do so in one query by construction. The limit is exported as `CONVEX_MAX_DOCUMENTS_PER_QUERY` so the derivation has a visible input.

Legacy rounds (opened before the counter existed) are migrated once by the cron, including while still open rather than only when closing — otherwise an in-flight round would pay the bounded read on every ballot fetch until it expired.

### Found mid-task and folded in: audit finding N-2

`VOTE_ROUND_FULL` fell through to the insert, so a round at its ceiling kept allocating one row per NEW device forever, into a table that is deliberately never vacuumed. This is not a separate nice-to-have: the whole ART-155 argument is that a round`s ballots fit in one query, and that rests on ROWS being capped, not just votes. With N-2 open, the ceiling bounded accepted votes and nothing else, so my own bound would have been false. `NON_WRITING_VOTE_REJECTION_CODES` now mirrors `viewerProgress.ts``s `NON_WRITING_REJECTION_CODES` and the wiring derives its early return from that list instead of keeping a second copy. Refusals that JUDGED the submission still cost an attempt — otherwise the endpoint becomes a free oracle for probing the classifier.

### Verification

- New suite `convex/viewer/environmentVoteReadBounds.test.ts`: 14 tests. `environmentVoteFunctions.ts` had NO test at all before this; `environmentVote.test.ts` covers the pure policy, which was never wrong — the defect lived entirely in the wiring.
- The load-bearing piece is the db double`s document limit: it throws above 16,384 the way Convex does. A double without it would have let the ORIGINAL code pass every assertion, and one test asserts the double itself refuses, so the others cannot be vacuous.
- Oversized-round tests build 16,385 ballot rows and assert the ballot query reads exactly 1 document and the cron closes the round reading at most 1 per query.
- FAULT INJECTION: restoring the unbounded collect turns exactly 3 tests red (the two oversized-round paths and the post-migration read cost) and leaves the other 9 green.
- `npm run check`: 205 suites, 3317 passed, 6 skipped, build green. Baseline before this change was 204/3303 — delta is exactly this file.

### Not claimed

Nothing was verified against a running deployment. Convex function execution is disabled for exceeding free-plan limits (see ART-138), so the read limit is modelled from the figure this repository already cites at `operations/tokenBudgetFunctions.ts:71`, not measured.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The daily environment vote no longer reads a round`s ballots to answer anything. The tally lives on the round row as a counter maintained in the vote transaction, so the anonymous ballot query — the deployment`s most exposed read, fetched by every visitor — and the round-closing cron each cost exactly one document, whatever the turnout.

The finding was a size mismatch nobody had written in one place: a per-round ceiling of 100,000 ballot rows against a Convex per-query limit of 16,384. Past ~16k rows the public ballot threw for every visitor AND the cron could never close the round, so the surface stayed permanently stuck rather than degrading — remote, anonymous, no rate limiter. The ceiling is now 4,096, below the limit rather than six times above it, and the limit is exported so the derivation has a visible input.

Audit finding N-2 was fixed with it, because N-1`s fix is unsound alone: `VOTE_ROUND_FULL` fell through to the insert, so a round at its ceiling kept allocating a row per new device forever. "A round fits in one query" rests on rows being capped, not just votes.

Verified through the registered handlers with a db double that refuses an over-large read the way Convex does — the part that makes the test non-vacuous, and itself asserted. Fault injection: restoring the unbounded collect turns exactly the three read-cost tests red and leaves the nine policy tests green. `npm run check` green at 205 suites / 3317 passed, up from 204 / 3303.

Not verified against a running deployment: Convex execution is disabled for exceeding free-plan limits, so the read limit is the figure this repository already cites for itself, not one measured live.
<!-- SECTION:FINAL_SUMMARY:END -->
