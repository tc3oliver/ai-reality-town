---
id: ART-136
title: Validate dynamic layer performance and device quality tiers
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 16:00'
updated_date: '2026-08-24 17:40'
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
- [x] #1 Live view shell P95 time to interactive is under four seconds on desktop and six seconds on mobile
- [ ] #2 Public dynamic query P95 is under five hundred milliseconds
- [ ] #3 Runtime to public screen update latency is normally under five seconds
- [ ] #4 Desktop averages at least forty five frames per second and mid-tier mobile at least thirty
- [x] #5 Reduced frame rate never changes a character semantic position
- [ ] #6 Performance is measured at twelve, twenty and forty visible characters
- [ ] #7 An eight hour run shows no sustained memory growth
- [x] #8 The benchmark fixes a named mid-tier device or equivalent throttling profile and a named browser version
- [x] #9 The benchmark covers twelve, twenty and forty visible characters at a fixed map zoom level
- [x] #10 The benchmark covers normal stream, delayed stream, snapshot and degraded modes
- [x] #11 The benchmark is repeatable and its recorded results are committed as evidence
- [ ] #12 The benchmark is executed and passed before public release; production field data may supplement but never substitute for it
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## 先確認一件會決定範圍的事實:這個世界只有十二位可繪製居民

AC#6／#9 要求在 12／20／40 位可見角色下量測。`MISTWOOD_CHARACTER_VISUALS` 恰有十二位,
`mistwoodCharacterSpriteKeys` 由它產生,而 `mistwoodCharacters.test.ts` 把該名冊釘死在
`buildMistwoodCharacterVisualBindings()` 上;`composeReadOnlyWorldViewModel` 又依 FR-N004 AC#6
**丟棄**任何無視覺綁定的角色(不得以猜測的 sprite 代繪)。因此「40 位可見角色」在本世界中
**結構上不可表示**,而不是還沒做。任何做出 40 位的辦法都得先破壞 FR-N004 或破壞那個 pin。
故本任務的處理是:把 harness **參數化**於角色數,在 12(本世界的真實上限)實測並記錄,
把 20／40 明列為「待一個居民更多的世界」而非默默略過,並在文件與矩陣列中寫明理由。

## 同理,兩條 AC 是**部署**性質而非客戶端性質

- AC#2(public dynamic query P95 < 500ms)與 AC#3(runtime→screen < 5s)量的是**傳輸與伺服器**。
  E2E build 的 transport 是同步 fixture,對它量會得到約 0ms 與一個毫無意義的「通過」。
- AC#3 的伺服器側其實**已經有儀器**:ART-133 的 `runtimeProjectionLatency`(`server_measured`)。
  故 harness 記錄客戶端能誠實回答的那一半,另一半具名指向 ART-138 的發布關卡執行,
  並在結果檔中以 `requires_deployment` 標記而非留白或假裝通過。

## AC#7 的八小時同理

harness 以 `--soak-minutes` 參數化。本任務跑一段短 soak 作為「harness 確實能量到記憶體成長」
的證據並提交結果;八小時那一次是 ART-138 的執行步驟,不是本任務能在一個 session 內偽造的數字。

## 可以誠實交付且有實質價值的部分

1. `bench/` 下的 Playwright benchmark,跑**出貨的** E2E build(與 ART-137 同一份 build,
   只有 transport 是 fixture),量測:
   - TTI(AC#1):Navigation Timing + 首次可互動控制項出現。
   - FPS(AC#4):頁內 rAF 取樣,取平均與 P5。
   - 記憶體(AC#7):`performance.memory` 定期取樣,線性迴歸斜率判定是否有持續成長。
2. AC#8:具名裝置檔與瀏覽器版本。以 CDP `Emulation.setCPUThrottlingRate` 固定節流倍率,
   裝置檔取 Playwright 的 `Pixel 5`,瀏覽器版本自 `browser.version()` 讀出並**寫進結果檔**——
   一份沒有記錄執行環境的基準數字不能重跑,也就不是基準。
3. AC#9:固定 zoom(以既有鏡頭控制回到 town view,不做任何縮放)。
4. AC#10:四種模式全覆蓋。**這是 ART-127 剛剛才讓它成為可能的**:normal stream 與
   degraded(拒絕 WebGL → 靜態圖)已可達;delayed 以 fixture 的 freshness 產生;
   snapshot 以 fixture 撤掉投影產生。前者不需 production 鉤子(覆寫 `getContext`),
   後兩者只動 `src/e2e/` 內、已被 `fixtureIsolation.test.ts` 釘住不會進 production 的 fixture。
5. AC#5:既有 `motionQualityTiers.test.ts` 已在單元層證明降幀不改變語意狀態;
   本任務補上**瀏覽器層**的同一主張——在 6× CPU 節流下讀每位角色的 `semanticLocationId`,
   與未節流時逐位相同。單元測試證明的是純函式,這證明的是真實引擎下的整條路徑。
6. AC#11:結果寫成 `docs/benchmarks/dynamic-view-<date>.json`(機器可讀)＋
   `docs/dynamic-view-benchmarks.md`(規格與判讀),兩者都提交。

## 實作步驟

1. `bench/profile.ts`:具名裝置檔與門檻常數,與 PRD NFR2-002 的數字一對一。
2. `bench/dynamicView.bench.ts`:Playwright spec,四個模式 × 取樣,輸出 JSON。
3. `bench/report.ts`:把 JSON 轉成 markdown 表,並對每條門檻標記 pass／fail／requires_deployment。
4. `package.json`:`bench` script。
5. 文件與矩陣列 FR-Q005。
6. **不**加任何 production 測試鉤子。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification (2026-08-25)

`npm run check` green (155 suites, 2391 passed, 5 pre-existing skips, build OK).
`npm run test:e2e` green (66 tests, desktop + Pixel 5) — no regression from the fixture change.
`npm run bench` runs end to end; recorded results are committed at
`docs/benchmarks/dynamic-view-latest.{json,md}`.

## AC#4 (mobile) is NOT satisfied, and is not being written up as if it were

Measured average ~28 fps on `mid-tier-mobile` against a 30 fps threshold. Reported as a FAIL:
`npm run bench` exits non-zero, and the verdict table shows it red.

The context does not exempt it. This host has no usable GPU — Chromium reports an
ANGLE/SwiftShader device even with the GPU blocklist ignored — so the mobile profile
software-rasterises a 1080x2340 backing store (roughly twice the desktop profile's pixels)
while also under 4x CPU throttling. That is harsher than the named device, so the figure
cannot settle the criterion in either direction for real mobile hardware. Both halves are in
the results file: the number as a failure, and `measured_but_inconclusive` with the reason.

Worth noting for whoever picks this up: the `degraded` rung reaches 60 fps on the same
profile, which locates the cost in the Pixi stage rather than anywhere else on the page.

An authoritative mobile figure needs a device, which is the release gate (ART-138).

## Two defects the harness found in itself

1. **The heap regression was fitted to raw samples.** Every JS heap sawtooths, and a
   least-squares line over a sawtooth does not return zero unless the cycles happen to align
   with the sample window. A healthy page cycling 40 to 70 MiB reported nearly 3 MiB/min of
   growth — enough to fail AC#7 with no leak at all. Raising the threshold until it stopped
   would have been fitting the gate to the noise. Now measured on the post-collection FLOOR
   across six windows, pinned in both directions by `measure.test.ts`.
2. **The visible-character count read zero on every animated rung.** It counted
   `[data-character]`, which only exists on the static map; the characters are on a canvas
   everywhere else. So the FPS figures sat next to a `0` that made them look like they had been
   measured against an empty map. Now counted from the per-character focus controls, the same
   standard ART-137's AC#2 uses.

Also fixed two selector bugs found by running it: the card controls read
「查看 X 的角色卡」/「關閉 <name> 的角色卡」, so a substring match on 「X 的角色卡」 matches
both once a card is open.

## What was checked, and what was deliberately left unchecked

Checked: AC#1, AC#5, AC#8, AC#9, AC#10, AC#11.

Left unchecked, with the reason recorded in the results file rather than omitted:
- **AC#2, AC#3** — `requires_deployment`. The E2E build replaces the transport, so measuring
  them here records ~0ms and prints a pass for a path that was never exercised.
- **AC#4** — measured and failing on mobile (above).
- **AC#6** — 12 measured; 20 and 40 are `unreachable`. Mistwood has twelve bound residents and
  FR-N004 AC#6 makes the view model drop unbound ones, so those counts are not representable
  in this world. The harness is parameterised by count, so the criterion becomes measurable the
  day a world has more residents; fabricating bindings to make a number appear would be
  measuring a world that does not exist (ART-107 section 8).
- **AC#7** — the harness detects growth and the short soak passes, but eight hours is an
  operator step (`BENCH_SOAK_MINUTES=480`), not something this task can produce in one session.
- **AC#12** — by definition the release gate's execution.

Therefore DoD#1 is NOT checked and the task is NOT Done. The harness — which is what the task
names as the deliverable — is complete, repeatable and committed.

## Status after PR #194 (2026-08-25)

PR #194 opened with auto-merge. The harness ships; the TASK stays In Progress because AC#4
(mobile frame rate) is measured and failing, and DoD#1 requires every acceptance criterion.

What would close it, in order of directness:
1. Run `npm run bench` on a host with a real GPU, or on a physical mid-tier device. If the
   figure clears 30 fps, AC#4 is settled and the remaining gaps are ART-138's deployment
   measurements.
2. If it does not clear it on real hardware, the Pixi stage needs work — the `degraded` rung
   hits 60 fps on the same profile, so the cost is in the renderer and not elsewhere on the
   page.

This is not a Human Blocker under H01-H07: it needs hardware or renderer work, not a human
decision.
<!-- SECTION:NOTES:END -->
