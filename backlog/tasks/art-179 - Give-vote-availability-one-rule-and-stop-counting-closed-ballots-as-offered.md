---
id: ART-179
title: 'Give vote availability one rule, and stop counting closed ballots as offered'
status: In Progress
assignee: []
created_date: '2026-09-09 22:54'
updated_date: '2026-09-09 23:09'
labels:
  - epic-q
dependencies: []
priority: medium
ordinal: 177000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three answers to one question — "is a vote available" — and the only one that RUNS is the wrong one.

Found by an ART-138 audit sweep for fields with two computation rules and view-model fields nothing renders.

1. **`src/components/public/homeRoute.ts:244`** — `voteAvailable: input.vote != null && (input.now ?? 0) < input.vote.cutoffAt`. Correct, tested, and **rendered by nothing.** No `.tsx` in the repository reads it.
2. **`src/components/vote/environmentVoteModel.ts:136`** — `available: open`, where `open = now < ballot.cutoffAt`. Its docblock calls it「the honest source of `voteAvailable`」. **Consumed by nothing**, including by the panel that computes it.
3. **`src/components/public/Homepage.tsx:151`** — `if (worldId !== null && ballotWorldDay !== null) emitVoteViewed(...)`. **No cutoff check at all**, and this is the one in production.

The third one contradicts its own docblock, which says `vote_viewed`「fires only once a ballot is actually open, because it is the denominator a participation rate should have — counting viewers who were never offered a vote would measure publication rather than participation」.

**It is not hypothetical.** `getEnvironmentVoteBallot` serves any round whose row says `status: 'open'`, and that status is moved by `tickEnvironmentVoteRounds`, a cron on a **five-minute interval**. So for up to five minutes after `cutoffAt`, the server serves a ballot, `EnvironmentVotePanel` correctly renders「已截止」, the options are unselectable — and `vote_viewed` fires. Those viewers enter the denominator of §16.1's `vote_participation` and can never enter its numerator, so the published participation rate reads low for a reason that has nothing to do with participation.

Scope: one shared predicate, used by all three sites. The unrendered view-model field goes rather than staying as a fourth copy — a field no view reads is the gap, and keeping it because it has tests is exactly the failure ART-178 was about.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The cutoff rule has one definition, and the ballot panel, the homepage view model and the vote_viewed emission all use it
- [x] #2 vote_viewed does not fire for a ballot whose cutoff has passed, including in the window before the cron closes the round
- [x] #3 No view-model field survives that no view renders and no other rule consumes
- [x] #4 A fault injection proves the gate: removing the cutoff check from the emission turns a named test red
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Three answers to one question — "is a vote available" — and the only one that RAN was the wrong one.

| Site | Rule | Consumer |
| --- | --- | --- |
| `homeRoute.ts` `voteAvailable` | `vote != null && now < cutoffAt` | **none** — no view in the repository read it |
| `environmentVoteModel.ts` `available` | `now < ballot.cutoffAt` | **none**, including the panel that computed it |
| `Homepage.tsx` `vote_viewed` gate | `ballotWorldDay !== null` — **no cutoff at all** | production |

The third contradicted its own docblock, which says `vote_viewed`「fires only once a ballot is actually open, because it is the denominator a participation rate should have」.

## The window is real, and it is five minutes wide

`getEnvironmentVoteBallot` serves any round whose row reads `status: 'open'`. That status is moved by `tickEnvironmentVoteRounds` — `crons.interval('tick environment vote rounds', { minutes: 5 })`. So for up to five minutes past `cutoffAt` the server hands back a ballot, `EnvironmentVotePanel` correctly renders 「已截止」 with nothing selectable, **and `vote_viewed` fired anyway**. Those viewers enter §16.1 `vote_participation`'s denominator and can never enter its numerator, so the published rate reads low for a reason that is not about participation.

`cutoffAt` and `status` are not the same fact, and the analytics gate was reading the wrong one.

## One rule, and the dead copies removed rather than aligned

`isBallotOpen(ballot, now)` is the single definition; `composeEnvironmentVoteViewModel` and the emission both use it. A missing ballot is not open, and neither is an in-flight read — collapsing `undefined` and `null` there is what keeps callers from having to.

`voteViewedTarget(ballot, now)` is a function rather than an inline condition because it IS the denominator definition, and a denominator that lives only inside a `useEffect` cannot be tested at its boundary. Its previous form could not have been tested at one either: it had none.

**`homeRoute`'s `voteAvailable` is gone.** Making it delegate to the shared rule would have left a fourth copy of a field no view renders — the gap itself, not a fix for it. Its test now asserts the field's ABSENCE across all four ballot states, and says why. The separation it claimed to keep ("voting is open" vs "there is something to show") is kept by `EnvironmentVoteViewModel`, which the panel really renders. The `vote`/`now` parameters stay, so no caller needs an edit and the field cannot quietly return under a new derivation.

## Evidence

| Injection | Tests that went red |
| --- | --- |
| the emission stops checking the cutoff | `emits vote_viewed for an open ballot, and for nothing else` |
| the boundary flipped to `<=` | 5 across two suites — `closes exactly AT the cutoff, not after it`, `is the rule the panel renders from…`, `after the cutoff the result is still shown, but nothing is selectable`, +2 |

The second injection is the one worth reading: it turns tests red in `environmentVoteModel.test.ts` AND `homeRoute.test.ts`, which is the proof that the rule is now genuinely shared rather than three copies that happen to agree.

- `npm run check` — exit 0, 4420 passed, 31 skipped, 253 suites
- `npm run e2e` — 124 passed
<!-- SECTION:NOTES:END -->
