---
id: ART-168
title: Correct three comments that assert the opposite of their own code
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-09 00:12'
updated_date: '2026-09-09 00:14'
labels:
  - prd-1.0
dependencies: []
priority: medium
ordinal: 168000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-G002, FR-K005, FR-M004

Problem / Context
Three docblocks state something the code does not do. Two were flagged by the ART-89 and ART-91 documentation passes and outlived the tasks that made them wrong; the third was made wrong again by ART-165. CLAUDE.md section 9 names this class explicitly: comments must argue what the code does, and several defects here have been a docblock asserting the opposite of its own function.

1. completedWorldDays in convex/operations/postCommitLiveFunctions.ts says a world day counts as finished 'once it is no longer the newest day, or once it has produced an event in the final time slot'. The body is only day < latest. The second clause is precisely the rule ART-89 removed, and removing it is what took high-importance recap coverage from 85.4% to 100% - a day was being treated as complete the moment its final slot BEGAN, so its Episode was assembled from a partial slot and the rest of that slot reached no Episode, recap or publication. The docblock still describes the defect as though it were the rule.

2. SceneAuthoringPlan.fallbackModel in convex/simulation/worldDayLive.ts says moduleConfigSelection.test.ts 'pinned that it reached no call. That pin is now the opposite assertion.' It is not. That test still asserts options has no fallbackModel property and its own header still says fallbackModel reaches no call - both correctly, because the module config's options never carry the key. Since ART-165 the fallback does reach the call, but through degradedPlan overriding options.model, not through wholeSceneOptionsFor.

3. resumeFromPause in convex/simulation/degradation.ts says a reset counter would take 'another twelve failures to get back here'. It is ten - five rungs at FAILURES_BEFORE_ESCALATION each - which is what degradation.test.ts pins. Since ART-165 those ten failures are also spread across roughly thirty slots, because the two lowest rungs ask the provider only once per world day.

Goal
Every one of the three says what its code does, and says plainly that the old claim was wrong rather than silently replacing it.

Scope
Three comments. No behaviour change.

Out of Scope
Any code change, any test change, any threshold.

Schema Impact
None.

API Impact
None.

Security Impact
None.

Validation Commands
npm run check

Test Requirements
None beyond the existing suite: this task changes no behaviour, and a test that could tell would be a test of a comment.

Documentation Impact
The comments are the documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 completedWorldDays describes the rule its body implements, and names the clause ART-89 removed as the defect it was.
- [x] #2 The fallbackModel note states correctly that the moduleConfigSelection pin was never inverted, and names where the fallback actually reaches the call.
- [x] #3 resumeFromPause states the count degradation.test.ts pins, and accounts for the probe cadence.
- [x] #4 npm run check stays green, and no behaviour changes.
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
Three docblocks that stated something their code does not do. All comment-only: 'git diff' filtered to non-comment lines is empty, which is the evidence that the change is behaviour-neutral.

1. completedWorldDays claimed a day is finished 'or once it has produced an event in the final time slot'. That clause was the ART-89 defect written down as the rule - a day treated as complete when its night slot BEGAN had its Episode assembled from a partial slot, leaving 14 of 96 high-importance events uncovered and coverage at 85.4%. The note now states the rule the body implements and names the removed clause so nobody restores it as a fix.

2. SceneAuthoringPlan.fallbackModel claimed moduleConfigSelection.test.ts's pin 'is now the opposite assertion'. It is not, and it should not become one: that test asserts the module config's options carry no fallbackModel key, which is still true and still correct. The note now says where the fallback actually reaches the call - degradedPlan since ART-165, substituting into requestedModel and options.model together - and why substituting only the first metered against a model the deployment never called.

3. resumeFromPause said a reset counter would take 'another twelve failures'. It is ten, five rungs at FAILURES_BEFORE_ESCALATION each, which is what degradation.test.ts pins. The note now also accounts for the ART-165 probe cadence: those ten failures are spread across roughly thirty slots, so an over-eager resume costs days of deterministic events rather than minutes.

Flagged by the docs-89 and docs-91 passes, and item 2 was made wrong a second time by ART-165. No test can fail on a comment, so the evidence here is the diff filter plus the unchanged gate.

npm run check - Tests: 4174 passed, 31 skipped, 4205 total; Test Suites: 243 passed, 3 skipped.
<!-- SECTION:NOTES:END -->
