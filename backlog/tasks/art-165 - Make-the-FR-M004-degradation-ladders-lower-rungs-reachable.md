---
id: ART-165
title: Make the FR-M004 degradation ladder's lower rungs reachable
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-08 17:55'
updated_date: '2026-09-08 17:58'
labels:
  - prd-1.0
  - epic-p
dependencies:
  - ART-91
priority: high
ordinal: 165000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M004, PRD Section 16.3

Problem / Context
ART-91 shipped the six-rung degradation ladder and wired it into the live runtime. Reading the wiring end to end shows that only the first four rungs can ever be reached.

convex/simulation/providers/liveWorldDayActions.ts records authored: true for ANY completed slot returned as settled, which includes a rules-only slot. advanceDegradation recovers one rung on any authored: true. So a world that has descended to rules_only completes its next deterministic slot, is credited with a successful authoring it never performed, and climbs straight back to fewer_scenes. Escalation past rules_only needs two consecutive FAILURES at rules_only, and a rules-only slot only fails if its own derivation or commit fails.

The consequence is that deferred_summaries and paused are implemented, tested as pure functions, exposed through an operator resume path, and unreachable by the outage they exist for. A world in a total provider outage oscillates between fewer_scenes and rules_only forever, paying for a failed provider call two slots out of every three, and never reaching the rung that stops asking.

It also means a rules-only slot is treated as evidence that the PROVIDER is working, which is the one thing it cannot be evidence of: no provider call was made.

Goal
Make every declared rung reachable by the failure it is declared for, and make recovery depend on evidence that the provider actually worked.

Scope
The runtime feedback the ladder is given, and the provider probe that lets a rules-only world learn the outage is over. The rung order, the level policies and the operator resume path are unchanged.

Out of Scope
New rungs, new operator surfaces, changes to Canon validation, safety, idempotency or event persistence, and any change to what a level permits.

Schema Impact
No new production domain schema unless a probe cadence needs persisting alongside the existing degradation state.

Security Impact
None. The ladder decides authoring cost, never authorization.

Validation Commands
npm run check; npm test -- --runTestsByPath convex/simulation/degradation.test.ts; npm test -- --runTestsByPath convex/operations/degradationIntegration.test.ts

Test Requirements
A test must drive a sustained outage through the real pipeline and reach paused, and a test must show that a completed rules-only slot does not by itself recover a rung. Both must be shown to fail against the current behaviour before the fix.

Documentation Impact
Operations documentation describing the ladder.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A sustained provider outage escalates through every rung and reaches paused, one rung at a time, with no rung skipped.
- [ ] #2 A completed rules-only slot does not by itself recover a rung; only evidence that the provider authored does.
- [ ] #3 A world on a rules-only rung still learns that the provider has recovered, and climbs back one rung at a time.
- [ ] #4 Canon Validation, Safety Validation, Idempotency and Event Persistence are unchanged at every rung, and no rung falls back to the deterministic fake author.
- [ ] #5 Every transition remains individually traceable and idempotent on its derived id.
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
1. Reproduce, with tests that fail against today's behaviour:
   - drive a sustained provider outage through the real long-run fixture and assert the world reaches paused; today it oscillates fewer_scenes <-> rules_only forever.
   - assert that a completed rules-only slot alone does not recover a rung; today it does.
   - assert that re-delivering ONE slot outcome cannot move the world twice; today the transition row dedups but the state row is patched anyway, so a duplicate delivery escalates the ladder, and the schema docblock claims the opposite.
2. Extend the pure decision in convex/simulation/degradation.ts:
   - SlotOutcomeSignal gains usedProvider. A slot that called no model is not evidence about the model, either way.
   - DegradationState gains slotsSinceProviderProbe and lastSignalKey.
   - advanceDegradation returns the state unchanged when the signal key repeats.
   - a no-provider slot advances the probe counter only, and only while the rung does not use the provider.
   - a provider slot resets the counter, then recovers or escalates exactly as before.
3. Add the probe: SLOTS_BETWEEN_PROVIDER_PROBES and effectivePolicy(state). A rules-only world spends one slot per world day attempting the cheapest real authoring. A probe that authors climbs a rung; a probe that fails counts a failure, so rules_only -> deferred_summaries -> paused becomes reachable by the outage it is declared for. A paused world never probes: that is what paused means.
4. Wire it: prepareQueuedWorldDaySlot uses effectivePolicy and reports whether the slot is a probe; driveOneWorld records usedProvider honestly for both the authored and the settled branch.
5. Persist the two new state fields as optional, so existing rows read back, and reuse applyDecision in resumeDegradation instead of its second copy of the same write.
6. Re-run the three tests, then the focused degradation suites, then npm run check.
<!-- SECTION:PLAN:END -->
