---
id: ART-162
title: >-
  Wire publishEnabled to the publication boundary as an automatic publication
  gate
status: In Progress
assignee: []
created_date: '2026-09-06 16:56'
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
- [ ] #1 With publishEnabled=false a world day completes and commits Canon normally, but no Public Read Model version is written
- [ ] #2 With publishEnabled=false previously released content stays readable at its last valid version
- [ ] #3 With publishEnabled=true Ready content advances through the normal lifecycle
- [ ] #4 publishEnabled=true cannot release Withheld content
- [ ] #5 publishEnabled=true cannot bypass safety review or release Generated/Validated content directly
- [ ] #6 Changing the flag makes no Canon write, in either direction
- [ ] #7 Removing the gate from the production publication path turns a test red
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
