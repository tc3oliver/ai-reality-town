---
id: ART-162
title: >-
  Wire publishEnabled to the publication boundary as an automatic publication
  gate
status: Done
assignee: []
created_date: '2026-09-06 16:56'
updated_date: '2026-09-06 17:10'
labels:
  - prd-1.0
  - epic-a
dependencies:
  - ART-160
priority: high
ordinal: 162000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`publishEnabled` is stored on every world schedule and copied onto every scheduled slot, and nothing outside tests reads it. A field named for a publication control that gates nothing reads as a safety switch while enforcing nothing — the gap audit at the end of the live-runtime work surfaced it.

## Decision

Keep the field and give it one meaning: an AUTOMATIC PUBLICATION GATE.

It may only SUPPRESS publication. It may never force it.

`publishEnabled = false`
- simulation, Canon commit, Episode/Recap derivation, and the Safety/Editorial lifecycle all run exactly as before
- publication stops at Ready and never advances further
- the Public Read Model is not updated
- whatever is already live keeps serving its last valid version

`publishEnabled = true`
- Ready content may continue through the normal lifecycle
- it does NOT bypass Safety, Editorial or the publication lifecycle
- it does NOT override Withheld
- it does NOT release Generated or Validated content directly
- it does not touch Canon at all

## Constraint

The judgement lives at the publication boundary, not scattered through simulation stages. Changing the flag must never modify existing Canon.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With publishEnabled=false a world day completes and commits Canon normally, but no Public Read Model version is written
- [x] #2 With publishEnabled=false previously released content stays readable at its last valid version
- [x] #3 With publishEnabled=true Ready content advances through the normal lifecycle
- [x] #4 publishEnabled=true cannot release Withheld content
- [x] #5 publishEnabled=true cannot bypass safety review or release Generated/Validated content directly
- [x] #6 Changing the flag makes no Canon write, in either direction
- [x] #7 Removing the gate from the production publication path turns a test red
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
## Design

Two boundaries, and only two. `commitReadModelVersion` consults the store BEFORE anything is read or written — a gate that suppressed the insert but still demoted the current row would blank the public surface instead of freezing it, which is the opposite of AC#2. `advancePublication` gates the single forward transition to `published`; validate / begin_safety_review / pass_safety_review / resume_to_ready and especially **withhold** all still run with the gate closed, because refusing to record a safety withhold while publication is paused would be a gate that made a world less safe.

`publicationEnabled` is on the PublicReadStore PORT rather than an argument to `commitReadModelVersion`: there are 28 projection writers, a parameter would put the same judgement in 28 places, and the 29th would forget it. Required rather than optional, so a new binding cannot enforce nothing by omission — which is exactly how this field came to gate nothing since ART-18.

The rule is one pure function in `convex/shared/publicationGate.ts`, taking the schedule ROW rather than a db handle so `shared` keeps depending on nothing. An absent schedule stays open: the scheduler writes worldSchedules, so a fixture or import has expressed no opinion, and reading absent as suppressed would blank every read model in the offline gate.

The asymmetry is structural: `isPublicationEnabled` takes a row and returns a boolean, with no record in scope, so there is no expression in which it could advance a status.

## Evidence

npm run check: 218 suites / 3620 passed, boundaries valid, build clean. npm run e2e: 82 passed.

`publicationGate.test.ts` (25) covers all seven ACs, including the deployed bindings driven against a real schedule row — the fixture tests prove the gate works, these prove production uses it.

## Injections (AC#7)

A: writeStore hard-codes the gate open -> 1 failed. B: the forward transition ignores the gate -> 1 failed. C: gate removed from commitReadModelVersion -> 8 failed. D: gate suppresses the insert but still demotes the live row -> 3 failed, which is the subtle one AC#2 exists for. No injection produced 'Tests: 0 total'.

Note: an early injection round reverted uncommitted implementation files via `git checkout`; the work was rebuilt and the process corrected to commit before injecting.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gave publishEnabled one meaning as an automatic publication gate that can only suppress, never force. Enforced at exactly two boundaries — commitReadModelVersion before any read or write, so a suppressed world freezes rather than blanks; and the single forward transition to published, leaving withhold and every earlier lifecycle step ungated. The rule is one pure function in shared taking the schedule row, so shared still depends on nothing and the two boundaries cannot disagree about an unscheduled world. Verified by npm run check (218 suites / 3620 passed), npm run e2e (82 passed), 25 tests covering all seven ACs including the deployed bindings against a real schedule row, and four injections that each redden named tests.
<!-- SECTION:FINAL_SUMMARY:END -->
