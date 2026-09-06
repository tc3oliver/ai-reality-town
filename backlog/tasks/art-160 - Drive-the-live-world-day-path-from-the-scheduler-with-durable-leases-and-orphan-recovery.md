---
id: ART-160
title: >-
  Drive the live world-day path from the scheduler, with durable leases and
  orphan recovery
status: Done
assignee: []
created_date: '2026-09-06 15:25'
updated_date: '2026-09-06 16:12'
labels:
  - prd-1.0
  - epic-a
dependencies:
  - ART-159
priority: high
ordinal: 160000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

ART-159 split the live slot into prepare (mutation) -> author (action) -> finalize (mutation), but nothing drives that sequence automatically. The minute cron only RESERVES slots (tickAllPublicSchedules creates queued rows); draining them is an operator invoking three functions by hand.

There is also no recovery for a half-finished sequence. prepareQueuedWorldDaySlot moves a slot to running and leaves it there; if the action never starts, crashes, times out, or finishes without the finalize mutation running, that slot stays running forever and the world stops.

## Goal

A running public world advances on its own, and any interrupted sequence is recovered without re-authoring or re-committing anything.

## Constraints

Mutations must not fetch; provider HTTP stays in the action. Canon validation, safety, idempotency and event persistence keep their current transaction boundaries. The deterministic fake path must still run with no network. The live path must never fall back to FakeWholeSceneProvider. All handoff and recovery state must be durable - nothing in process memory.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A running public world advances scheduler -> prepare -> author -> finalize with no per-stage human invocation
- [x] #2 Duplicate cron or action delivery cannot author a scene twice, spend budget twice, or commit an accepted event twice
- [x] #3 A slot whose action never started, crashed, timed out, or finished without finalizing is reclaimed and resumed, reusing already-authored scenes rather than re-paying for them
- [x] #4 Only one live drive is in flight per world at a time, enforced durably rather than by process state
- [x] #5 A paused world and an emergency-stopped world are not driven, and cannot author
- [x] #6 Recovery is safe when an accepted event already exists: the retry resumes or no-ops instead of appending a second event
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was missing

ART-159 split the live slot into prepare -> author -> finalize but nothing drove it. The minute cron only RESERVES slots, so a deployed world reserved forever and executed none. There was also no recovery: prepare moved a slot to `running` and left it there, so an action that never started, crashed, timed out, or finished without finalizing stopped the world permanently.

## One mechanism for both

`claimLiveSlot` gives a world exactly ONE time-bounded claim. A live lease means 'someone is on it'; an expired one means 'take it over'. That single branch answers duplicate cron delivery, duplicate action delivery, action crash, timeout, process restart and a lost finalize — from the outside they are indistinguishable and the remedy is identical. `busy` means do NOTHING, explicitly not 'take the next queued slot': world time is ordered.

`LIVE_SLOT_LEASE_MS` = 12 min, and MUST exceed the platform action ceiling (Convex caps actions at 10). A shorter lease would expire under a healthy run and let a second driver author the same world. Cost stated: a crashed driver's slot is unavailable for up to that long.

Crons: `tickAllPublicSchedules` (1 min, reserves) / `driveLiveWorlds` (2 min, drains) / `drainAllLivePostCommit` (1 min, stages 11-21). Post-commit is separate because the boundary policy forbids simulation -> operations — and it was never a callback on a slot's commits anyway.

Paused worlds are excluded at listing; emergency-stopped worlds throw out of prepare BEFORE anything is claimed, so a refused world is never left holding a lease. A refusing world is recorded and the tick moves on.

## Evidence

npm run check: 217 suites / 3592 passed, boundaries valid, build clean. npm run e2e: 82 passed.

`liveOrchestration.test.ts` (25) drives the REAL `claimLiveSlot` handler for every interruption case, plus a whole world day through defer -> author -> resume -> commit over the in-memory Canon store with nothing invoked stage by stage. `liveDriverWiring.test.ts` (10) covers the cron entry point and pins the cron registrations, which no runtime test can see.

## Injections

Of the eighteen, five survived first contact and each was a real gap: (1) the driver's world list — no suite covered the cron entry point at all; (3) commit idempotency — masked by the run-level short-circuit, so duplicate FINALIZE was untested; (6) paused worlds — `drivableWorldIds` had no test; (7) the kill switch on the live prepare path; (16) 500-vs-429 classification; (17) the route chain's downgrade-first rule, documented and never tested. All closed; re-injection reddens each by name. No injection was accepted while it produced 'Tests: 0 total'.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired the live world-day path to cron behind a durable per-world lease. claimLiveSlot answers duplicate delivery, action crash, timeout, process restart and lost finalize with one branch, because from the outside they are indistinguishable; resuming is safe because the run restarts from checkpoints, authored scenes are reused rather than re-paid for, and the commit dedups on idempotencyKey. Paused worlds are excluded at listing and emergency-stopped worlds refuse before anything is claimed, so a refused world never holds a lease. Verified by npm run check (217 suites / 3592 passed), npm run e2e (82 passed), 25 orchestration tests against the real claim handler plus a whole automatic world day, 10 driver/cron-registration tests, and 18 fault injections — five of which exposed real test holes that are now closed and re-verified.
<!-- SECTION:FINAL_SUMMARY:END -->
