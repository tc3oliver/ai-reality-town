---
id: ART-163
title: Close the live story-arc progression and resolution loop
status: In Progress
assignee: []
created_date: '2026-09-07 10:26'
updated_date: '2026-09-07 10:27'
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
- [ ] #1 Every live transition into resolving, resolved or archived is produced by a recorded ArcResolutionDecision; a terminal status is unreachable without a non-empty outcome and at least one consequence.
- [ ] #2 Closing an arc applies consequence summaries for every affected character and for the world, so the summary input a later scene reads reflects the resolution.
- [ ] #3 A major arc with no progress for 14 world days deterministically releases its major slot (downgrade), and one stagnant for 28 days is wound down through the ordinary resolution path with an explicit outcome. No arc is ever deleted, and an archived arc stays queryable.
- [ ] #4 One accepted event may directly advance at most 2 major arcs on the live path, enforced rather than only unit-tested.
- [ ] #5 A resolved or archived arc never re-enters the active arc context or the classification candidate set.
- [ ] #6 Every lifecycle status, turning point, lastProgressTime, resolution decision and consequence summary is identical under full replay and under snapshot-resume.
- [ ] #7 The deterministic 30-day fixture asserts: active major arcs always <= 3, active minor arcs always <= 6, at least one arc records a turning point, at least one arc reaches resolving or resolved, and a stagnated arc does not hold an active slot permanently.
- [ ] #8 Ten named fault injections each compile, execute, and redden a named test; no injection run reports Tests: 0 total.
- [ ] #9 PRD traceability links FR-F002/F003/F004/F005 to doc-1 and the merged implementation evidence.
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
