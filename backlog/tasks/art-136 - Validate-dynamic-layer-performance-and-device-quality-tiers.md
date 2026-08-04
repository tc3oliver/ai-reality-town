---
id: ART-136
title: Validate dynamic layer performance and device quality tiers
status: To Do
assignee: []
created_date: '2026-08-04 16:00'
updated_date: '2026-08-04 16:51'
labels:
  - prd-2.0
  - v2-j
  - epic-o
dependencies:
  - ART-119
  - ART-120
priority: high
type: feature
ordinal: 136000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-Q005 (PRD 2.0 §12 Epic Q) — realizes NFR2-002 (PRD 2.0 §16)

**Problem / Context:** Twelve or more animated sprites plus ambient motion plus environmental animation on mid-tier mobile is the most likely place the dynamic layer fails. PRD 2.0 makes performance a P0 and §22 requires objective evidence for every P0, so "measure it after launch" is not an acceptable disposition — it would allow declaring MVP completion without ever meeting the performance requirement.

**Goal:** A fixed, repeatable pre-launch benchmark that the dynamic layer actually passes, plus a device quality-tier strategy that never corrupts semantic state.

**Scope — the benchmark must fix all of the following before measuring:**
- A named mid-tier mobile device model or an equivalent throttling profile.
- A named browser and version.
- Three visible-character scenarios: 12, 20 and 40.
- A fixed map zoom level and visible-character count per scenario.
- Four stream modes: normal stream, delayed stream, snapshot, degraded.
- An eight-hour continuous run measuring memory growth.
- Pass thresholds for FPS, time to interactive, public dynamic query P95 and runtime-to-screen projection delay.

**Scope — quality tiers:** weaker devices may reduce update rate, but semantic position must never change.

**Out of Scope:** Generation pipeline performance; incremental projection (ART-100).

**Dependencies:** ART-119 (movement rendering), ART-120 (ambient and environmental animation).

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** None.

**Test Requirements:** The benchmark harness itself is a deliverable and must be repeatable. Production field data may supplement the results after launch but must not substitute for the pre-launch gate.

**Validation Commands:**
- `npm run check`
- The benchmark suite, producing recorded figures against every PRD 2.0 NFR2-002 threshold.

**Documentation Impact:** Benchmark specification and recorded results.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Live view shell P95 time to interactive is under four seconds on desktop and six seconds on mobile
- [ ] #2 Public dynamic query P95 is under five hundred milliseconds
- [ ] #3 Runtime to public screen update latency is normally under five seconds
- [ ] #4 Desktop averages at least forty five frames per second and mid-tier mobile at least thirty
- [ ] #5 Reduced frame rate never changes a character semantic position
- [ ] #6 Performance is measured at twelve, twenty and forty visible characters
- [ ] #7 An eight hour run shows no sustained memory growth
- [ ] #8 The benchmark fixes a named mid-tier device or equivalent throttling profile and a named browser version
- [ ] #9 The benchmark covers twelve, twenty and forty visible characters at a fixed map zoom level
- [ ] #10 The benchmark covers normal stream, delayed stream, snapshot and degraded modes
- [ ] #11 The benchmark is repeatable and its recorded results are committed as evidence
- [ ] #12 The benchmark is executed and passed before public release; production field data may supplement but never substitute for it
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
