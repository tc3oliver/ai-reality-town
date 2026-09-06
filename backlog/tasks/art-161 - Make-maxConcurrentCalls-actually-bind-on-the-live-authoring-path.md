---
id: ART-161
title: Make maxConcurrentCalls actually bind on the live authoring path
status: Done
assignee: []
created_date: '2026-09-06 15:25'
updated_date: '2026-09-06 16:12'
labels:
  - prd-1.0
  - epic-a
dependencies:
  - ART-160
priority: high
ordinal: 161000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

FR-M003's maxConcurrentCalls is evaluated by evaluateReservation and unit-tested, but it cannot bind: authorSlotScenes walks a slot's scenes sequentially, so inFlight is only ever 0 or 1. ART-59 recorded this and ART-159 narrowed the reason (the three budget moments are now genuinely separate transactions), but the sequential loop is still what stops the limit from meaning anything.

## Goal

A configured limit of N means at most N provider calls are in flight at once, proven by measuring peak concurrency rather than by asserting the setting exists.

## Constraints

No unbounded Promise.all over a slot's scenes. Canon commit order must stay deterministic and independent of response completion order. Reservation happens before the call; release happens exactly once, including on throw and timeout. The limiter must not depend on process-global state for correctness - if Convex action isolation makes a global limiter unsound across invocations, the enforcement has to rest on a durable reservation or lease rather than on a pretence of throttling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With maxConcurrentCalls = N, observed peak in-flight provider calls never exceeds N, measured for N = 1, 2 and 3
- [x] #2 Scenes are authored with bounded concurrency rather than an unbounded fan-out
- [x] #3 Committed event order is identical to the sequential ordering regardless of which provider call finishes first
- [x] #4 A call that throws or times out releases its slot, and capacity recovers for the next call
- [x] #5 Release happens exactly once per granted reservation, including on the failure path
- [x] #6 The correctness argument for the limiter is durable state, not process-local state, and is stated where the limiter is implemented
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
## What was wrong

maxConcurrentCalls has been evaluated by `evaluateReservation` since ART-59 and never bound: `authorSlotScenes` walked a slot's scenes sequentially, so `inFlight` was only ever 0 or 1. A test asserting 'the setting is N' would have passed throughout — the setting was always N and always meaningless.

## Implementation

A bounded worker pool over the scene list, sized by the world's configured limit. An UNCONFIGURED limit (null, the policy default) means 1, not unbounded: reading 'no opinion' as 'fan out over every scene' would empty a shared key allowance in one burst. Results are written by INDEX, so commit order is scene order regardless of which call returns first — Canon's sequence numbers would otherwise depend on gateway latency.

**Why a process-local pool is sound.** It bounds nothing on its own. What makes it correct is ART-160's per-world lease: a second driver for the same world cannot exist, so within a world the pool is the only actor. The durable `inFlight` counter remains the enforcement of record on every reservation; the pool exists so the gate is never asked to grant more than it would allow, which would turn a limit into a stream of refusals. That argument is stated in `authorSlotScenes` itself.

## Peak evidence

`sceneConcurrency.test.ts` (13) measures genuinely OVERLAPPING calls — GatedProvider holds them unresolved until released, so the peak is real. N=1/2/3 each assert the peak REACHES the limit as well as staying under it, or a pool that never started a second call would satisfy every bound while enforcing nothing. Ordering is pinned at every level, and `liveOrchestration.test.ts` shows Canon byte-identical at null/1/3.

Failure path: capacity recovers after a throw, reservations resolve exactly once (granted set == resolved set, no duplicates), and no new scenes start once one has failed.

## Injections

9 (limiter removed) reddened 5 tests; 10 (limit of 1 runs two) reddened the N=1 case; 11 (failed call does not release) reddened the exactly-once test.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the sequential authoring loop with a bounded worker pool sized by maxConcurrentCalls, so the limit binds instead of being evaluated against an inFlight that was only ever 0 or 1. An unconfigured limit means sequential, not unbounded. Results are written by index so commit order is independent of gateway latency, and Canon is byte-identical at every concurrency level. The soundness argument is ART-160's per-world lease — a process-local pool bounds nothing on its own — and it is stated where the pool is implemented. Verified by measuring genuinely overlapping calls at N=1/2/3, asserting the peak both stays under AND reaches the limit, plus exactly-once release on the failure path; three fault injections redden the named tests.
<!-- SECTION:FINAL_SUMMARY:END -->
