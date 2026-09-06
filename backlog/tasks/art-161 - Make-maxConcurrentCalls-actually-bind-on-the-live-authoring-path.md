---
id: ART-161
title: Make maxConcurrentCalls actually bind on the live authoring path
status: To Do
assignee: []
created_date: '2026-09-06 15:25'
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
- [ ] #1 With maxConcurrentCalls = N, observed peak in-flight provider calls never exceeds N, measured for N = 1, 2 and 3
- [ ] #2 Scenes are authored with bounded concurrency rather than an unbounded fan-out
- [ ] #3 Committed event order is identical to the sequential ordering regardless of which provider call finishes first
- [ ] #4 A call that throws or times out releases its slot, and capacity recovers for the next call
- [ ] #5 Release happens exactly once per granted reservation, including on the failure path
- [ ] #6 The correctness argument for the limiter is durable state, not process-local state, and is stated where the limiter is implemented
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
