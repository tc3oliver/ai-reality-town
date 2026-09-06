---
id: ART-157
title: >-
  Whole-scene prompt never names a legal destination, so every movement proposal
  is rejected
status: Done
assignee:
  - '@claude'
created_date: '2026-09-06 06:47'
updated_date: '2026-09-06 08:50'
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
- [x] #1 A scene prompt carries the legal destination set (existing, active, with capacity headroom) for the scene's location, derived from the world projection rather than from the model's imagination
- [x] #2 Running one real world-day slot against the configured provider commits at least one accepted event instead of failing at validate_canon with UNKNOWN_LOCATION_REFERENCE
- [x] #3 A regression test drives the whole-scene path with a provider that only knows what the prompt told it, and asserts the slot no longer fails, so the defect cannot return silently
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
## 第二刀:讓驗證看見 seed 基準線(根因修正)

### 根因(已定位到單行)

`commitProposedEvent`(`convex/canon/commit.ts:86`)以 `replayWorldEvents(emptyProjection(worldId), events)` 建立驗證用投影 —— **從空重播**。但 seed 地點只存在於 `importWorld` 寫入的 `initial` 快照(`worldConfig.ts:305-321`),不存在於任何事件。

於是 `validators.ts:535-537`:

```ts
const destination = projection.locations?.[change.toLocationId];
if (Object.keys(projection.locations ?? {}).length > 0 && !destination) → UNKNOWN_LOCATION_REFERENCE
```

只要世界曾發生 **一次** `location_state_changed`(reducer 唯一寫入 `projection.locations` 之處,`reducer.ts:167-175`),該 map 即非空,而**所有 seed 地點都不在其中** → 每一次前往 seed 地點的移動都被誤判為「目的地不存在」。這正是 day 4 afternoon 的失敗。

### 為何 `resolveWorldBaseline` 是正確答案而非新機制

`initialSnapshot.lastSequenceNumber` 來自 `emptyProjection` 的 `-1`(`snapshots.ts:129` + `model.ts` `lastSequenceNumber: -1`),所以

```
replayWorldEvents(seededBaseline, 全部事件)
```

**不會跳過任何事件**,且正是 `assertSnapshotMatchesHistory`(`snapshotManager.ts:86`)與 `createDailySnapshot` 已在使用的組合。此修正是讓 commit 期驗證與**既有的快照定義一致**,不是引入新語意。

### 改動

1. `CanonCommitStore` 增加 `loadInitialSnapshot(worldId)`。設為**必要**而非選用:全庫僅一個 in-memory 實作(`inMemoryStore.ts`),選用會讓真實 adapter 漏接 seed 而靜默退回今日的錯誤行為。
2. `commitProposedEvent`:以 `resolveWorldBaseline` 取得基準線,`replayWorldEvents(cloneProjection(baseline.projection), 基準線之後的事件)`。
3. Convex adapter 增加 `loadInitialSnapshot`(`canonSnapshots` / `by_world_day_and_kind`,worldDay 0,kind `initial`)。
4. `canonRuleContext`(`worldDayLive.ts:804`)與 `loadWorldSnapshot`(`worldDayLiveFunctions.ts:138`)同步改用基準線 —— 否則 `snapshot.locations` 仍不含 seed 地點,第一刀的 `legalDestinationsFrom` 會永遠回傳 `[]`,prompt 等於永久禁止移動。

### 刻意不改 `validators.ts`

`:536` 與 `:614` 缺少 `:610` / `:813` 那道 `!knownLocations &&` 前綴。加上去可以讓錯誤消失,但那是**放寬檢查**:它會在 ruleContext 存在時整段跳過存在性驗證。改基準線則讓 `:536` 依其原意運作。同時修復兩個因 `destination` 恆為 `undefined` 而**靜默失效**的檢查:`:539` 的 inactive 與 `:591` 的 capacity —— 後者代表 seed 地點目前**完全沒有容量上限**。

### 驗證

- 新測試:seeded 世界 + 已存在一個 `location_state_changed` 事件,提交往 seed 地點的移動 → 必須被接受。
- 故障注入:把基準線改回 `emptyProjection`,該測試必須轉紅。
- 對真部署重跑一個 slot,要求 `committedEventIds` 非空。
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

---

## 第二刀:根因已修,AC#2 達成

上一節「下一步」提出的方向是對的,但把根因指錯了地方:真正建立驗證用投影的不是 `loadWorldSnapshot`,而是 **`commitProposedEvent`(`convex/canon/commit.ts:86`)**。它以 `emptyProjection` 為起點,而 seed 地點只存在於 `importWorld` 寫入的 `initial` 快照,沒有任何事件會建立它們。

觸發條件也比原先描述的精確:`validators.ts:536` 只在 `projection.locations` **非空**時才檢查目的地存在。世界發生第一個 `location_state_changed`(reducer 唯一寫入該 map 之處)之前,這個缺陷完全隱形;之後,**每一次**前往 seed 地點的移動都被判為「目的地不存在」。

### 改動

`resolveWorldBaseline` 已經存在且正是為此而生 —— 這不是新機制,而是讓 commit 期驗證與**既有的快照定義一致**。`initialSnapshot.lastSequenceNumber` 為 `-1`,所以在 seed 基準線上重播全部事件**不會跳過任何事件**,與 `assertSnapshotMatchesHistory` / `createDailySnapshot` 用的是同一個組合。

- `CanonCommitStore` 新增 `loadInitialSnapshot`(設為**必要**:全庫僅一個 in-memory 實作,選用會讓真實 adapter 靜默退回今日的錯誤行為)
- `commitProposedEvent`、`canonRuleContext`、`loadWorldSnapshot` 三處一併改用基準線 —— 只改其一會讓預檢與 commit 期驗證對同一份提案給出不同答案

### 刻意沒有改 `validators.ts`

`:536` 與 `:614` 缺少 `:610` / `:813` 那道 `!knownLocations &&` 前綴。加上去也能讓錯誤消失,但那是**放寬檢查**。改基準線則讓 `:536` 依其原意運作,並同時修復兩個因 `destination` 恆為 `undefined` 而**靜默失效**的檢查:`:539` 的 inactive 與 `:591` 的 capacity —— 後者代表 seed 地點在此之前**完全沒有容量上限**。

### 證據

`npm run check` 全綠:**208 suites / 3380 passed**(較上一節 +4)。

故障注入(把基準線改回 `emptyProjection`):新增的三條轉紅、「未 seed 世界」對照組維持綠,且第一條的失敗訊息與生產環境**逐字相同**:

```
CanonError: [UNKNOWN_LOCATION_REFERENCE] destination location does not exist
```

真部署連續兩個 slot(`npx convex dev --once` 後):

| slot | status | committedEventIds |
| --- | --- | --- |
| `mistwood:day:4:slot:evening` | completed | `#78`, `#79`, `#80` |
| `mistwood:day:4:slot:night` | completed | `#81`, `#82` |

先前為 `failed` / `[]`。新事件中含 **2 個實際被接受的移動**:

- `su-meizhen`:`mistwood-clinic` → `mistwood-mill`
- `lin-yingxue`:`mistwood-paper` → `mistwood-hall`

兩者皆為 seed 地點。這同時證明第一刀的 `legalDestinationsFrom` 確實產出了非空清單 —— 否則 prompt 會禁止一切移動,世界雖能推進但永遠不會有人走動。

**AC#1 / AC#2 / AC#3 皆已達成。**

### 對 ART-100 的影響

`SEED_BASELINE_FIELDS` 的「兩邊相反需求」在此獲得澄清:`publicRead` 從空重播是**刻意**的(避免 seed 汙染公開讀模型),模擬與 commit 端必須看見 seed。兩者本就該不同,不必統一 —— 先前的顧慮是誤判。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Canon validation replayed from emptyProjection, but seeded locations exist only in the initial snapshot importWorld writes, so every movement to a seeded location was rejected as nonexistent once any location event made projection.locations non-empty. Fixed by replaying from resolveWorldBaseline in commitProposedEvent, canonRuleContext and loadWorldSnapshot. Verified: check green at 208 suites / 3380 passed; E2E 82 passed; injecting the old baseline reddens the three new tests and reproduces the production message verbatim; two consecutive dev slots now complete (day 4 evening and night, events #78-82) where both previously failed with an empty commit list, including two accepted movements between seeded locations. Merged in PR #228.
<!-- SECTION:FINAL_SUMMARY:END -->
