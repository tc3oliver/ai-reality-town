---
id: ART-163
title: Close the live story-arc progression and resolution loop
status: In Progress
assignee: []
created_date: '2026-09-07 10:26'
updated_date: '2026-09-07 11:19'
labels:
  - prd-1.0
  - epic-f
milestone: m-0
dependencies: []
priority: high
type: bug
ordinal: 163000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Requirement IDs

FR-F002, FR-F003, FR-F004, FR-F005 (live-runtime closure of work delivered by ART-29/30/31/64/65/82).

## Problem / Context

An audit of the Story Arc engine against a running world found four capabilities that are
implemented, unit-tested, registered as Convex functions — and have **zero production callers**.
The arc data structures exist and the post-commit arc stage runs, but the loop that makes a story
"advance and close" is not connected:

1. `story/resolutionFunctions:recordArcResolutionDecision` — no caller. The live stage advances a
   lifecycle straight through `transitionArcLifecycle`, so an arc reaches `resolved` and
   `archived` with **no outcome and no consequences**. `createArcResolutionDecision` requires both
   for a terminal status; nothing on the live path ever asks it.
2. `story/consequenceSummaryFunctions:applyArcResolutionConsequences` — no caller. Nothing updates
   the character/world summary input after an arc closes.
3. `story/resolutionFunctions:refreshArcStagnationPrompts` runs, but `listArcStagnationPrompts`
   has no caller and no code acts on a prompt. A stagnant arc holds its active slot forever, and
   because a full major pool downgrades or rejects every new candidate, a world can stop forming
   major arcs permanently.
4. `story/portfolio:validateMajorArcMemberships` — no caller. The FR-F003 rule that one event may
   directly advance at most 2 major arcs is enforced nowhere in production.

The 30-day harness (ART-60) already asserts the count band and "no stagnant arcs", but it never
exercises resolution, turning points or slot release, so none of the above shows up as a failure.

## Goal

Make a 30-world-day simulation produce arcs that visibly progress and close: every terminal
lifecycle transition carries a recorded outcome and consequences, closing an arc updates the
affected character/world summary input, and a stalled arc deterministically releases its active
slot without disappearing from history.

## Scope

- Route `-> resolving`, `-> resolved` and `-> archived` on the live arc stage through a recorded
  `ArcResolutionDecision`, then the lifecycle transition, then consequence-summary application.
- Derive outcome and consequences deterministically from the accepted resolution event. A provider
  may propose classification and evidence; it may never name a final lifecycle status.
- Act on stagnation deterministically: a stagnant major arc is downgraded so the slot is freed, and
  a long-stagnant arc is wound down through the ordinary resolution path with an explicit outcome.
  An arc is never deleted and stays queryable after archiving.
- Enforce `validateMajorArcMemberships` on the live classification.
- Extend the deterministic 30-day fixture with the assertions that would have caught all of this.

## Out of Scope

Arc heat scoring (ART-32), recap/spoiler evaluators (ART-89), any new public surface, production
deployment, and any change that bypasses Canon, safety, idempotency or publication controls.

## Schema Impact

No new tables. `storyArcResolutionDecisions`, `storyArcStagnationPrompts` and
`arcConsequenceSummaries` already exist and are already written by the functions being wired.

## API Impact

Internal only. New `PostCommitLivePort` members for the resolution, consequence and stagnation
remediation boundaries; no new public function.

## Security Impact

None new. Arc resolution outcomes are derived from accepted events and flow through the existing
publication and safety gates unchanged.

## Validation Commands

npm run check; npm run e2e; ART60_LONG_RUN=1 npm run test:longrun; plus the focused arc lifecycle
and replay/snapshot suites added by this task.

## Test Requirements

Integration coverage of the full loop from accepted event to archived arc with outcome,
consequences and summary integration; replay/snapshot equality for all arc state; and ten named
fault injections, each of which must compile, execute, and redden a named test.

## Documentation Impact

`docs/story-arc-lifecycle.md`, `docs/arc-stagnation-resolution.md`, `docs/post-commit-pipeline.md`,
`docs/long-run-simulation-harness.md`, PRD traceability.

## Definition of Done

Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every live transition into resolving, resolved or archived is produced by a recorded ArcResolutionDecision; a terminal status is unreachable without a non-empty outcome and at least one consequence.
- [x] #2 Closing an arc applies consequence summaries for every affected character and for the world, so the summary input a later scene reads reflects the resolution.
- [x] #3 A major arc with no progress for 14 world days deterministically releases its major slot (downgrade), and one stagnant for 28 days is wound down through the ordinary resolution path with an explicit outcome. No arc is ever deleted, and an archived arc stays queryable.
- [x] #4 One accepted event may directly advance at most 2 major arcs on the live path, enforced rather than only unit-tested.
- [x] #5 A resolved or archived arc never re-enters the active arc context or the classification candidate set.
- [x] #6 Every lifecycle status, turning point, lastProgressTime, resolution decision and consequence summary is identical under full replay and under snapshot-resume.
- [x] #7 The deterministic 30-day fixture asserts: active major arcs always <= 3, active minor arcs always <= 6, at least one arc records a turning point, at least one arc reaches resolving or resolved, and a stagnated arc does not hold an active slot permanently.
- [x] #8 Ten named fault injections each compile, execute, and redden a named test; no injection run reports Tests: 0 total.
- [x] #9 PRD traceability links FR-F002/F003/F004/F005 to doc-1 and the merged implementation evidence.
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
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## What the audit found

Four capabilities are implemented, unit-tested, registered — and called by nothing in production:
`recordArcResolutionDecision`, `applyArcResolutionConsequences`, `listArcStagnationPrompts` (and
any action on a prompt), and `validateMajorArcMemberships`. Verified by grepping every caller
outside the defining module and its own test.

The consequence is not cosmetic. On the live path `postCommitLive.ts` walks an arc
`emerging -> active -> escalating -> climax -> resolving -> resolved -> archived` one step per
world day through `port.transitionArcLifecycle`, which asks for nothing but a legal transition. So
today an arc closes with no outcome, no consequences, no summary integration — and a stalled arc
keeps its slot for the life of the world.

## Approach

1. **Resolution is a decision, not a transition.** Add one port boundary that records an
   `ArcResolutionDecision` and returns it; the live stage may only reach `resolving`/`resolved`/
   `archived` THROUGH it. `createArcResolutionDecision` already refuses a terminal status without
   outcome and consequences, so wiring it is what turns that rule from a helper into a guarantee.
   The lifecycle transition follows the decision, never precedes it.

2. **Outcome and consequences are derived, never authored.** Both come from the accepted
   resolution event — its public summary, its participants, the arc's own resolved question. A
   provider proposes classification and evidence; the domain decides the status. This is the same
   rule ART-28 applied to a rumor's objective truth, for the same reason.

3. **Stagnation must cost the arc its slot, not its existence.** A deterministic ladder keyed only
   on world-day gaps: at 14 days a stagnant major arc is downgraded (the major slot is freed, the
   arc survives at minor); at 28 days the arc is wound down through the ordinary resolution path
   with an outcome that says plainly it was closed for want of progress. "重大 Arc 不得無故消失"
   means the record must show why, and an explicit outcome is that record.

4. **Enforce the per-event major limit where events actually arrive**, in the live classification,
   using the existing `validateMajorArcMemberships`.

5. **Prove it over 30 days, not in a unit test.** Extend the ART-60 harness findings with turning
   points, resolution reach, and slot-release-after-stagnation, then assert them.

## Sequence

1. Extend `PostCommitLivePort` and the live stage with the resolution/consequence boundary; pin
   that a terminal status is unreachable without a decision.
2. Add the deterministic stagnation remediation ladder.
3. Enforce the per-event major-arc limit.
4. Extend the harness findings and the 7-day/30-day assertions.
5. Fault injection at each step; commit before injecting.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Root cause

An audit of the Story Arc engine against a running world found four capabilities that were
implemented, unit-tested, registered as Convex functions and called by **nothing**. Verified by
grepping every caller outside each defining module and its own test:

- `story/resolutionFunctions:recordArcResolutionDecision`
- `story/consequenceSummaryFunctions:applyArcResolutionConsequences`
- `story/resolutionFunctions:listArcStagnationPrompts` (and any action on a prompt)
- `story/portfolio:validateMajorArcMemberships`

The live post-commit arc stage walked an arc `emerging -> ... -> resolving -> resolved` one step
per world day through `transitionArcLifecycle`, which asks only whether a transition is legal. So
`createArcResolutionDecision`'s rule -- a terminal status requires a non-empty outcome and at least
one consequence -- was enforced nowhere on the path the world takes. Arcs closed carrying nothing,
no character or world summary was refreshed, a stagnation prompt was recorded and acted on by
nothing, and the FR-F003 "at most 2 major arcs advanced per event" clause was live nowhere.

`Archived` was additionally unreachable: `candidateArcs` only considers emerging and active-family
arcs, so no accepted event ever classifies into a `resolved` arc and the classification-driven path
stops one step short.

## Lifecycle state machine

Unchanged and now pinned independently (see injection 4). Transitions are decided by the domain
from the FR-F002 table plus the arc's own state; a provider proposes classification and evidence
and can never name a final status. What changed is WHO may take the last three steps: `resolving`,
`resolved` and `archived` are reachable only through a recorded `ArcResolutionDecision`.

Order is the guarantee: **decide -> transition -> apply consequences**. Deciding first means a
terminal status is unreachable without an outcome, because the constructor throws before the
lifecycle is touched. Transitioning first would leave an arc `resolved` behind a failed decision,
which is corrupt rather than refused.

## Count control

- <=3 major and <=6 minor active arcs, enforced at BOTH admission (`applyArcPortfolioControl`) and
  transition (the stage's `entersActiveFamily` guard). Injection proved these are independent.
- <=2 major arcs directly advanced per event, now enforced in the live classification.
- Over-limit never drops silently: the blocked transition is recorded as a deferred transition with
  reason `ARC_ACTIVE_LIMIT_REACHED` and taken as soon as a slot frees.

## Stagnation / resolution

Deterministic ladder keyed only on world-day gaps, run on every commit including one that
classifies into no arc (a stalled arc is by definition one no event is classifying into):

| Gap | Arc | Action |
| --- | --- | --- |
| 14 days without progress | major, active family | `downgrade` -- major slot freed, arc survives |
| 28 days without progress | any active family | `enter_resolving`, then `resolve` next run |
| 14 days after resolution | `resolved` | `archive` |

Outcome and consequences are derived from the accepted resolution event, never authored: outcome
is the event's public summary (falling back to arc title + world day so it can never be empty),
consequences are one per core character plus one for the world. `recordArcResolutionDecision` now
also applies the decision's `resultingTier` to the portfolio entry -- FR-F003 count control reads
the entry, not the decision, so a recorded downgrade that was not applied would leave the arc
holding a major slot it had formally lost.

## Verification

- `npm run check`: exit 0. Boundaries valid (20 modules), typecheck/lint/build clean
  (4 pre-existing warnings in `liveStateFunctions.ts`, 0 errors).
  **222 suites / 3704 passed, 12 skipped, 3716 total.**
- `npm run e2e`: **82 passed**.
- `ART60_LONG_RUN=1 npm run test:longrun`: 30 world days, 16/16.
- Focused: `convex/operations/arcClosureLoop.test.ts` 24.

## Multi-day simulation evidence (fixed seed, deterministic fake author)

7 days: 6 arcs open, 3 reach `resolved` carrying an outcome and 3-4 consequences each; consequence
summaries land for 7 characters plus the world; all 3 resolved arcs recorded a turning point.
30 days: active major always <=3 and active minor always <=6 at every checkpoint; at least one arc
records a turning point; at least one reaches resolution; every terminal resolution carries its
evidence; no arc holds an active slot past the stagnation threshold; live arc state equals a fresh
replay of its projection stream.

## Fault injection (10 of 10 reddened a named test; no run reported `Tests: 0 total`)

1. `isActiveArcStatus` includes `resolved` -> 2 tests, incl. "never classifies an event into a resolved or archived arc"
2. major active limit -> `MAX_SAFE_INTEGER` -> "defers an emerging MAJOR arc rather than becoming a fourth active one"
3. minor active limit -> `MAX_SAFE_INTEGER` -> "defers an emerging MINOR arc rather than becoming a seventh active one"
4. `resolved -> active` added to the transition table -> "matches the PRD lifecycle exactly" + "never returns a closed arc to the active family"
5. `detectArcStagnation` always returns null -> "emits one stable operator prompt at exactly 14 world days, not before"
6. consequences never applied -> 4 tests incl. the order test and the 7-day harness
7. `lastProgressTime` frozen / `latestTurningPointEventId` dropped -> 3 and 4 tests respectively
8. `syncArcPortfolioEntry` skipped -> `arcsWhereLiveAndReplayDisagree` non-empty in the harness
9. `validateMajorArcMemberships` call removed -> "refuses an event that would directly advance three major arcs"
10. over-limit transition dropped with no deferred record -> both deferral tests

Three injections found real holes rather than confirming coverage:

- **#2/#3** initially survived. The stage's active-limit guard had no isolating test: the fixed
  seed never presents a fourth major candidate, and portfolio admission caps it independently.
  Three tests were added to isolate the transition guard from the admission guard.
- **#4** initially survived. `lifecycle.test.ts` loops over `ALLOWED_ARC_TRANSITIONS` and asserts
  the code agrees with it -- a validator handed its own input. The FR-F002 table is now written out
  literally and independently, plus two structural properties.
- While writing the replay gate I found my own prefix assertion compared a second full replay to
  the first and could not have failed; it now asserts per prefix that the fold reproduces exactly
  the state at that revision.

## Incidental

`convex/operations/longRunHarness.ts` contained a literal NUL byte in a hash separator, which made
`grep` treat the entire 1636-line file as binary and silently return nothing for every search. It
is now the escaped form instead -- same character, same digests, greppable file.
<!-- SECTION:NOTES:END -->
