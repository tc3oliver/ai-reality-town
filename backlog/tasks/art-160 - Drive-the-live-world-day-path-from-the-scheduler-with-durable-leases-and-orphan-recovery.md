---
id: ART-160
title: >-
  Drive the live world-day path from the scheduler, with durable leases and
  orphan recovery
status: In Progress
assignee: []
created_date: '2026-09-06 15:25'
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
- [ ] #1 A running public world advances scheduler -> prepare -> author -> finalize with no per-stage human invocation
- [ ] #2 Duplicate cron or action delivery cannot author a scene twice, spend budget twice, or commit an accepted event twice
- [ ] #3 A slot whose action never started, crashed, timed out, or finished without finalizing is reclaimed and resumed, reusing already-authored scenes rather than re-paying for them
- [ ] #4 Only one live drive is in flight per world at a time, enforced durably rather than by process state
- [ ] #5 A paused world and an emergency-stopped world are not driven, and cannot author
- [ ] #6 Recovery is safe when an accepted event already exists: the retry resumes or no-ops instead of appending a second event
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
