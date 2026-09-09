---
id: ART-173
title: Measure the dynamic layer at twenty and forty visible characters
status: To Do
assignee: []
created_date: '2026-09-09 18:50'
updated_date: '2026-09-09 19:09'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The design sketched in the description does not survive contact with the code

I checked before starting, and the "confined to `src/e2e/`" plan cannot be built as written.

`LiveMapPage.tsx:393` passes `spriteKeys: mistwoodCharacterSpriteKeys` — a production constant derived from `MISTWOOD_CHARACTER_VISUALS` — straight into `composeReadOnlyWorldViewModel`, which drops any character the map does not name (`worldViewModel.ts:238`, FR-N004 AC#6). So extra characters injected by the fixture are dropped before they reach the renderer, and the fixture has no way to widen that map without the page reading a different one.

That leaves three options, and they are not equivalent:

1. **Add 28 more production visual bindings.** Rejected: it changes what Mistwood IS to make a number appear, which is the fixture rule (ART-107 §8) exactly.
2. **Let the live page take its sprite map from somewhere overridable.** This is the smallest code change and the worst one: it puts a benchmark seam in the shipped renderer, which AC#3 of this task forbids for good reason.
3. **A bench-only surface that mounts the read-only renderer directly with a synthetic sprite map.** Confined to `src/e2e/`, no production branch, and it measures the thing NFR2-002 AC#4 is actually about — renderer capacity with N animated sprites. The cost is that the figure is "the renderer at 40 sprites", not "the live page at 40 characters", and the report would have to say so.

Option 3 is the only one that satisfies this task's own acceptance criteria, and it is an architecture decision about what the benchmark measures — not a defect fix. It is left for a human to confirm rather than taken unilaterally, because the alternative reading (that FR-Q005's three scenarios are a claim about the world, which is what `CHARACTER_COUNT_LIMIT` currently argues) is also defensible and is the position already recorded in the harness.

What is NOT in doubt: recording 20 and 40 as `unreachable` with no task attached was the wrong end state, because FR-Q005 asks for them and the PRD grants no exemption. That part is fixed by this task existing.
<!-- SECTION:NOTES:END -->
