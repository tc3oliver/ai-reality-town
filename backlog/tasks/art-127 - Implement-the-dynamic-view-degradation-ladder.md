---
id: ART-127
title: Implement the dynamic view degradation ladder
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:59'
updated_date: '2026-08-24 16:50'
labels:
  - prd-2.0
  - v2-j
  - epic-o
dependencies:
  - ART-116
  - ART-118
priority: high
type: feature
ordinal: 127000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O010 (PRD 2.0 §12 Epic O)

**Problem / Context:** WebGL failure, stream loss or renderer error must never leave the viewer with a blank page or, worse, trigger retries into the generation pipeline.

**Goal:** A four-level degradation ladder that always leaves the world comprehensible and never escalates cost.

**Scope:**
- Ladder: normal runtime stream, then last valid runtime snapshot, then static map with last known positions, then informational location/character/scene view.
- Clear last-updated time and status labelling at every level.
- Automatic recovery to a higher level when conditions allow.
- Renderer failure must never retry an LLM call.

**Out of Scope:** Model outage degradation for the generation pipeline (ART-91, kept separate per PRD 2.0 §13).

**Dependencies:** FR-N007 runtime snapshot; FR-O001 live map.

**Schema Impact:** None.

**API Impact:** Exposes degradation level to the client.

**Security Impact:** None.

**Test Requirements:** Tests for each ladder level, automatic recovery, and an assertion that renderer failure produces no LLM retry.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Degradation ladder documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Degradation follows stream, then last valid snapshot, then static map with last known positions, then informational view
- [x] #2 Degradation does not affect Episode, arc or historical content
- [x] #3 Last updated time and current status are clearly labelled at every level
- [x] #4 Renderer failure never triggers an LLM retry
- [x] #5 The view automatically returns to a higher level once conditions recover
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## 核心發現:四級中有兩級已存在、一級已建好卻沒接上、一級不存在

- **第 1 級(串流)**:`getPublicDynamicProjection` + 動畫地圖,ART-118／119 已交付。
- **第 2 級(最後有效快照)**:ART-116 的 `getPublicRuntimeSnapshot` **已經**發布 `characterStates`／`activeSceneStates` 與伺服器裁定的 `freshness`——但**實況地圖從來沒讀過它**。目前唯一的讀者是首頁,而且只取 `freshness` 畫徽章。這一級是**已建好但沒接線**。
- **第 3 級(靜態地圖 + 最後已知位置)**:不存在。
- **第 4 級(資訊式檢視)**:`LiveMapFallback` 已存在,但它是**懸崖而非階梯**——`webglSupported` 一為 false 就整頁跳到文字實況指路頁,中間兩級全部略過。

故本任務不是「加一個降級開關」,而是**把懸崖改成階梯**:把第 2 級接上、把第 3 級造出來、讓四級由同一個純函式裁定、並在每一級都標示狀態與最後更新時間。

## 決定一:階梯是**純函式**,且**由推導而來而非閂鎖**(AC#5 的關鍵)

新增 `src/components/live/degradationLadder.ts`,`resolveDegradationLevel(input)` 由可觀察條件裁定 `'stream' | 'snapshot' | 'static-map' | 'informational'`。

**自動復原(AC#5)不需要任何復原機制**——這正是選純推導的理由。第 1↔2 級是資料可得性的純函式,Convex 訂閱一推新資料,函式重算即回到高階,**沒有 polling、沒有計時器、沒有重試**。若改以 `useState('degraded')` 閂鎖,AC#5 就得另造一套「何時該試著回去」的機制,而那套機制本身就是 AC#4 想禁止的重試來源。

唯一必須閂鎖的是**算繪器擲出**(否則會 crash loop),但它閂的是**算繪器**而非**資料**:第 3 級以下仍隨資料自動升降,而算繪器閂鎖在 `viewModel` 的 `mapId` 改變時清除(換世界才值得再試一次 Pixi),不以時間重試。

## 決定二:第 3 級是 **DOM/SVG 靜態地圖**,不是「凍住的 Pixi」

WebGL 沒了就畫不了 Pixi,所以「靜態地圖」若指凍結的 canvas 則在最需要它的情境下**根本不可達**。改以 `mistwoodLocationFootprints` 的 tile 矩形算繪一張 SVG 平面圖,角色依 `semanticLocationId` 落位。三個好處:完全不需要 WebGL、是真實 DOM 故螢幕閱讀器讀得到、且明確優於純文字清單——它保留了 AC#1 要的「最後已知位置」的**空間**資訊。

## 決定三:等級**推導於客戶端**,伺服器貢獻的是 `freshness`

強迫降級的條件多數是**客戶端**條件(無 WebGL、算繪器擲出、query 錯誤),伺服器看不到,故伺服器單方面宣告的等級會是一個關於它看不見的客戶端的宣稱。任務的 API Impact(向客戶端暴露降級等級)由既有的 `freshness` 裁定滿足:那是伺服器**能夠**誠實回答的那一半,階梯把它與客戶端能力合成。**不新增任何 Convex 函式**,故 `publicReadOnlyGuarantee.test.ts` 的窮舉清單不變(`getPublicRuntimeSnapshot` 自 ART-131 起已在客戶端可達清單上)。

## 決定四:AC#4 以**結構**而非紀律證明

「算繪失敗不得重試 LLM」目前為真,但沒有任何東西**釘住**它。將以三層斷言封閉:(a) 階梯的輸入型別不含任何可發動請求的東西,它是純函式;(b) 降級**不得改變所發出的 query 集合**——測試在算繪器失敗前後比對訂閱清單必須逐位相同(天真實作會用 `key={level}` 重掛載而引發重訂閱風暴);(c) 沿用既有 `liveMapSurface.test.ts` 的模組閉包掃描,斷言階梯與靜態地圖的相依閉包內沒有 mutation／action。

## 決定五:AC#2 由**輸入面**證明

「降級不影響 Episode／arc／歷史內容」的機器可判定形式是:階梯的輸入不含那些模型,且階梯只被實況路由消費。加一條結構斷言 + 一條在四個等級下算繪 Episode／arc 頁並要求輸出逐位相同的測試。

## 實作步驟

1. `src/components/live/degradationLadder.ts`(新,純):`DEGRADATION_LEVELS`、`resolveDegradationLevel`、`degradationDescriptor`(沿用 ART-131／121 的三個非顏色訊號慣例:label + glyph + data-state)、`lastUpdatedLabel`(AC#3 每一級都要有最後更新時間)。
2. `src/components/live/StaticMapView.tsx`(新):SVG 平面圖 + 最後已知位置。
3. `src/components/live/DegradationNotice.tsx`(新):每一級的狀態列,重用 `PublicStatusChips`。
4. `LiveMapPage.tsx`:加入 `getPublicRuntimeSnapshot` 讀取(既有公開 query),計算等級,依等級選擇資料來源與算繪路徑。
5. `LiveMapErrorBoundary.tsx`:改為回報失敗給上層(`onRenderFailure`)而非自行整頁替換,使其成為第 3 級而非第 4 級;`mapId` 改變時重置。
6. 測試:`degradationLadder.test.ts`(四級 + 邊界 + 復原)、`degradationLadder.dom.test.tsx`(四級實際算繪、query 集合不變、Episode／arc 不受影響)、a11y 套件補四級。
7. `e2e/dynamicView.spec.ts`:以 `page.addInitScript` 覆寫 `getContext('webgl')` 回傳 null 進行真實瀏覽器故障注入,證明落到靜態地圖而非空白頁,且無網路寫入。**不加任何 production 測試鉤子**。
8. 文件:`docs/dynamic-view-degradation.md`;需求矩陣 FR-O010 列。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification (2026-08-25)

`npm run check` green: architecture + asset licences + typecheck + lint + 3 Jest projects
(153 suites, 2365 passed, 5 pre-existing skips) + `vite build` OK.
`npm run e2e` green: 66 tests across desktop (1440x900) and Pixel 5, including the 5 new
degradation tests.

### Fault injection (proving the new tests are not vacuous)

1. Disabled the `static-map` branch in `resolveDegradationLevel`, so WebGL absence goes
   straight to the informational rung -> 9 failures across the pure, DOM and a11y suites.
2. Removed the latch from `RendererErrorBoundary.render`, so the boundary re-renders whatever
   just threw -> 2 failures (report-once, and latch-clears-only-on-map-identity).
3. Made the notice render only on degraded rungs -> 5 failures, including AC#3's
   "the top rung is labelled too".

All three restored from a backup outside the tree and re-verified green (309 tests in
`src/components/live/`).

### Three defects this task found

- **Rung 2 was built and never wired.** ART-116 has published `characterStates` /
  `activeSceneStates` since it was written; the live map never read it. Its only reader was
  the homepage's freshness chip, which reads no positions.
- **The static plan drew the REPLAY's motions**, so it showed the one character in the current
  replay scene instead of all twelve. Caught by the browser suite. A visual replay on a plan
  that cannot animate would be a picture jumping between hours-old positions while calling
  itself "last known positions"; the replay is now withdrawn on the two rungs that draw no
  animation.
- **Two fixture values were sentinels standing in for real data.** `updatedAt: 1_000` was
  never wrong until the ladder read it as a time, at which point the map announced
  "20689 days ago"; and `fixtureRuntimeSnapshot().characterStates` was `[]`, which is not a
  plausible last-valid snapshot. Both were invisible while nothing read them. Fixed and pinned
  in `fixtureWorld.test.ts`.

### One repo-level fix, outside the feature

`.eslintrc.cjs` had no `root: true`, so ESLint ascended past the project and — in a checkout
nested inside another repository — loaded two copies of `@typescript-eslint` and failed with
an error about the checkout's location rather than about the code. One line, and it makes the
lint gate hermetic.

### Not covered, and why

- **Rung 2 has no browser evidence.** Making the projection vanish in a real browser needs a
  fixture switch; the rung is fully covered by the pure and DOM suites, and what a browser
  uniquely adds here is the real WebGL denial, which rung 3 already exercises.
- **A GPU that loses its context mid-session**, as against one that never had it. The boundary
  handles a throw from any cause and the suite injects the "never had it" case; simulating a
  mid-session loss needs a WebGL extension the headless profile does not expose.
- **The last-updated label does not tick on rung 4.** `useMotionClock` parks when there is
  nothing to animate and the ladder deliberately adds no second timer (`liveMapSurface.test.ts`
  asserts this module mounts none). Rungs 1-3 all have motions, so it runs there.
- **Rung 2 has no world clock.** The runtime snapshot carries positions and scenes but not
  `worldDay` / `timeSlot`, so the day/night wash and clock chips are absent there. Adding them
  to the snapshot contract is a schema change this task did not need.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Turned the dynamic view's degradation cliff into a staircase (FR-O010).

Two of the four rungs shipped long ago, one was BUILT AND NEVER WIRED, and one did not exist.
ART-116 has published `characterStates` / `activeSceneStates` and a server-adjudicated
`freshness` since it was written, and the live map — the one surface whose whole job is showing
world state — never read it; its only reader was the homepage's freshness chip. The static-map
rung did not exist at all. And `LiveMapFallback` was a cliff: one false `webglSupported` dropped
the viewer straight to a signpost page and skipped both middle rungs.

`resolveDegradationLevel` is a pure function of conditions read on every render, and that is what
makes AC#5 cost nothing: when the projection returns, the next render is already `stream`. There
is no recovery mechanism, no polling and no retry, because there is nothing to recover from. A
`useState('degraded')` latch would have needed a second mechanism to decide when to climb back —
and that mechanism is exactly the retry loop AC#4 forbids. The one thing that must latch is a
renderer that threw, and it latches the RENDERER, not the level: the rungs below keep moving with
the data, and the latch clears on map identity, never on a clock.

The error boundary therefore moved inside. `LiveMapErrorBoundary` wrapped the whole route, so a
renderer throw unmounted the page and its public reads — which makes the middle rungs
structurally unreachable, since rung 3 needs the DATA to survive the renderer. A new
`RendererErrorBoundary` wraps the Pixi stage alone.

Rung 3 is SVG, not a frozen canvas: the rung exists for the case where Pixi cannot run, so a
frozen canvas is unreachable in the only situation needing it. It is projected from the same view
model the renderer consumes and the same focus targets the camera controls use, so the two
surfaces cannot disagree about who is where — the classic failure of a second rendering path, and
the worst kind, because it only shows in the state nobody looks at.

Three defects found on the way: rung 2's dead wiring; the static plan drawing the REPLAY's
motions (so it showed one character instead of twelve — caught in a real browser); and two E2E
fixture sentinels that were never wrong until something read them as data, one of which made the
map announce "20689 days ago".

Verified: `npm run check` green (153 suites, 2365 passed, 5 pre-existing skips, build OK) and
`npm run e2e` green (66 tests, desktop + Pixel 5). The browser fault is injected by overriding
`getContext` before any app code runs — there is no `?degrade=` flag in the shipped bundle,
because a query-string switch would have tested the switch. Three fault injections (9, 2 and 5
failures) confirm the new assertions are not vacuous. Docs: `docs/dynamic-view-degradation.md`;
FR-O010 matrix row updated. Also fixed `.eslintrc.cjs` missing `root: true`, which made the lint
gate depend on where the checkout sits.
<!-- SECTION:FINAL_SUMMARY:END -->
