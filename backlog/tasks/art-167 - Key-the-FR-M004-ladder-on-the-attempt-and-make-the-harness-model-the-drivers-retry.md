---
id: ART-167
title: >-
  Key the FR-M004 ladder on the attempt, and make the harness model the driver's
  retry
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-08 22:31'
updated_date: '2026-09-08 22:32'
labels:
  - prd-1.0
  - epic-p
dependencies:
  - ART-165
  - ART-73
priority: high
ordinal: 167000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M004, PRD Section 16.3, NFR-007

Problem / Context
The ART-73 final gap audit found a regression ART-165 introduced, larger than the one ART-165 fixed.

ART-165 made advanceDegradation ignore a signal whose key already moved the world, to stop one outcome delivered twice from counting twice. The key is the SLOT: worldDay:timeSlot. On the deployed path that is the only key a persistent outage ever produces.

driveOneWorld stops on the first slot that did not complete. An authoring failure is deliberately not a slot failure - executeSlot leaves the row running on a SCENE_AUTHORING_DEFERRED, which is the code path every outage takes because the finishing pass re-raises it with no provider. claimLiveSlot then consults the running row before anything queued and, once the twelve-minute lease lapses, hands the same row back with attemptCount + 1. There is no attempt cap. So the driver retries one slot forever and never produces a second slot key.

FAILURES_BEFORE_ESCALATION is two, and reaching two needs two signals with different keys. consecutiveFailures freezes at one and the world never leaves normal. Every rung below it is implemented, tested and operator-exposed, and no provider outage can reach any of them - which is a strictly larger version of the bug ART-165 set out to fix.

The reason no gate caught it is the second half of this task. runDegradationLadderDays iterates worldDay by timeSlot unconditionally, with no stop-on-failure and no re-delivery, so the dedup branch is never taken anywhere in the harness while the deployment takes it on every retry. Two gates rest on that harness being the model of the live driver, and both would pass unchanged if the deployment could never descend at all.

Goal
A slot that fails on two attempts is two failures, a re-delivered outcome of one attempt is still one, and the long-run harness retries a failed slot the way the driver does.

Scope
The signal key and the attempt that carries it, the two production call sites that feed the ladder, the harness driver's loop, and the resilience assertions that describe its shape.

Out of Scope
The rung order, the level policies, the probe cadence, the operator resume path, and any change to what a level permits.

Schema Impact
None. The attempt is already carried on scheduledSlots.attemptCount and on WorldDaySlotOutcome.

Security Impact
None.

Validation Commands
npm run check; npm test -- --runTestsByPath convex/simulation/degradation.test.ts; npm test -- --runTestsByPath convex/operations/degradationIntegration.test.ts; npm run test:ninetyday

Test Requirements
A test must show two attempts at one slot escalating and one attempt delivered twice not escalating. The harness driver must retry a failed slot, and the resilience gate must assert the shape that produces.

Documentation Impact
docs/long-run-simulation-harness.md must say that the driver retries a failed slot and that the harness models it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A slot that fails on two separate attempts escalates the ladder; one attempt whose outcome is delivered twice does not.
- [ ] #2 A persistent provider outage on the deployed path reaches every rung, including paused.
- [ ] #3 runDegradationLadderDays retries a failed slot the way driveOneWorld does, and the divergence that hid this is closed.
- [ ] #4 The harness reports usedProvider from whether the slot reached the provider, not from the rung's policy.
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
