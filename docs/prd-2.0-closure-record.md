# PRD 2.0 Dynamic Viewing MVP — closure record (ART-138)

**Audited:** 2026-09-09, against `main` at the commit this document lands on.
**Method:** every §22 criterion re-derived from the repository and, where possible, from the running
deployment. The historical notes on ART-138 were **not** carried forward — several of them named
blockers that have since been fixed, and one described the deployment as unusable when it is not.

PRD 2.0 §26 forbids claiming MVP completion until every §22 criterion has objective evidence, and
§22.28 forbids declaring product completion from backend completion alone. This document is
therefore written to be readable as a refusal as much as a claim: **the MVP is not complete**, and
§6 says exactly what is missing, why code cannot supply it, and what the owner has to do.

---

## 1. Verdict vocabulary

| Verdict | Meaning |
| --- | --- |
| `PASS` | Repository or deployment evidence proves the criterion, and the evidence is named. |
| `FAIL` | Evidence exists and shows the criterion is not met. |
| `EXTERNAL_BLOCKED` | Cannot be settled without a real device, a deployment, or an owner-only action. §6 lists each one with the operation and the acceptance command. |

`NOT_APPLICABLE` is deliberately unused. Nothing in §22 is optional, and the PRD grants no
exemption to any of the thirty-one.

---

## 2. Summary

**PRD 2.0 §22 — the thirty-one MVP criteria**

| Verdict | Count |
| --- | ---: |
| PASS | 31 |
| FAIL | 0 |
| EXTERNAL_BLOCKED | 0 |
| **Total** | **31** |

**ART-138's own thirteen acceptance criteria (FR-Q008)**

| Verdict | Count |
| --- | ---: |
| PASS | 12 |
| FAIL | 0 |
| EXTERNAL_BLOCKED | 1 |
| **Total** | **13** |

**MVP closure: NOT COMPLETE — but every remaining item is one owner action.** All thirty-one §22
criteria now pass. §22.30 was the last FAIL and stopped being one on 2026-09-13, when ART-138 found
that the frame rate had never been measured on a GPU: the benchmark launched Playwright's default
headless Chromium, a build with no GPU support, so it bound SwiftShader on a host with an Apple M2
and published the result as a statement about a phone. See §6.1 — the criterion was not blocked on
hardware this project lacks, it was blocked on a harness that could not reach the hardware it had.

**One** of this gate's own thirteen criteria remains: AC#10, the public acceptance environment,
which needs a production deploy and a world-mode change that `CLAUDE.md` §5 forbids an agent from
performing. §6.3 gives the operation, the rollback, the acceptance command and the pass threshold;
§6.2's deployment corroboration for §22.29 is satisfied by the same deploy.

The two counts are kept apart on purpose. §22 is about the PRODUCT; ART-138's AC#10 and AC#11 are
about the ENVIRONMENT this gate runs in. Merging them would let an environment blocker read as a
product failure, or a product pass read as an environment one.

---

## 3. The thirty-one criteria

| # | Criterion (§22) | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | PRD 1.0 P0 still passes | PASS | `docs/prd-1.0-closure-matrix.md` — 128 clause rows, 108 `P0 delivered`, held equal to its own summary by `npm run check:closure-matrix` (ART-152). Regression is covered by the whole suite running in `npm run check`. |
| 2 | ART-99 fixed, with a fixed-seed regression test | PASS | `convex/canon/snapshotManager.test.ts`, `describe('ART-99 seeded-world baseline replay and verification')` — `creates a daily snapshot for a world seeded through importWorld, equal to baseline + accepted events`, `does not double-apply events across the seeded baseline over several days`, `rejects a modified seeded baseline as corrupt`. Confirmed live: the deployment holds an `initial` snapshot AND a `daily` snapshot at world day 4 (`lastSequenceNumber: 77`) for the seeded Mistwood world — the exact combination that used to raise `SNAPSHOT_CORRUPT`. |
| 3 | `/live` shows an operable but uncontrollable 2D map | PASS | `e2e/dynamicView.spec.ts` — `AC#1 — /live loads the map, not the WebGL fallback`, `AC#7 — pan, zoom and return to town view all work`, `AC#10/#11 — watching the world writes nothing and asks for no generation`. |
| 4 | All 12 characters have a valid Visual Binding | PASS | `convex/visual/mistwoodVisualBindings.test.ts` — `binds every seeded character exactly once and passes import validation`, `is deterministic, so a redeploy cannot change any appearance`. `convex/publicRead/publicDynamicProjection.test.ts` asserts `characters` has length 12 on the published projection. Confirmed live: the 83 accepted events in the deployment name all twelve seeded residents, and twelve `character` read models are current. |
| 5 | All 8 Mistwood locations have a valid Location Binding, semantically matching the map | PASS | `convex/visual/mistwoodLocationBindings.test.ts` — `mistwoodLocationVisualBindings` has length 8; `convex/canon/mistwoodSeed.test.ts` pins the seed at 8 locations; `convex/visualRuntime/mistwoodRuntime.test.ts` pins 8 runtime bindings. Confirmed live: accepted events reference all eight. |
| 6 | Canon location changes render as smooth cross-location movement | PASS | `convex/publicRead/canonRuntimeSync.test.ts` — `turns an accepted move into a motion ending at the destination zone`, `publishes animationState "walking" before arrival`. Browser: `e2e/dynamicView.spec.ts` `AC#3 — a motion in flight animates continuously rather than teleporting`. |
| 7 | Idle / Walking / Speaking / Thinking are distinguishable | PASS | `e2e/dynamicView.spec.ts` `AC#4 — the four animation states read differently on the card`; `e2e/liveAccessibility.spec.ts` `every animation state has a readable text alternative on the card` (so the distinction is not colour-only). |
| 8 | Ambient movement runs inside a zone with zero Canon side effects | PASS | `convex/visualRuntime/ambientAnchor.test.ts`; `convex/publicRead/canonRuntimeSync.test.ts` `leaves every Canon row byte-identical across a rebuild` and `creates no Canon row even when the runtime cannot place a character`. |
| 9 | Visual Replay auto-plays once, is manually triggerable, and calls no LLM | PASS | `e2e/dynamicView.spec.ts` `AC#9 — the replay auto-plays once, is skippable, and replays on request`; `convex/publicRead/visualReplay.boundary.test.ts` pins the builder's executed import closure so a path to a generator or a writer cannot appear unnoticed. |
| 10 | 重播 / 稍早 / 現在 are clearly distinguishable | PASS | `e2e/liveAccessibility.spec.ts` — `it is still axe-clean during playback, when three time states are on screen`, `the time states survive greyscale, because they differ in shape and in words`. |
| 11 | Active Scene is shown in sync on the map and the story overlay | PASS | `e2e/dynamicView.spec.ts` `AC#6 — focusing an active scene presses the control and its summary is on screen`; `convex/publicRead/activeScenePresentation.test.ts`. |
| 12 | Clicking a character opens the public character card | PASS | `e2e/dynamicView.spec.ts` `AC#5 — pressing a character control opens their card, and closing returns focus`. |
| 13 | Clicking a scene shows the public summary | PASS | `e2e/dynamicView.spec.ts` `AC#6 — focusing an active scene presses the control and its summary is on screen`. |
| 14 | Public viewing sends no heartbeat | PASS | `convex/publicRead/publicReadOnlyGuarantee.test.ts` — `no human-player, heartbeat or world-lifecycle function survives`, `no declared public function is named for joining, moving, chatting or a heartbeat`. Structural: the function does not exist, so it cannot be called. |
| 15 | Public viewing creates no Human Player | PASS | Same suite, same two tests, plus `convex/operations/emergencyStopControls.test.ts` `ART-112: the restart cron, heartbeat, and every upstream client input route no longer exist`. |
| 16 | Public viewing performs zero successful mutations | PASS | `convex/publicRead/publicReadOnlyGuarantee.test.ts` `describe('AC#6/#7 — public mutations refuse unauthorized callers server-side')` — every operator mutation is invoked with an anonymous ctx and must raise `OPS_UNAUTHORIZED` with `state.touched === false`. The three declared viewer writes are bounded and enumerated separately (`the declared viewer writes are exactly three bounded surfaces`). Browser: `e2e/dynamicView.spec.ts` `AC#10/#11 — watching the world writes nothing and asks for no generation`. |
| 17 | Public viewing adds no LLM calls | PASS | `convex/publicRead/publicReadOnlyGuarantee.test.ts` `describe('AC#5 — public viewing adds no LLM trace')`; `convex/publicRead/readModel.test.ts` `AC#6 §16.3: LLM-call count is invariant as public read volume increases`. Structural: `architecture/module-boundaries.json` forbids `publicRead` from depending on `simulation`, where the adapters live. |
| 18 | Public projection contains no private data | PASS | `convex/publicRead/publicReadOnlyGuarantee.test.ts` `describe('private data never survives a public read')`; `convex/publicRead/readModel.test.ts` `sanitizeForPublic (AC#4 — field allowlist)`. The one carve-out (ART-169's viewer-known secrets) is scoped per model kind and pinned by `strips those same keys for every other kind`; the secrets it admits are only ever those a released Episode already revealed. |
| 19 | Canon/Runtime drift is detectable with no unhandled major conflict | PASS | `convex/publicRead/canonRuntimeMismatch.ts` + `convex/publicRead/canonRuntimeSync.test.ts`; operator-visible through `inspectDynamicViewMetrics` (`convex/operations/dynamicViewMetricsFunctions.test.ts`). |
| 20 | A last-valid snapshot is usable when the runtime is interrupted | PASS | `convex/publicRead/runtimeSnapshot.test.ts`; `convex/publicRead/readModel.test.ts` `AC#7: stays available when a later projection write fails (LKG keeps serving)`. |
| 21 | Renderer failure degrades, and historical content stays readable | PASS | `e2e/dynamicView.spec.ts` `describe('the degradation ladder (FR-O010 / ART-127)')` — `AC#1/AC#3 — a browser without WebGL gets the static plan, labelled, not a blank page`, `AC#2 — Episode content is untouched by the ladder`, `AC#4 — a renderer that cannot start writes nothing and asks for no generation`. |
| 22 | Desktop and mobile E2E pass | PASS | `npm run e2e` — **124 passed** across the `desktop` and `mobile` (Pixel 5) projects, on this working tree. Repeated in CI on every PR as the required "Browser E2E (desktop + mobile)" check. |
| 23 | Reduced Motion and a non-map alternative view are available | PASS | `e2e/liveAccessibility.spec.ts` `describe('AC#3 — Reduced Motion is honoured, not merely declared')` and `describe('AC#1 — the world is comprehensible without the map')`; `e2e/p1Accessibility.spec.ts` `the graph draws an SVG, and every fact in it is also written out`. |
| 24 | Asset licence and attribution records are complete | PASS | `npm run check:asset-licenses` and `npm run test:asset-licenses`, both inside `npm run check`. |
| 25 | Public Authorization Audit passes | PASS | `convex/publicRead/publicReadOnlyGuarantee.test.ts` in full — 44 tests, including `each declared function carries the runtime visibility its policy entry claims` (declared == found, exhaustively) and `the deployment routes zero public HTTP endpoints`. Enforced at build time by `npm run check:architecture` against `publicFunctionSurface`. |
| 26 | Typecheck, lint, tests, build and CI all pass | PASS | `npm run check` exit 0 on this tree. CI runs the same gate plus the browser suite as required checks on every PR. |
| 27 | Every V2 P0 requirement has a task and objective evidence | PASS | Every PRD 2.0 Dynamic Viewing task (ART-113 … ART-137, ART-140) is `Done`; the board's only remaining items are this gate and ART-136. Per-requirement evidence is in `docs/prd-2.0-requirement-matrix.md` §3. See §5 below for the one thing this does **not** claim. |
| 28 | The closure record does not claim MVP completion from backend completion | PASS | This document. §2 records the MVP as **not complete**, and the reason is a browser-measured frame rate — the failure mode §22.28 exists to prevent. |
| 29 | ART-139 fixed; the real provider produces Accepted Events, with a regression test | PASS | `convex/simulation/sceneSimulation.test.ts` (`ART-139 real-provider schemaVersion contract`) and `convex/canon/proposedEvent.test.ts`. The accepted-event chain was verified live against the configured gateway during ART-141: 2/2 runs took a real provider `ProposedEvent` carrying `character_location_changed` through `parseWholeSceneOutput → normalizeProposedEventOutput → validateEventStructure → validateCanon → appendCommit`. ART-157 then fixed the prompt so a movement proposal names a legal destination, and ART-159/ART-160 wired the real adapter into the scheduled live path. See §5 for what the CURRENT deployment can and cannot corroborate. |
| 30 | The dynamic-layer benchmark is established **and actually passed** | PASS | `docs/benchmarks/dynamic-view-latest.md`, re-recorded 2026-09-13 on hardware graphics (`ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)`): **21/21 measured criteria pass**, mid-tier mobile at 60 fps against a 30 fps threshold in all four modes, and the ART-173 load probe at 60 fps at both twenty and forty sprites. Every earlier run bound SwiftShader because the harness launched a GPU-less Chromium build — §6.1 is the whole story, including why the 29.26 fps figure this row used to carry was never evidence about a device. AC#7 is settled separately by the 480-minute soak (§6.1). |
| 31 | Visual Replay references only published identifiers and versions, and invalidates on withhold/supersede | PASS | `convex/publicRead/visualReplay.test.ts` + `convex/publicRead/visualReplayFunctions.test.ts` — the read-time gate requires a matching `publicationVersion` AND a servable status, so a withheld or superseded record stops resolving without a rebuild. Since ART-171 the status list has one definition, `VIEWER_SERVABLE_PUBLICATION_STATUSES`; `convex/publicRead/visualReplay.boundary.test.ts` pins the builder's whole import closure. |

---

## 3b. ART-138's own acceptance criteria (FR-Q008)

| AC | Criterion | Verdict | Evidence or blocker |
| --- | --- | --- | --- |
| 1 | All §22 criteria have cited objective evidence | PASS | §3 above — every one of the thirty-one names a file and a test, or a recorded measurement. |
| 2 | ART-99 fixed and covered by a fixed-seed regression test | PASS | §3 #2. |
| 3 | Twelve character bindings and eight location bindings verified complete | PASS | §3 #4/#5, corroborated against real Canon in §4 rather than against fixtures alone. |
| 4 | Successful public mutations are zero and viewer-triggered LLM calls are zero | PASS | §3 #16/#17. |
| 5 | Desktop and mobile browser E2E pass | PASS | §3 #22 — 124 tests across both projects. |
| 6 | Asset licence and attribution records complete | PASS | §3 #24. |
| 7 | Affected PRD 1.0 P0 capability shows no regression | PASS | §3 #1; the whole suite runs in `npm run check`. |
| 8 | Typecheck, lint, tests, build and CI pass | PASS | §3 #26. |
| 9 | The matrix and closure record are updated and no longer claim completion from backend completion alone | PASS | This document; `docs/prd-2.0-requirement-matrix.md` §0 corrected in the same change (§5). |
| 10 | Public acceptance environment seeded, scheduler producing accepted events, twelve characters verified against real Canon | **EXTERNAL_BLOCKED** | The twelve-character half IS satisfied against real Canon (§4). The world is `development`. The "no registered function can change a world's mode" half of this blocker is CLOSED by ART-172; what remains is an owner deploying current `main` and running the command. §6.3. |
| 11 | The ART-136 benchmark confirmed executed AND passed before release | PASS | Executed 2026-09-13 on an Apple M2 GPU with no threshold, workload or scoring change: 21/21 measured criteria pass, 0 failing verdicts. The benchmark now refuses to measure at all unless the renderer is hardware, so this verdict cannot silently revert to a software figure. §6.1. |
| 12 | Visual Replay references only published identifiers and versions, invalidating on withhold or supersede | PASS | §3 #31. |
| 13 | Every §18.1 metric not yet measurable is reported as not measured rather than estimated | PASS | §7. |

AC#14 of the Definition of Done ("pull request is merged or explicitly blocked") is satisfied by the
PR carrying this document. AC#10 and AC#11 stay unchecked, and the task stays out of `Done`, because
checking them would be the exact thing §22.28 forbids.

A third item is blocked for the same class of reason and is recorded here so it is not lost:
production-acceptance corroboration for §22.29 (§6.2). It is not one of the thirteen, but it is what
an owner will want to run at the same time as AC#10.

---

## 4. Live deployment readings

Taken 2026-09-09 with bounded, index-scoped read-only queries against the existing deployment
(`colorless-deer-917`). No deploy, no mode change, no write.

| Reading | Value |
| --- | --- |
| Worlds | one — `mistwood`, `mode: development`, `status: running`, `nextWorldDay: 5`, `publishEnabled: true` |
| Accepted Canon events | 83, world days 0–4, last sequence 82 |
| Distinct participants | **all twelve** seeded residents |
| Distinct event locations | **all eight** Mistwood locations |
| Canon snapshots | `initial` (seq −1) + `daily` at world day 4 (seq 77) |
| Post-commit runs | 75, all `completed` |
| Scheduled slots / world-day runs | 25 each — 23 `completed`, 2 `failed` (`UNKNOWN_LOCATION_REFERENCE` at `validate_canon`, day 4 noon and afternoon) |
| Current published read models | `character` 12, `arc` 6, `episode` 4, `relationship` 4, `world` 2, `liveState` 1, `timeline` 1 |
| Current publication records | 3, **all `ready`** — none released |
| Daily episodes | 4, all `ready` |
| Withhold classifications | 0 |
| Operator audit rows | 0 |
| Scene simulation runs | 74, **all authored by `fake-whole-scene-v1` (`provider: "fake"`)**, 2026-08-04 → 2026-09-06 |

Two of these matter more than the rest.

**The deployment is behind `main`.** `npx convex function-spec` lists 62 modules and does not
include `operations/productAnalyticsFunctions` or `operations/worldQualityFunctions`; two indexes
the current tree declares (`worldDegradationStates.by_world_id`,
`canonValidationOutcomes.by_world_and_day`) do not exist there. Its last scene run was
2026-09-06. Any statement about "the running system" in this document is therefore a statement
about a build that predates ART-159/ART-160, ART-47 and ART-58.

**Every accepted event in it was authored by the deterministic fake.** That is consistent with the
build it is running — ART-159 is what made the live world-day path author through the real
adapter — and it is the reason §22.29's *deployment* corroboration is listed as owner action in
§6.2 rather than claimed here. The repository evidence for §22.29 is independent of it and stands.

---

## 5. Historical claims that are no longer true

Recorded because ART-138's own notes and `docs/prd-2.0-requirement-matrix.md` still carry them, and
a reader who trusts either would draw the wrong conclusion.

| Claim | Status now |
| --- | --- |
| "ART-99 is an open release blocker" | **False.** ART-99 is Done, with the fixed-seed regression test named in §3 #2 and a live seeded-world daily snapshot to match. |
| "ART-141 is an open release blocker; the real provider cannot produce an accepted event" | **False.** ART-141 is Done. The chain was verified live during that task; ART-157 and ART-159/ART-160 then closed the prompt and the wiring. |
| "Convex deployments are disabled: free plan limits exceeded" | **False.** Function execution works: bounded queries return data today (§4). |
| "Do not switch the world to public — post-commit read cost grows with Canon size (ART-100 AC#1)" | **No longer the reason it was.** ART-100 is Done and `convex/operations/postCommitLiveFunctions.readMeasurement.test.ts` proves it by name: `AC#1 — a post-commit run's canon reads do not grow with total accepted-event count`, and `reads the same number of day-scoped canon rows however many world days the world has had`. That test still passes with ART-169's new stage in the pipeline. The remaining reason not to flip the mode is that the deployment is running old code (§4), not that the read cost is unbounded. |
| "The requirement matrix's current baseline has open regressions ART-99 and ART-141" | **Stale.** Corrected in `docs/prd-2.0-requirement-matrix.md` in the same change as this record. |

Two things this record deliberately does **not** claim:

- That the running deployment demonstrates the real-provider path. It does not; see §4.
- That §22.27's "objective evidence" includes production acceptance for every requirement. The
  matrix has always distinguished *implementation* completeness from *production acceptance*
  (`docs/prd-2.0-requirement-matrix.md` §4.1). Every V2 P0 requirement has a task and repository
  evidence; the production-acceptance half of FR-O002 needs the deploy in §6.2.

---

## 6. What is blocked, and on whom

### 6.1 §22.30 — the mid-tier mobile frame rate — RESOLVED 2026-09-13

**Verdict: PASS.** How it was resolved is the part worth keeping, because for two releases this
section argued the opposite conclusion from a premise that was false.

#### What this section used to say

> The recorded figure is real and is reported as a failure rather than exempted: 29.26 fps against
> a 30 fps threshold … But the host that produced it **has no usable GPU** — Chromium reports
> `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …))` even with the GPU blocklist ignored …
> **Nothing in this repository can settle it.** There is no GPU-capable runner in CI …
> **EXTERNAL_BLOCKED: requires a real mid-tier mobile device, or a GPU-capable representative
> runner.**

Everything it said about the *measurement* was accurate. The sentence about the *host* was not, and
it was the one the verdict rested on. The host is an Apple M2 with a ten-core GPU and Metal 3.
Chromium reaches it. What could not reach it was the benchmark:

| Launch | `UNMASKED_RENDERER_WEBGL` |
| --- | --- |
| Playwright default headless — **what the benchmark used** | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …), SwiftShader driver)` |
| `channel: 'chromium'` (new headless) | `ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)` |
| headed | `ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)` |

Playwright's default headless Chromium is `chrome-headless-shell`, a build with **no GPU support at
all**. `--ignore-gpu-blocklist` — which the config set, and which this section cited as evidence the
host had been asked properly — grants permission to use hardware the binary cannot bind. The flag
said hardware, the renderer said SwiftShader, and nothing compared the two.

**That is a repository defect, not an environment limitation**, and the difference is the whole
verdict: the criterion sat as `EXTERNAL_BLOCKED` awaiting a device that was already under the desk.

#### The run that settles it

| | |
| --- | --- |
| Command | `npm run bench` — no `BENCH_SOFTWARE_GL`; no threshold, workload, sampling or scoring change |
| Renderer | **`ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)`**, class `hardware` |
| Browser | chromium 151.0.7922.34 / Playwright 1.62.1 |
| Result | **21/21 measured criteria pass; 0 failing verdicts** |
| mid-tier-mobile AC#4 | **60 fps** in `stream`, `delayed`, `snapshot`, `degraded`, against 30 |
| desktop-reference AC#4 | 60 fps in all four modes, against 45 |
| Load probe (ART-173) | 60 fps at twenty and at forty sprites, on both profiles |

#### Why 60.00 everywhere is a real figure, not a broken measurement

Every sample reading exactly 60 is the shape of a vsync ceiling — and equally the shape of a sampler
that has stopped sampling. It was checked rather than assumed. Raising the mid-tier-mobile profile's
CPU throttle from 4× to 24× and re-running moved the figures at once: average 46.37 fps, P5 29.94,
worst 10, and 187 frames in the window instead of 240. The forty-sprite probe's P5 (20.04) came in
below the twelve-character page's (29.94), so the probe's extra load registers too. The throttle
applies on this launch path and the sampler is live; at 4× on an M2 the work simply fits inside a
frame with room to spare.

**The limitation that comes with the pass, stated rather than left to be noticed:** with every
profile pinned at the ceiling, this host has no headroom signal. The benchmark will catch a severe
regression here and will not catch a gradual one. That is a property of running a mobile profile on
desktop hardware.

#### What stops this from recurring

The benchmark no longer trusts its own launch options. `dynamicView.bench.ts` reads the renderer off
a real page, classifies it, and **refuses to measure anything** when the result is not hardware — the
describe block is serial, so such a run produces no frame rate at all rather than one nobody should
cite. `BENCH_SOFTWARE_GL=1` remains a supported, documented mode; a run made that way records
`softwareRendererRequested: true`, and the report stamps every figure in it as unusable for AC#4 and
AC#11.

`bench/measure.test.ts` covers the classifier against the real strings this host produces, and
`bench/record.test.ts` asserts the record never presents a software run as evidence about a device.
An earlier assertion in that file required the mobile rows to FAIL — true of every run the harness
could then produce, and wrong as a rule, since it would have failed the very run that fixed it.

#### What is still not settled here

**AC#2** (`publicDynamicQueryP95Ms < 500ms`) and **AC#3** (runtime-to-screen latency < 5s) still
require a real deployment: the E2E build replaces the transport with an in-process fixture, so
measuring them here records ~0 ms for a path that was never exercised.

ART-136 **AC#6** (twelve, twenty and forty visible characters) is closed by ART-173's load probe.
What remains `unreachable` is the other half of **AC#9**: a fixed map ZOOM at those counts. Zoom
belongs to the live page's camera, and the live page cannot be driven above twelve without inventing
twenty-eight visual bindings or putting a benchmark seam in the shipped renderer. That remainder is
recorded in the results file rather than folded into the pass.

**AC#7 (an eight-hour run shows no sustained memory growth) — PASSED on 2026-09-13.** This section
recorded it as unsettled for two releases, and the history matters because it is the reason the
result below is trustworthy: the 2026-08-24 record showed `AC#7 … ✅` and this document read that as
part of「Desktop passes everything」, but the run behind it lasted **two minutes**, `npm run bench`'s
default, against a criterion that names eight hours. The slope over those two minutes was 0 B/min
and genuinely clean; what it could not be is an answer about eight hours, because slow leaks are the
entire reason the criterion is long.

ART-178 made the harness say that itself rather than leaving it to a reader: `soakVerdict` carries
`settlesCriterion`, the record renders `⚠️` with the shortfall instead of `✅`, and a results file
recorded before that change has no such field and is treated as unsettled. **The run below is the
first one that clears it**, and it clears it on the field ART-178 added rather than on prose.

| | |
| --- | --- |
| Command | `BENCH_SOAK_MINUTES=480 npm run bench` (the documented acceptance command, unmodified) |
| Commit | `e63a304b84379e6e6cefa0fb873064db307f2f11` — `HEAD` was this at start and at finish |
| Started / finished | `2026-09-13T08:08:10Z` → `2026-09-13T16:09:33Z` (8h 01m wall clock) |
| Host | Mac14,3 / Apple M2 / 8 cores / 8 GiB / macOS 14.8.9 arm64 |
| Browser | chromium 151.0.7922.34, Playwright 1.62.1 |
| Renderer | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …), SwiftShader driver)` — see below |
| `durationMs` | 28800000, against `requiredDurationMs` 28800000 |
| `settlesCriterion` | **true** |
| `sampleCount` | 2878 (one every 10 s) |
| `heapGrowthBytesPerMinute` | **6169.06**, against a threshold of 524288 — 1.2 % of it |
| Report row | `\| AC#7 \| desktop-reference \| soak (480m, 2878 samples) \| heapGrowthBytesPerMinute \| 6169.06 \| 524288 \| ✅ \|` |
| Artifacts | `docs/benchmarks/dynamic-view-soak-480m-2026-09-13.json` — an immutable copy of this run, because `dynamic-view-latest.json` is overwritten by the NEXT `npm run bench` and a two-minute run would silently return that file's AC#7 row to `⚠️`. `dynamic-view-latest.{json,md}` have since been replaced by the 2026-09-13 hardware-GPU run (§6.1) and carry a 2-minute soak, which is exactly the overwrite the archived copy exists for |

**The run's process exit code was 1, and that is not AC#7's.** `bench:report` exits non-zero when any
measured criterion fails, and four did — the mid-tier-mobile frame rates covered by §6.1, which is a
separate verdict on the same run. The soak test itself passed: `✓ 15 … AC#7 — a 480-minute soak shows
no sustained heap growth (8.0h)`, and Playwright reported `15 passed`. Reading the exit code as an
AC#7 failure, or the soak's pass as a §22.30 pass, would each be the same substitution error in
opposite directions.

**Why a SwiftShader renderer does not weaken this one.** AC#7 measures `performance.memory.usedJSHeapSize`
— the JavaScript heap — not GPU memory, and the measurement is a trend across the minima of six time
windows rather than last-minus-first. Software rasterisation raises CPU-side cost, so if it biases the
figure at all it biases it upward; 6.2 KB/min against a 512 KB/min threshold is not a number a renderer
swap rescues. This is the one criterion in this section whose evidence is unaffected by §6.1's
harness defect.


### 6.2 §22.29 / FR-O002 production acceptance — a deployment of current `main`

The repository evidence for §22.29 stands on its own (§3 #29). What cannot be produced from here is
corroboration from the running system, because that system is running a build from before the real
adapter was wired into the scheduled path (§4).

**EXTERNAL_BLOCKED: the owner must deploy current `main` and let one slot run.** Deploying is a
production deploy, which `CLAUDE.md` §5 forbids this agent from performing.

Minimum owner operation:

```bash
npx convex deploy                      # current main, from a checkout with the deployment credential
npx convex run simulation/providers/liveWorldDayActions:runLiveWorldDaySlotWithProvider '{"worldId":"mistwood"}'
```

Acceptance command:

```bash
npx convex run --inline-query 'export default query({ args: {}, handler: async (ctx) => {
  const sims = await ctx.db.query("sceneSimulationRuns")
    .withIndex("by_world_and_run", (q) => q.eq("worldId","mistwood")).order("desc").take(5);
  return sims.map((s) => ({ provider: s.result?.trace?.provider, model: s.result?.trace?.model, status: s.status }));
} });'
```

**PASS means:** the newest run reports a `provider` that is **not** `fake` and a `model` that is
**not** `fake-whole-scene-v1`, with `status: "validated"`, and the world's accepted-event count has
increased. Anything still reporting `fake` means the deploy did not take or the slot did not run.

### 6.3 §22.10 — the public acceptance environment

ART-138's AC#10 asks for a public acceptance environment with the Mistwood world seeded and its
scheduler producing accepted events, so the twelve-character requirement is checked against real
Canon rather than fixtures.

**The twelve-character half is already satisfied against real Canon** — §4 shows all twelve
residents and all eight locations in 83 accepted events on the live deployment. What is not
satisfied is the world being `public`.

`mistwood` is `mode: development`. The old reason for not switching it (ART-100's unbounded
post-commit read cost) no longer holds (§5). The current reason is narrower and is stated rather
than dressed up: switching a world to `public` starts the 60-second cron against **the build that
deployment is running**, which predates ART-159/ART-160, ART-47 and ART-58. Doing that would be a
production mode change on stale code, which is an owner decision and outside what this agent may
do.

**EXTERNAL_BLOCKED: the owner must deploy current `main` (§6.2) and then enable the acceptance
environment.**

A second finding here changed what the owner has to do, and **has since been closed.** When this
record was first written, **no registered function could change an existing world's mode**:
`configureSchedule` is the only writer of `worldSchedules.mode` and refuses once a schedule exists
(`SCHEDULE_ALREADY_EXISTS`), while `pauseWorld` / `resumeWorld` move `status`. The mode change was
therefore a direct row patch in the Convex dashboard — unaudited, unreasoned, and invisible to
`operatorAuditLog`.

**ART-172 built the audited control.** `changeWorldMode`
(`convex/operations/worldModeControlFunctions.ts`) is an admin-only, reasoned, audited command that
refuses to promote a paused or emergency-stopped world and treats a repeat as an audited no-op. So
the step below is a command rather than a hand patch, and the promotion appears in the trail beside
every other privileged world action.

Minimum operation, in this order:

```bash
npx convex deploy                                  # current main
npx convex run --inline-query '…'                  # confirm the real provider authored a slot (§6.2)
# then the mode change, audited (ART-172):
npx convex run operations/worldModeControlFunctions:changeWorldMode \
  '{"worldId":"mistwood","targetMode":"public","reason":"<why>",
    "operatorId":"<id>","operatorToken":"<token>"}'
```

Acceptance command:

```bash
npx convex run --inline-query 'export default query({ args: {}, handler: async (ctx) => {
  const s = await ctx.db.query("worldSchedules").withIndex("by_world_id", (q) => q.eq("worldId","mistwood")).unique();
  const events = await ctx.db.query("canonEvents")
    .withIndex("by_world_and_sequence", (q) => q.eq("worldId","mistwood")).collect();
  const characters = new Set(events.flatMap((e) => e.participantIds ?? []));
  return { mode: s?.mode, status: s?.status, acceptedEvents: events.length, distinctCharacters: characters.size };
} });'
```

**PASS means:** `mode: "public"`, `status: "running"`, `distinctCharacters` is 12, and
`acceptedEvents` increases between two readings taken a slot apart.

---

## 7. §18.1 metrics that are not measured

Reported as **not measured**, never estimated, per §22.13.

| Metric | Status | Why |
| --- | --- | --- |
| Character-card click-through rate | not measured | Requires a collector receiving §15 events from a public world. ART-47 delivers the client and the ingest; no public world has produced traffic. |
| Replay completion rate | not measured | Same. |
| `publicDynamicQueryP95Ms` | not measured | `requires_deployment` — see §6.1. |
| Runtime-to-screen latency (end to end) | not measured | `requires_deployment`. The server half is published as `runtimeProjectionLatency` (ART-133) and is `server_measured`; the end-to-end figure is not. |
| Mid-tier mobile average FPS | measured, inconclusive | See §6.1. The number exists and fails; it cannot settle the criterion either way. |
| Visible characters at 20 and 40 | **measured** (desktop); inconclusive (mobile) | Was `not measured` on the argument that Mistwood has twelve bound residents. ART-173 closed it: a synthetic load probe on its own Vite input drives the real renderer at both counts without touching the roster. Desktop passes AC#4's threshold at 20 and 40; the mobile probe fails on the same software rasteriser as the row above and is recorded `measured_but_inconclusive` for the same reason. See §6.1. |

---

## 8. What would make this record say COMPLETE

Both, in order:

1. §6.2 — a deploy of current `main` and one real-provider slot, so §22.29 has deployment
   corroboration as well as repository evidence.
2. §6.3 — the acceptance environment enabled, so §22.10 is satisfied by a `public` world rather
   than by a `development` one.
**§6.1 is done** — the benchmark ran on hardware graphics on 2026-09-13 and mid-tier mobile reached
60 fps in all four modes, so §22.30 is no longer a FAIL. It is struck from this list rather than
deleted from the document, because the reason it took two releases (a harness that could not reach
the host's GPU, not a missing device) is the kind of thing this record exists to remember.

Both remaining items are satisfied by **one** owner action — deploy current `main`, run a slot,
promote the world — so the list is shorter than it looks.

Until they are done this document must not be cited as PRD 2.0 MVP closure. That is the whole point
of it.
