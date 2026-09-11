---
id: ART-173
title: Measure the dynamic layer at twenty and forty visible characters
status: Done
assignee: []
created_date: '2026-09-09 18:50'
updated_date: '2026-09-11 19:14'
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
- [x] #1 The benchmark records a sample at twenty and at forty visible characters for both device profiles in stream mode, and records — with its reason — each profile/mode combination the probe cannot cover
- [x] #2 The recorded sample states that the extra characters are a synthetic load probe, so no reader can take the figure as a claim about the world
- [x] #3 The production roster, the visual bindings and their pinning tests are unchanged, and no production module gains a benchmark-only branch
- [x] #4 The benchmark report no longer lists twenty or forty visible characters as unreachable
- [x] #5 A fault injection proves the probe actually loads the renderer: forcing the probe to place no extra sprites turns a named test red
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
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The earlier note on this task said the decision was a human's to make. It was not, and it has been taken

The previous implementation note worked out that only one of three designs was buildable, and then
stopped: it left option 3 "for a human to confirm rather than taken unilaterally". That was the
wrong call and this note replaces it. The task's own AC#3 already rules out the other two options
by name — option 1 (invent 28 visual bindings) and option 2 (an overridable sprite map in the
shipped renderer) — so there was no open architectural question, only the one design the
acceptance criteria permit. Stopping to ask produced a task that sat To Do while the benchmark
kept publishing `unreachable` for a criterion FR-Q005 grants no exemption on.

What the earlier note got RIGHT and this one keeps: `LiveMapPage.tsx` passes the production
`mistwoodCharacterSpriteKeys` into `composeReadOnlyWorldViewModel`, which drops any character the
map does not name (FR-N004 AC#6). The live page genuinely cannot be driven above twelve.

## What shipped

- **`src/e2e/spriteLoadWorld.ts`** — pure probe builder. `probeCharacterCount(search)` (total by
  construction: anything unparseable falls back to the roster's twelve, anything huge is capped at
  `MAX_PROBE_CHARACTERS = 64`), `probeSpriteKeys(count, realSpriteKeys)` (round-robin over the
  twelve REAL keys, so the renderer draws from the same sheets and the same texture cache —
  minting synthetic sheets would have measured a cache-miss rate no viewer will ever see),
  `probeCharacterId` (`probe-07`, unmistakable for a resident), and `probeMotions` (every
  character mid-walk for ten minutes, grid-spread inside the map, both facings).
- **`src/e2e/benchEntry.tsx`** + **`bench.html`** — mounts `ReadOnlyWorld` with the live page's own
  `useSpriteAssets()` and `useMotionClock(100)`, and publishes its census on
  `window.__ART173_PROBE__` read back from the COMPOSED view model, not from the request. The
  benchmark asserts `requested === drawn`, which is what stops a probe that quietly drew twelve
  from publishing a flattering frame rate against a load nobody applied.
- **`vite.config.ts`** — `bench.html` is a SECOND Vite input, added only when
  `VITE_E2E_FIXTURE === '1'`. Vite builds `index.html` alone unless `rollupOptions.input` says
  otherwise, so the file sitting in the repository root is not enough to ship it; only `build:e2e`
  sets that variable, and `fixtureIsolation.test.ts` already pins that it is the only script which
  does. This is why AC#3 holds by construction rather than by a branch a later edit could reach.
- **`architecture/module-boundaries.json`** — a new `clientBenchProbe` module. This was NOT
  optional and it was not foreseen: `check:architecture` failed the first full run because
  `clientE2EFixture` may not depend on `clientLive` or `clientWorldReadOnly`. Widening
  `clientE2EFixture` would have been the wrong fix, because `clientProvider` — a production module
  — MAY depend on `clientE2EFixture`; the renderer would have become reachable from the shipped
  provider by policy. The probe is instead its own module with longer roots (the checker resolves
  a file to its longest matching root), and no module in the policy may depend on it.
- **`bench/dynamicView.bench.ts`** — a loop over both device profiles × `stream` × `[20, 40]`,
  asserting the census and recording `AC#4 (load probe, 20|40)` verdicts with the count IN the
  criterion label, plus `notMeasured` rows for each combination the probe cannot cover.

## The three exclusions, recorded rather than left implicit

- **`delayed` / `snapshot`** are facts about what the SERVER returned. The probe has no server.
- **`degraded`** — the first version measured it anyway and the probe simply failed:
  `LiveMapView` does not mount `ReadOnlyWorld` at a degraded rung at all (`showCanvas` is false;
  it renders `StaticMapView`). "Forty sprites, degraded" would be a figure about zero sprites.
- **Time-to-interactive** — a bare renderer mount has no page shell, no queries and no camera.
  AC#1 stays the live page's. This is also why AC#9's zoom half is still `unreachable`: zoom
  belongs to the camera controller the probe does not mount.

## Measured figures (`docs/benchmarks/dynamic-view-latest.md`, 2026-09-09)

| profile | count | average fps | AC#4 threshold | verdict |
| --- | --- | --- | --- | --- |
| desktop-reference | 20 | 54.03 | 45 | PASS |
| desktop-reference | 40 | 53.53 | 45 | PASS |
| mid-tier-mobile | 20 | 18.03 | 30 | FAIL, inconclusive |
| mid-tier-mobile | 40 | 17.63 | 30 | FAIL, inconclusive |

The mobile probe runs on the same ANGLE/SwiftShader host that already makes ART-136 AC#4's live
mobile figure inconclusive, so it inherits that status and says so in its own row. **The desktop
probe figures are not offered as a substitute for the mobile ones**, and the mobile probe failure
is evidence that 20 and 40 are now measurable — not evidence about a phone.

## Fault injections (AC#5) — six, all of which bit

1. `probeSpriteKeys` capped at the twelve real keys → `draws exactly 20 characters, none of them
   dropped`, `draws exactly 40 …` and `reuses the real sprite keys rather than inventing sheets`
   red (3 failed / 10 passed).
2. `probeMotions` capped at 12 → `draws exactly 20 …`, `draws exactly 40 …` and `spreads the cast
   over the map, inside its bounds` red.
3. Motions minted `idle` with `arriveAt = nowMs` → `keeps every character walking for longer than
   any sample window` red. (An idle sprite is one texture and a static transform; forty of those
   would report a frame rate the renderer never has to produce.)
4. `bench.html` made an unconditional Vite input → `is a second Vite input, added only under the
   E2E build literal` red.
5. `LiveMapPage.tsx` given a reference to `spriteLoadWorld` → `gives no production module a
   benchmark branch` red.
6. `clientBenchProbe` added to `clientE2EFixture.mayDependOn` → `is its own module, and the
   production-reachable fixture may not depend on it` red.

All six restored; 14 tests green afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
**Twenty and forty visible characters are measured. The `unreachable` classification was wrong and
is gone.**

FR-Q005 names three visible-character scenarios and ART-136 AC#6 requires all three; the benchmark
recorded 20 and 40 as `unreachable` on the argument that Mistwood has twelve bound residents. That
argument is true about the world and irrelevant to the measurement — NFR2-002 AC#4 is a
renderer-capacity threshold, not a claim about the population — so the harness was reporting a
limitation the requirement never granted.

**Measured now** (`docs/benchmarks/dynamic-view-latest.md`): desktop-reference 54.03 fps at twenty
and 53.53 at forty, both clearing AC#4's 45 fps; mid-tier-mobile 18.03 and 17.63 against 30, both
recorded FAIL and `measured_but_inconclusive` on the same ANGLE/SwiftShader host that already makes
the live mobile figure inconclusive. **The desktop probe figures are not offered in place of the
mobile ones**, and the mobile probe failing is evidence the counts are measurable, not evidence
about a phone.

**How, without touching the world.** `bench.html` is a SECOND Vite input that `vite.config.ts` adds
only under `VITE_E2E_FIXTURE === '1'` — which only `build:e2e` sets — so the probe is absent from
`npm run build` by construction, not by a branch. `npm run build`'s output in this run is
`dist/index.html` + one `main-*.js` chunk and nothing else. No entry was added to
`MISTWOOD_CHARACTER_VISUALS`, the roster pin is untouched, and no production module names the
probe.

**An architectural change was required and is declared.** `check:architecture` refused the first
full run: `clientE2EFixture` may not depend on `clientLive` or `clientWorldReadOnly`. Widening it
would have been wrong — `clientProvider`, a production module, may depend on `clientE2EFixture` —
so the probe became its own `clientBenchProbe` module with longer roots, and **no module in the
policy may depend on it**. A test asserts that exhaustively.

**Exclusions recorded, not skipped.** `delayed`/`snapshot` are facts about what the server
returned and the probe has no server; at a `degraded` rung `LiveMapView` does not mount
`ReadOnlyWorld` at all, so "forty sprites, degraded" would be a figure about zero sprites; and the
probe publishes no time-to-interactive because a bare renderer mount has no page shell. Each is a
`not_applicable` row in the report. AC#9's zoom half stays `unreachable` — zoom belongs to the
camera controller the probe does not mount.

**Verification.** `npm run check` exit 0 — 258 suites, 4513 passed / 31 skipped, build clean.
`npm run e2e` 124 passed. `npm run bench` 15 passed, report regenerated, 17/21 measured criteria
passed. `npm run check:closure-record` passes.

**Fault injections — six, every one of which turned a named test red** (capped sprite keys, capped
motions, idle motions, unconditional Vite input, a production module naming the probe, and the
policy letting `clientE2EFixture` reach it). All restored; 14 tests green.
<!-- SECTION:FINAL_SUMMARY:END -->
