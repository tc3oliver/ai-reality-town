---
id: ART-149
title: Retry re-spends tokens on scenes that already succeeded
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-29 05:41'
updated_date: '2026-09-06 08:41'
labels:
  - prd-1.0
  - epic-o
dependencies: []
priority: high
type: bug
ordinal: 149000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a world-day run is retried after a partial failure, scenes that already completed successfully are re-simulated, so their tokens are spent a second time. With a real provider this is a direct, silent cost multiplier on exactly the runs that are already going badly, and it interacts with ART-59: the re-spend consumes budget that the first attempt already consumed. Surfaced during ART-59 delivery. The fix should make a retry resume from the last successful scene rather than replay the whole slot.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A retry after a partial failure does not re-invoke the provider for scenes that already produced accepted output
- [x] #2 Token accounting for a retried run reflects work actually performed, not work replayed
- [x] #3 A test drives a partial failure followed by a retry and asserts the provider call count for the already-succeeded scenes is zero
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
## 根因

`simulate_scenes` 是**整個 slot 共用一個** orchestration checkpoint(`worldDayOrchestration.ts:136-144`),不是每個場景一個。因此任一場景失敗就丟棄整個 checkpoint,重試時**所有**場景重跑 —— 包含已經成功並已持久化的那些。

`persistValidatedSceneSimulation` 早已依 `simulationRunId` 去重,而 `simulationRunId` 為 `${scene.sceneId}:simulation`,跨 attempt 穩定。但去重發生在 **provider 呼叫之後**:token 已經花掉,新產生的結果隨即被丟棄換回舊的。帳面(`decisionIdPrefix`)不會重複計數,實際額度卻真的被扣了兩次。

## 改動

在呼叫 provider **之前**先查已持久化的結果,有就直接重用:

- 新增 internalQuery `findReusableSceneSimulation`(`worldId` + `simulationRunId` + `groupingRunId`)
- `WorldDayLivePort` 新增 `loadPersistedSceneSimulation`
- `simulate_scenes` 改為 `const result = reused ?? await simulateWholeScene(...)`;重用時跳過 `persistSceneSimulation`(該列本來就是它的來源)

`groupingRunId` 必須相符才重用。不相符時**不重用** —— `persistValidatedSceneSimulation` 對此拋 `SCENE_SIMULATION_RUN_CONFLICT`,在這裡默默重用等於把該衝突埋掉。

重用的結果仍照原路徑套用 `withArrivalStateChanges` / `withSceneProvenance` 與 `reviewStatus === 'required'` 的安全分流 —— 這些是純函式推導,對重用與新產生的結果一視同仁。

## 驗證

斷言必須落在 **provider 被要求撰寫哪些場景**,而不是寫了幾列:token 是被呼叫花掉的,而計算持久化次數的測試在缺陷存在的整段期間都會是綠的。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 已交付

在 provider 呼叫前先查已持久化結果並重用,讓重試不再為已成功的場景付費。

- `findReusableSceneSimulation`(internalQuery,`sceneSimulationFunctions.ts`)
- `WorldDayLivePort.loadPersistedSceneSimulation`,並綁定四個既有 port 實作(長跑 harness 與三個測試替身皆回傳 `null`,因為它們從不重試 —— 這個選擇是明寫的,不是預設值)
- `simulate_scenes`:`const result = reused ?? await simulateWholeScene(...)`,重用時不重複寫入

`groupingRunId` 不符時**不重用**,讓 `SCENE_SIMULATION_RUN_CONFLICT` 照常浮出。

## 證據

`npm run check` 全綠:**208 suites / 3382 passed**(+2)。

**故障注入**(把 `reused ??` 拿掉)。mistwood morning slot 共 3 個場景,在第 3 個注入失敗:

```
Expected value: not "grouping:mistwood:0:morning:scene:1"
Received array:     ["grouping:mistwood:0:morning:scene:1",
                     "grouping:mistwood:0:morning:scene:2",
                     "grouping:mistwood:0:morning:scene:3"]
```

重試重新撰寫了**全部 3 個**場景而非 1 個 —— 即該次重試的 **3 倍 token 開銷**,這正是本任務描述的成本乘數。修正後 `retry.authored` 長度為 1。

配對的反向測試(首次執行仍撰寫每一個場景)在注入期間維持綠色,所以它確實隔離的是重用邏輯,而不是順帶跟著壞掉。

### 為何既有測試抓不到

斷言必須落在 **provider 被要求撰寫哪些場景**。持久化早就是冪等的,因此任何計算寫入列數的測試在缺陷存在的整段期間都會是綠的 —— token 是被呼叫花掉的,不是被寫入花掉的。

## AC 對照

- **#1** 已達成:重試對已產出結果的場景零次 provider 呼叫(上述注入證明)
- **#2** 已達成:重用路徑完全不進入 `simulateWholeScene`,因此不建立預約也不結算,帳目只反映實際執行的工作
- **#3** 已達成:`ART-149 retry does not re-author scenes that already succeeded`,驅動部分失敗後重試,並斷言已成功場景的呼叫數為零
<!-- SECTION:NOTES:END -->
