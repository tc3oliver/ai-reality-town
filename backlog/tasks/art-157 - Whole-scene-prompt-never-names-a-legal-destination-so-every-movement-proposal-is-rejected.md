---
id: ART-157
title: >-
  Whole-scene prompt never names a legal destination, so every movement proposal
  is rejected
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-06 06:47'
updated_date: '2026-09-06 08:21'
labels:
  - bug
  - prd-1.0
dependencies: []
priority: critical
ordinal: 157000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verified live on the dev deployment 2026-09-06. runQueuedWorldDaySlot on mistwood day 4 noon returned status: failed, failureStage: validate_canon, errorCode: UNKNOWN_LOCATION_REFERENCE ('destination location does not exist'), committedEventIds: [].

Root cause, read off the code rather than inferred:

- The scene payload sent to the model is JSON.stringify(scene) where scene: GroupedScene (sceneSimulation.ts:391). GroupedScene (sceneGrouping.ts:16-30) carries the scene's OWN locationId and nothing else about the map — no other location ids, no connections, no occupancy, no capacity.
- wholeSceneSystemPrompt (sceneSimulation.ts:242-259) asks for character_location_changed and shows an example whose destination is the literal placeholder 'destination-location-id' (:250).
- So the model is asked for a destination, shown a placeholder, and given no legal value to choose. Canon then correctly refuses it at validators.ts:537.

The provider is not at fault and neither is the validator: probeConfiguredOpenAICompatibleProvider reports chat and embedding both compatible. LLM providers may only propose, and the append-only guarantee held — zero canon was written. The defect is that the proposal can never be valid.

Why the existing suites are all green: the fake provider knows the world, so it proposes real location ids. Nothing exercises 'a provider that only knows what the prompt told it'.

Note for whoever picks this up: validators.ts rejects a movement on four separate grounds — unknown (:530), non-existent (:537), INACTIVE (:540) and capacity exceeded (:593). Supplying bare location ids fixes only the first two; the set the prompt offers has to be filtered to active locations with capacity headroom, or the world will simply fail later on the other two.

Cost evidence captured in the same run (feeds ART-100): that single FAILED slot, committing nothing, read 1369 documents / 3105906 bytes — about 3.0 MiB of the 16 MiB transaction budget at only 78 accepted events.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A scene prompt carries the legal destination set (existing, active, with capacity headroom) for the scene's location, derived from the world projection rather than from the model's imagination
- [ ] #2 Running one real world-day slot against the configured provider commits at least one accepted event instead of failing at validate_canon with UNKNOWN_LOCATION_REFERENCE
- [ ] #3 A regression test drives the whole-scene path with a provider that only knows what the prompt told it, and asserts the slot no longer fails, so the defect cannot return silently
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## 關鍵發現:資料已經存在,只是沒送到

`LiveCharacter.reachableLocationIds`(`worldDayLive.ts:133`)在 stage 1 `load_world_state` 就已算出,來源是 `projection.locations[currentLocationId]?.connectedLocationIds`(`:344`)。`simulate_scenes`(`:855-858`)也已經把 `snapshot` 解構在手上。

**缺的不是計算,是傳遞。** `GroupedScene`(`sceneGrouping.ts:16-30`)不帶任何地圖資訊,而送給模型的 user message 就是 `JSON.stringify(scene)`(`sceneSimulation.ts:391`)。

`worldDayLive.ts:634` 的既有註解已經承認過這個落差:「The author never sees the world projection, so it cannot state the movement precondition」—— 當時的處置是 `withArrivalStateChanges` 由 orchestrator 補上**抵達**,但**離開**沒有對應處置。

## 為何不能只餵地點 id(四道關卡)

`validators.ts` 對 movement 有四道:unknown(`:530`)、不存在(`:537`)、**inactive**(`:540`)、**容量超出**(`:593`)。只給連通 id 只過得了前兩道。

而 `LiveCharacter` 只有 `reachableLocationIds`,**沒有** active 與 capacity。所以 snapshot 必須加寬。

## Slice 1 — 加寬 snapshot

`LiveWorldSnapshot` 新增 `locations`:每筆 `{ locationId, active, capacity, occupancy, connectedLocationIds }`,由 port 已經在重播的 `projection`(`locations` + `locationOccupancy`)導出。不新增讀取 —— 那份 projection 已經在記憶體裡。

注意:這是**擴大模型可見範圍**。`LiveWorldSnapshot` 的 docblock 明寫「Contains only data the Director/characters may legitimately see」。地點的存在、連通、是否開放、是否客滿,都是角色站在原地就看得見的資訊,不是 Canon secret。必須在 docblock 裡寫明這個判斷,而不是默默加欄位。

## Slice 2 — 算出合法目的地並送進 prompt

在 `simulate_scenes` 內,對 `scene.locationId` 算出:連通 ∩ active ∩ (occupancy < capacity)。

傳遞方式:`simulateWholeScene` 新增 option 承載該集合,`buildSystemPrompt` 由 `(scene)` 改為 `(scene, context)`。**不改 `GroupedScene`** —— 它是持久化的 grouping artifact,把易變的世界狀態塞進去會讓 artifact 不再是它宣稱的東西。

`promptVersions.ts` 解析 builder 的路徑要一併更新(見該檔對「為何在此解析而非 `simulateWholeScene` 內」的說明)。

## Slice 3 — prompt 本身

`wholeSceneSystemPrompt`(`:242-259`)兩處要改:

1. 明確列出合法目的地 id,並說明「`toLocationId` 只能取自此清單」。
2. 範例裡的 `toLocationId: 'destination-location-id'`(`:250`)換成清單中的真實 id。留著佔位字串就是在示範一個必然被拒的值。

集合為空時(無連通、或全部客滿)必須明說「本場景無合法移動」,而不是給空清單讓模型自由發揮。

## Slice 4 — 回歸測試(AC#3)

現存 3364 條全綠卻抓不到本缺陷,因為 fake provider **認識這個世界**,提議的是真 id。

新增測試必須用一個**只知道 prompt 告訴它什麼**的 provider:從 system prompt 裡抽出它被給的目的地(或在沒被給時回傳佔位字串),再斷言 slot 不再失敗於 `UNKNOWN_LOCATION_REFERENCE`。故障注入:把清單從 prompt 拿掉 → 該測試必須轉紅。

同時補 inactive 與客滿兩種 fixture,證明過濾真的有效,而不是只過了前兩道關卡。

## 驗證

`npm run check`,加上對真部署再跑**一個** time slot,確認 `committedEventIds` 非空。注意每次 slot 約 3.0 MiB 讀取(見 ART-100),不要反覆重跑。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 第一刀:prompt 修好了,但**還不夠** —— AC#2 仍未達成

已交付且已驗證的部分:

- `LiveWorldSnapshot` 新增 `locations: LiveLocationView[]`(active / capacity / occupancy / connections)
- 新增純函式 `legalDestinationsFrom()`,四道關卡全過:不存在、懸空連線、inactive、容量已滿(以 `occupancy < capacity` 比較,即「還容得下一個」)
- `wholeSceneSystemPrompt` 改為 `(scene, context)`,明確列出合法目的地;**範例裡的佔位字串 `'destination-location-id'` 已換成真實 id**;無合法目的地時明說「不得產生任何 character_location_changed」而非給空清單
- `GroupedScene` **未**變動(它是持久化 artifact,不該混入易變世界狀態)

測試:`npm run check` 全綠,**208 suites / 3376 passed**。故障注入三次,每次都紅在該紅的地方:

- 拿掉 active+capacity 過濾 → inactive 與容量兩條轉紅
- 容量改成 `<=`(差一錯誤)→ 容量那條轉紅
- 還原 prompt 佔位字串 → 三條轉紅

AC#3 的「只知道 prompt 告訴它什麼」的 provider 已實作,並附**配對的反向案例**:prompt 不給清單時它必須退回佔位字串。若該條哪天變綠,代表上面那條已經不再證明任何事。

## 但真部署仍然失敗 —— 且我找到了更深的原因

重跑 `runQueuedWorldDaySlot`(day 4 afternoon):**仍然** `UNKNOWN_LOCATION_REFERENCE` / `destination location does not exist`,`committedEventIds: []`。**AC#2 未達成,本任務不得標記完成。**

追下去發現的關鍵:

1. `worldDayLiveFunctions.ts:138` 的 snapshot 投影是 `replayWorldEvents(emptyProjection(worldId), acceptedEvents)` —— **從空重播**。`canonRuleContext`(`worldDayLive.ts:735`)同樣如此。
2. 因此 `projection.locations` **只含事件建立過的地點**,不含 `importWorld` 匯入的 seed 地點(seed 存在 `worldLocations` 表與 `initial` 快照,而這兩處重播都跳過它們)。這也是為何 port 必須另外傳一份 `locationConnections`(`worldDayLiveFunctions.ts:145`)—— 投影裡沒有。
3. `validators.ts:536` 有一道保護:`projection.locations` 為空時**跳過**存在性檢查。既然錯誤發生了,代表它**非空** —— 世界處於最糟的中間狀態:一部分地點在投影裡,seed 地點不在。

**最可能的真兇是 orchestrator 自己產生的抵達,不是作者。** `withArrivalStateChanges`(`worldDayLive.ts:634`)會把參與者移動到 `scene.locationId`。Director 依 **seed** 地點規劃場景,而 `scene.locationId` 若只存在於 seed、不在從空重播的投影裡,那道抵達的目的地就「不存在」。prompt 修得再好也擋不住 —— 那個 change 根本不是模型寫的。

這與 ART-100 Slice 2 記錄的 `SEED_BASELINE_FIELDS` 是**同一個**根本問題:`locations` 是 seed 基準線欄位,而多處重播從空開始。

## 下一步(尚未做,且需要判斷)

驗證與 snapshot 所用的投影應以 **seeded baseline** 為起點(`resolveWorldBaseline` / `initial` 快照),而非 `emptyProjection`。

這不是單點修改:它同時影響 `canonRuleContext` 與 `loadWorldSnapshot`,而且必須與 ART-100 對「publicRead 從空重播」的既有假設一起考量 —— **兩邊對同一份投影有相反的需求**(publicRead 刻意要避免 seed 汙染,模擬端則必須看到 seed),不能各改各的。

在此之前不要宣稱本任務完成。每次重試 slot 約 3.0 MiB 讀取,不要反覆盲試。
<!-- SECTION:NOTES:END -->
