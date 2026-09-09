---
id: ART-173
title: Measure the dynamic layer at twenty and forty visible characters
status: To Do
assignee: []
created_date: '2026-09-09 18:50'
labels:
  - prd-2.0
  - epic-q
dependencies: []
priority: medium
ordinal: 173000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FR-Q005 fixes three visible-character scenarios for the benchmark — 12, 20 and 40 — and ART-136 AC#6 requires all three. `BENCH_CHARACTER_COUNTS` already lists them, and `bench/dynamicView.bench.ts` already records 20 and 40 as `unreachable` with a reasoned explanation: Mistwood has twelve bound residents, `composeReadOnlyWorldViewModel` drops any character without a visual binding (FR-N004 AC#6), and the roster is pinned against the production bindings — so inventing twelve more would be measuring a world that does not exist, which the ART-107 §8 fixture rule forbids.

That argument is right about the WORLD and wrong about the MEASUREMENT. NFR2-002 AC#4 is a renderer-capacity threshold: can the dynamic layer sustain its frame rate with N animated sprites plus ambient motion. It is not a claim that the town has forty residents. Recording the requirement as unreachable therefore reports a limitation the requirement does not grant.

Scope: a synthetic LOAD PROBE, confined to `src/e2e/` (which `build:e2e` compiles and production never does). No branch in the shipped renderer, no extra entry in `MISTWOOD_CHARACTER_VISUALS`, and no change to the production roster or its pin. The probe places additional sprites so the renderer is driven at 20 and 40, and the report must label those samples as a load probe rather than as a world — a sample that read as "Mistwood has forty residents" would be worse than the current gap.

Out of scope: making the mobile figure conclusive. That needs hardware graphics and stays with ART-136 AC#4 / ART-138 (`docs/prd-2.0-closure-record.md` §6.1).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The benchmark records a sample at twenty and at forty visible characters for every device profile and mode it already covers
- [ ] #2 The recorded sample states that the extra characters are a synthetic load probe, so no reader can take the figure as a claim about the world
- [ ] #3 The production roster, the visual bindings and their pinning tests are unchanged, and no production module gains a benchmark-only branch
- [ ] #4 The benchmark report no longer lists twenty or forty visible characters as unreachable
- [ ] #5 A fault injection proves the probe actually loads the renderer: forcing the probe to place no extra sprites turns a named test red
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
