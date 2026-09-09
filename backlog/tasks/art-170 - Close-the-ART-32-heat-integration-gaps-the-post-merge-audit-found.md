---
id: ART-170
title: Close the ART-32 heat integration gaps the post-merge audit found
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-09 14:45'
updated_date: '2026-09-09 14:56'
labels:
  - prd-1.0
  - epic-h
dependencies: []
priority: medium
ordinal: 170000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An audit that reported after ART-32 merged found three things ART-32 left, all of the 'implemented but unreachable' class it was supposed to hunt.

1. The arc CREATION path still writes the old stand-in. nextArcProjectionFields computes the composite, but heatScore is also written at arc creation in three places that were not changed: convex/operations/postCommitLive.ts:532, convex/story/classificationFunctions.ts:57 and convex/operations/longRunHarness.ts:1056, all still Math.round(importance * 100). A new arc therefore carries the pre-ART-32 score until its first update.

2. compareArcsByHeat has no production caller. ART-32 exported it as the single definition of the heat ordering and then wired nothing to it: its only references are its own definition, two comments and heat.test.ts. Meanwhile candidateArcs (postCommitLive.ts:461) writes the identical comparator out inline. That is two definitions of one rule, one of them unreachable — the exact drift the export was meant to prevent.

3. selectHomepageArc (convex/story/portfolio.ts:119) has had no production caller since ART-41 and is the only thing implementing FR-F006's public ordering. ART-32's PR body said AC#2 was 'already true and now pinned', which is true of the criterion but overstated what heat does: the homepage's pickPrimaryArc orders by status then arcId, liveState.activeArcs sorts alphabetically, and heatScore is published in no read model at all. Heat's one live consumer is candidateArcs, which is simulation-side arc membership, not public ordering. The documentation should say that rather than implying otherwise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 heatScore is the six-signal composite everywhere it is written, including at arc creation
- [ ] #2 The heat ordering has exactly one definition, and it has a production caller
- [ ] #3 The documentation states what heat actually orders today, and names what would have to change for it to order a public surface
- [ ] #4 A fault injection proves each: reverting the creation-path change and re-inlining the comparator each turn a named test red
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
1. Verify each of the audit's three claims against the tree rather than accepting them.
2. Wire the composite at all three creation sites so heatScore has one scoring rule.
3. Give compareArcsByHeat its callers: candidateArcs and selectHomepageArc, replacing the inlined duplicate.
4. Say in the docs what heat actually orders, and name what would have to change for it to order a public surface.
5. Fix the two shipped assertions that could not fail: worldDayLive's toMatchObject and the api checker's missing content rule.
6. Fault injections; npm run check; npm run e2e.
<!-- SECTION:PLAN:END -->
