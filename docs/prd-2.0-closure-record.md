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
| PASS | 30 |
| FAIL | 1 |
| EXTERNAL_BLOCKED | 0 |
| **Total** | **31** |

**ART-138's own thirteen acceptance criteria (FR-Q008)**

| Verdict | Count |
| --- | ---: |
| PASS | 11 |
| FAIL | 0 |
| EXTERNAL_BLOCKED | 2 |
| **Total** | **13** |

**MVP closure: NOT COMPLETE.** Exactly one §22 criterion fails — §22.30, the mid-tier mobile frame
rate — and it fails on a host with no GPU, so the figure cannot settle it either way. Two of this
gate's own criteria need an owner action that `CLAUDE.md` §5 forbids an agent from taking. §6 gives
each one its operation, its acceptance command and its pass threshold.

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
| 30 | The dynamic-layer benchmark is established **and actually passed** | **FAIL** | `docs/benchmarks/dynamic-view-latest.md`, recorded 2026-08-24. Desktop passes every criterion the run settles — see §6.1 on AC#7, which it does not. **Mid-tier mobile averages 28.4 fps (stream) and 28.38 fps (delayed) against NFR2-002's 30 fps.** The harness exists, is repeatable (`npm run bench`) and is honest about what it could not measure. §6.1 states why the figure cannot settle the criterion either way and what would. |
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
| 10 | Public acceptance environment seeded, scheduler producing accepted events, twelve characters verified against real Canon | **EXTERNAL_BLOCKED** | The twelve-character half IS satisfied against real Canon (§4). The world is `development`, and no registered function can change an existing world's mode. §6.3. |
| 11 | The ART-136 benchmark confirmed executed AND passed before release | **EXTERNAL_BLOCKED** | Executed and recorded; mid-tier mobile FAILS at 28.4 fps on a host with no GPU. §6.1. |
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

### 6.1 §22.30 — the mid-tier mobile frame rate

**Verdict:** FAIL, and the failure is **not** conclusive about real hardware.

The recorded figure is real and is reported as a failure rather than exempted: 28.4 fps against a
30 fps threshold, in `stream` and `delayed` modes, at 12 visible characters. But the host that
produced it has no usable GPU — Chromium reports
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …))` even with the GPU blocklist ignored — so the
mobile profile software-rasterises a 1080×2340 backing store (about twice the desktop profile's
pixel count) while also under 4× CPU throttling. A software rasteriser missing 30 fps says nothing
about a phone with hardware graphics.

Nothing in this repository can settle it. There is no newer benchmark record than
2026-08-24, no GPU-capable runner in CI (the E2E job installs Chromium on a standard hosted
runner), and substituting the desktop figure, the `degraded`-mode figure (60 fps) or the
`snapshot`-mode figure (37.35 fps) for the normal-mode mobile requirement would be reporting a
different measurement under the same name.

**EXTERNAL_BLOCKED: requires a real mid-tier mobile device, or a GPU-capable representative
runner.**

Minimum owner operation:

```bash
# On a host with hardware graphics — do NOT set BENCH_SOFTWARE_GL.
npm run bench
```

Acceptance command and threshold:

```bash
node -e "const r=require('./docs/benchmarks/dynamic-view-latest.json'); \
  const bad=r.verdicts.filter(v=>v.criterion==='AC#4'&&v.profileId==='mid-tier-mobile'&&!v.pass); \
  console.log('renderer:', r.renderer); \
  console.log(bad.length?'FAIL':'PASS', JSON.stringify(bad));"
```

**PASS means:** `mid-tier-mobile` averages **≥ 30 fps in `stream` and `delayed` modes** at 12
visible characters, on a run whose recorded `Renderer` line is **not** SwiftShader. Desktop must
stay ≥ 45 fps. The `degraded` and `snapshot` modes do not substitute for the normal-mode
requirement, and neither does the desktop profile.

Two ART-136 criteria are blocked by the same class of thing and are listed here so they are not
lost: **AC#2** (`publicDynamicQueryP95Ms < 500ms`) and **AC#3** (runtime-to-screen latency < 5s)
both require a real deployment, because the E2E build replaces the transport with an in-process
fixture and measuring them there would record ~0 ms for a path that was never exercised.

ART-136 **AC#6** (measure at 12, 20 and 40 visible characters) is *not* external — the benchmark
records it as `unreachable` because Mistwood has twelve bound residents — and is tracked as
repository work rather than accepted as a limitation.

**AC#7 (an eight-hour run shows no sustained memory growth) is not settled either, and an earlier
version of this section did not say so.** It listed AC#2, AC#3 and AC#6 and stopped. The
2026-08-24 record showed `AC#7 … ✅` and this document read that as part of「Desktop passes
everything」— but the run behind it lasted **two minutes**, `npm run bench`'s default, against a
criterion that names eight hours. The heap slope measured over those two minutes is 0 B/min and is
genuinely clean; what it cannot be is an answer about eight hours, because slow leaks are the
entire reason the criterion is long.

ART-178 made the harness say this itself rather than leaving it to a reader: `soakVerdict` now
carries `settlesCriterion`, the record renders `⚠️` with the shortfall instead of `✅`, the run is
listed in that file's「Not measured here, and why」table as `run_too_short`, and the summary line
counts 15/17 rather than 16/18. A results file recorded before that change has no such field and
is treated as unsettled, not as settled.

This one is **not external** in the way the mobile frame rate is — it needs no device this project
lacks, only eight hours of wall clock on the host that already runs the benchmark:

```bash
BENCH_SOAK_MINUTES=480 npm run bench
```

**PASS means:** the `AC#7` row reads `✅` rather than `⚠️` — i.e. `settlesCriterion` is true AND
`heapGrowthBytesPerMinute` is at or below 524288 — with `soak (480m, …)` in the same row. It is
listed here rather than in §3 because until that run happens, §22.30's benchmark has one criterion
recorded as unmeasured, and calling it passed would be the same substitution §6.1 refuses for the
frame rate.

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

There is a second, smaller finding here worth stating plainly, because it changes what the owner has
to do. **No registered function can change an existing world's mode.** `configureSchedule`
(`convex/simulation/schedulerOperations.ts`) is the only writer of `worldSchedules.mode`, and it
refuses outright when a schedule already exists (`SCHEDULE_ALREADY_EXISTS`). The operator console has
`pauseWorld` / `resumeWorld`, which move `status`, not `mode`. So the mode change is a direct row
patch through the Convex dashboard today. Giving it an audited operator control is new feature work,
which ART-138's own scope excludes ("This task only verifies and records"), so it is raised as its
own task rather than done here.

Minimum operation, in this order:

```bash
npx convex deploy                                  # current main
npx convex run --inline-query '…'                  # confirm the real provider authored a slot (§6.2)
# then, deliberately, the mode change — by hand, because nothing exposes it:
#   Convex dashboard → Data → worldSchedules → the `mistwood` row → set mode = "public"
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
| Visible characters at 20 and 40 | not measured | The world has twelve bound residents; the benchmark records this as `unreachable` rather than passing it silently. Tracked as repository work on ART-136 AC#6. |

---

## 8. What would make this record say COMPLETE

All three, in order:

1. §6.2 — a deploy of current `main` and one real-provider slot, so §22.29 has deployment
   corroboration as well as repository evidence.
2. §6.3 — the acceptance environment enabled, so §22.10 is satisfied by a `public` world rather
   than by a `development` one.
3. §6.1 — one benchmark run on hardware graphics showing mid-tier mobile at ≥ 30 fps in `stream`
   and `delayed`, so §22.30 stops being a FAIL.

Until then this document must not be cited as PRD 2.0 MVP closure. That is the whole point of it.
