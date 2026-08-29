---
id: ART-100
title: Incremental public read-model projection updates
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 06:21'
updated_date: '2026-08-29 06:44'
labels:
  - prd-1.0
  - epic-i
dependencies: []
priority: critical
ordinal: 100000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every publicRead rebuild* function re-derives its payload by replaying the whole accepted-event log (canonEvents collect + replayWorldEvents), and the post-commit pipeline (ART-98) now invokes those rebuilds automatically after every accepted event. Measured on the dev deployment at ~65 accepted events, one post-commit run already costs several MB of document reads, and runLiveWorldDayCycle has to cap itself at one accepted event per transaction to stay under the Convex 16 MiB per-transaction read limit. As canon grows this becomes a hard ceiling on the live daily cycle. Fix by making the projection builders incremental (fold the new accepted event into the current published payload, or read from a canon snapshot plus the tail) instead of full replays.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post-commit run's document reads do not grow linearly with total accepted-event count
- [ ] #2 runLiveWorldDayCycle can process a whole time slot (3+ events) in one transaction on a world with hundreds of accepted events
- [ ] #3 Projection payloads remain byte-identical to the full-replay output for the same canon prefix
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
## 關鍵發現(推翻既有註解)

1. `replayWorldEvents` 是**純左摺疊**(`convex/canon/replay.ts:21-31`),且純度由來源掃描測試釘住(`convex/canon/reducer.purity.test.ts:47-60`)。因此 `reduce(events) === step(reduce(prefix), e)` 成立 —— 增量化在數學上安全。
2. **Canon 快照機制已經存在**(ART-17)。`CanonSnapshot` 存整份 `WorldProjection`,含 `relationshipHistory`、`characterKnowledge`、`characterMemories`(`convex/canon/snapshots.ts:16-25`、`:52-100`)。`replayFromSnapshot(snapshot, laterEvents)` 已實作(`:159-167`)。每個 world-day 由 stage 20 寫入(`postCommitLiveFunctions.ts:453-457`)。
3. 有界尾端讀取的寫法**已在 repo 內證明可行**:`convex/recaps/functions.ts:45-46` 用 `by_world_and_sequence` + `gte`/`lte`。
4. **修正任務描述**:`DEFAULT_MAX_POST_COMMIT_EVENTS = 1` 是預設值而非硬上限;`MAX_POST_COMMIT_EVENTS = 10`,呼叫端可傳 1..10(`postCommitLiveFunctions.ts:106-114`、`:560-563`)。AC#2 今天就「表達得出來」,缺的是讓它安全的讀取預算。
5. 三處註解宣稱全日誌讀取「unavoidable」,全部可從程式碼反駁,須一併更正:`relationshipGraphProjectionFunctions.ts:24-28`(`relationshipHistory` 是快照欄位)、`voteConsequenceProjectionFunctions.ts:87-90`(BFS 只從 trigger 向前走)、以及 `docs/scoped-relationship-graph.md:39`、`docs/vote-consequence-tracking.md:153`。
6. **不要**從已發布 payload 摺疊:`sanitizeForPublic`(`readModel.ts:113-124`)會剝除符合 `PRIVATE_KEY_PATTERNS` 的鍵,存下來的 payload 相對於 builder 輸出是有損的。改用快照+尾端。

## Slice 0 — 讀取量量測(AC#1 的前提,今天完全不存在)

全 repo 沒有任何 document-read / transaction-byte 的量測程式,只有散落的散文註解。且 `convex/operations/postCommitLiveFunctions.ts` **零測試覆蓋**。

- 建立會計數的 ctx double:以 `editorial/shareFormatFunctions.test.ts:92-144`(fakeDb + 會解析 `runMutation` 的 ctx)為模型,擴充成 `runMutation` 直接派送到真正 projection 的 `._handler`(型別轉換寫法見 `voteConsequenceProjectionFunctions.test.ts:33`),共用同一組資料表。
- 在 `collect()`/`take()`/`first()`/`unique()` 的回傳點累加 `docsRead += rows.length`。
- 斷言:同一世界分別驅動到 N 與 2N 個 accepted event,各跑一次 post-commit,讀取量比值不得隨 N 成長。

## Slice 1 — WINDOW 修正(純粹綁錯索引,零語意變更)

1. `relationshipArcProjectionFunctions.ts:132` `rebuildArcProjection` —— `:156` 立刻只留 `arcSourceSequences`(來自 `storyArcEventClassifications` 的已知集合),改為 N 次 `worldId+sequenceNumber` 點查。
2. `onboardingSummaryFunctions.ts:58` —— 兩個消費端都是從尾端反向掃描並提前 break(`:90-92`、`:109-122`),改 `.order(desc)` + early break。
3. `voteConsequenceProjectionFunctions.ts:111` —— `selectTrigger` 只看 `worldDay === target`,BFS 只承認 `causedByEventIds` 命中已抵達節點,即嚴格向前走。窗口是 `sequenceNumber >= trigger.sequenceNumber` 的後綴。此處被 `refreshVoteConsequenceProjections`(`:237-267`)每天重跑一次,收益乘以天數。
4. `postCommitLiveFunctions.ts:568` `runLiveWorldDayCycle` —— `gte(minUnsettledSequence)` + `.take(n)`;同時處理 `:570-573` 的 `postCommitRuns` 全表 collect。
5. `postCommitLiveFunctions.ts:237` `loadWorldState` —— 拆成 `by_world_and_day`、點查、`.order(desc).first()`;唯一真正全域的是 `completedWorldDays`(`:200-205`),需要一份小型維護式摘要。
6. 同型:`story/portfolioFunctions.ts:27`、`story/projectionFunctions.ts:24`、`story/entryRecommendationFunctions.ts:54`。

## Slice 2 — SNAPSHOT_PLUS_TAIL

新增共用 helper:最新快照(`canon/queries.ts:89-98` 已有 `.order(desc).first()` 的便宜寫法)+ `gt(sequenceNumber, snapshot.lastSequenceNumber)` 尾端 + `replayFromSnapshot`。尾端上界是「一個 world-day」,不是全歷史。

套用於:`postCommitLiveFunctions.ts:225-226` `loadProjection`(供 `loadWorldState`/`loadCharacterKnowledge`/`loadCharacterMemories`)、`liveStateFunctions.ts:286`、`relationshipGraphProjectionFunctions.ts:103`。

順帶修 `snapshotOperations.ts:67-72` `loadLatestSnapshot`:目前 `.order(desc).collect()` 後在 JS 過濾,應為 `.first()`。

## Slice 3 — FOLD(最難,必須明講回退路徑)

`worldCharacterProjectionFunctions.ts:168`(world + character)、`relationshipArcProjectionFunctions.ts:48`、`episodeTimelineProjectionFunctions.ts:71`、`arcPrimerFunctions.ts:36`。

兩個**追溯性**風險不可略過,必須有全量重建的逃生口:
- withheld 場景集合會隨營運者操作改變:`worldCharacterProjectionFunctions.ts:151`/`:156` 會跳過被拒事件,`liveStateFunctions.ts:169`/`:209` 會遮蔽 —— 撤下或釋出都不能用 append 表達。
- `episodeNumberByDay`(`episodeTimelineProjectionFunctions.ts:84-87`)與 `storyArcEventClassifications` 會改寫**過去**的條目。

另注意 `worldCharacterProjectionFunctions.ts:161-163` 的 `attrs` 合併是順序敏感(`if (!(predicate in source))`),增量步驟必須逐字重現。

## Slice 4 — AC#2

`DEFAULT_MAX_POST_COMMIT_EVENTS` 由 1 提高到 3 以上,測試以「數百個 accepted event 的世界」在單一交易內處理完整 time slot。

## Slice 5 — AC#3 逐 builder 的等價性

每個 builder 一條 property test:同一段 canon prefix 下,增量輸出與全 replay 輸出必須位元相同。用既有的 `serializeProjectionDeterministically`(`snapshots.ts:36`)/ `stableStringify`(`readModel.ts:127-136`)。這條同時是 Slice 1-3 的安全網 —— 改一個驗一個。

## 文件

更正上述三處「unavoidable」註解與兩份 docs,並更新 `docs/post-commit-pipeline.md:99-107` 的已知限制段落。

## 驗證

`npm run check`、`npm run e2e`,以及逐 AC 故障注入(本 repo 慣例)。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Slice 2 進度(快照+尾端)

### 發現:快照的基準線不是空投影

`importWorld` 會寫入一個 `initial` 快照,內含 seed 世界狀態(`convex/canon/worldConfig.ts:305-321`,插入於 `:364`),`resolveWorldBaseline` 以它為重播基準線,`createDailySnapshot` 從它續接。因此:

- 已存快照 = `replayWorldEvents(SEEDED_BASELINE, events)`
- publicRead 今天 = `replayWorldEvents(emptyProjection, events)`

兩者**不等價**。天真地換成快照+尾端會讓已發布 payload 悄悄多出 seed 資料,直接違反 AC#3。

實測界定:seed 基準線只填 4 個欄位 —— `locations`、`locationOccupancy`、`organizations`、`organizationMembers`。其餘 15 個欄位在基準線中為空,因此**不讀這四個欄位的消費者,替換是精確而非近似**。

### 交付

新增 `convex/canon/snapshotReplay.ts`:`readLatestSnapshot`(單列索引讀)、`readProjectionViaSnapshot`(快照 + `gt(sequenceNumber)` 尾端 + `replayFromSnapshot`,無快照時回退全量重播),並匯出 `SEED_BASELINE_FIELDS` 把上述前提變成程式碼中的具名事實。

新增 `convex/canon/snapshotReplay.test.ts` 三條:
1. seed 基準線填的欄位集合**恰好**等於 `SEED_BASELINE_FIELDS` —— seed 日後多填一個欄位就轉紅,前提無法靜默腐爛。
2. 對 seed 世界,快照續接與從空重播在所有非 seed 欄位上相等。
3. 讀取量:200 事件、快照涵蓋前 199 → 只讀 1 列 canonEvents。

`rebuildRelationshipGraphProjection` 改用該 helper(它只讀 `relationshipHistory`,不在 seed 欄位內)。並更正該檔 `:24-28` 宣稱全日誌讀取「unavoidable」的註解 —— 前提對、結論不成立,快照本身就是那個 fold。

### 驗證證據

- `relationshipGraphProjectionFunctions.test.ts` 新增兩條:有無快照發布的 payload 必須相同(AC#3);讀取量 40 → 4(AC#1)。
- **原本 91 條測試全綠但完全沒碰到新路徑** —— fixture 沒有 `canonSnapshots` 表,走的是回退分支。已補齊 fixture 與 double 的 `gt()` 範圍綁定(先前只有 `eq`,加上快照會直接炸開而非靜默走錯)。
- 故障注入三次:(a) 移除 `gt()` 綁定 → 讀取量斷言轉紅;(b) 丟棄尾端事件 → 等價測試轉紅、讀取量測試維持綠(兩條測不同的東西,沒有互相掩護);(c) 還原後 20 條全綠。
- `npx tsc --noEmit` 乾淨;`npm run check:architecture` 通過(policy v1, 20 modules)。

### 誠實的剩餘限制

這消除了 O(全量 canon) 的**文件**讀取,但沒有讓位元組數變成 O(1):快照列存的是整份 `WorldProjection`,而 `projection.facts` 隨世界壽命累積。Convex 的上限是位元組預算而非文件數,所以夠老的世界仍需要 fact 壓縮或更窄的投影。已寫入 `snapshotReplay.ts` 的 docblock,不隱藏。

## Slice 0 完成:讀取量量測基線

新增 `convex/operations/postCommitLiveFunctions.readMeasurement.test.ts` —— 這是 `postCommitLiveFunctions.ts` 的**第一份測試覆蓋**,也是整個 repo 裡**第一個文件讀取量測**。

harness 的關鍵設計:`createMemoryDb` 強制真實的 Convex 索引語意 —— 每次讀取都必須經由 `.withIndex(name, builder)` 且 name 必須在 `INDEX_REGISTRY`(從實際 `schema.ts` 抄錄)內;裸 `.query(table).collect()` 或未註冊的索引名會**明確拋錯**而非靜默全掃。`eq()` 必須覆蓋索引宣告欄位的合法前綴,緊接的下一個欄位允許 range 運算子。`runMutation` 經 `getFunctionName` 派送到**真正**的已註冊 handler,共用同一組資料表;未派送到的呼叫拋 `UNDISPATCHED_MUTATION` 而非 no-op。

### 基線數字(量測所得,非估計)

| N | docsRead | canonEvents | postCommitRuns | postCommitCheckpoints | recapSnapshots |
|---|---|---|---|---|---|
| 30 | 323 | 268 | 25 | 22 | 8 |
| 60 | 613 | 558 | 25 | 22 | 8 |

N 加倍 → 讀取量比值 **1.898**。非 `canonEvents` 的列數在 N 之間**完全恆定**;所有成長都在 `canonEvents`(268→558)。這在數字上證實了 AC#1 的訊號就是全量重播,而不是其他東西。

AC#1 測試目前是**有紀錄的已知紅**(skipped,註解內含上述數字),隨後續 slice 落地應轉綠。不得為了讓它過而弱化斷言。

### harness 目前的兩個量測失真(已知,待補)

1. fixture 從不建立 daily 快照,因此永遠量到 cold-start 分支 —— 這會**低估**所有快照式修正的效果。生產環境中 stage 20 每個世界日都會寫快照,任何過了第 1 天的世界必定有。
2. 單一 world-day 的 fixture 讓 `rebuildVoteConsequenceProjection` 的日範圍讀取與 `rebuildOnboardingSummary` 的尾端掃描退化回全歷史讀取,因而**低估**這兩處已落地的修正。

兩項已回饋給 harness 作者補上多日與含快照的變體,並要求同時報出有/無快照的兩組數字。

## Slice 1a 完成:索引綁定修正(四處 + 一處計畫外)

| 站點 | 舊綁定 | 新綁定 |
|---|---|---|
| `relationshipArcProjectionFunctions.ts` `rebuildArcProjection` | 全日誌 collect 後過濾成 `arcSourceSequences` | N 次 `worldId+sequenceNumber` 點查,再顯式重排升冪(點查解析順序不等於序列順序) |
| `onboardingSummaryFunctions.ts` `rebuildOnboardingSummary` | 全日誌 collect | `.order(desc).take(windowSize)`,自 25 起倍增,直到**兩個**消費端都滿足或 Canon 耗盡 |
| `voteConsequenceProjectionFunctions.ts` `rebuildForDay` | 全日誌 collect(註解稱 unavoidable) | 兩階段:`by_world_and_day` 找 trigger → 僅在有 trigger 時讀 `gte(sequenceNumber)` 後綴;無 trigger 的日子**零次** Canon 讀取 |
| `story/portfolioFunctions.ts`、`projectionFunctions.ts`、`entryRecommendationFunctions.ts` | 全日誌 collect 建 id 集合 | 分別為 N 次點查、≤3 次點查、`.order(desc).first()` |

### 執行者找到一處計畫外的正確性問題

`onboardingSummaryFunctions` 有**第三個** canon 消費端,我的計畫沒列到:`dailyEpisodes.keyScenes` 的旁白遮蔽。它可能引用遠在成長視窗之外的事件,若沿用視窗內的 `withheldEvents` 集合,會對視窗外的事件得到**偽陰性的「未被withhold」** —— 亦即把已被拒絕的文字放行。已改為對 key scenes 指名的 `sourceEventIds` 做自己的有界點查。有專門的回歸案例證明它抓得到視窗永遠讀不到的那個 withheld 事件。

這是本 slice 唯一一處真正的安全性缺陷,而且是執行者在驗證過程中自己發現的,不在原計畫內。

### 我自己的驗證(非採信回報)

- `selectTrigger` 的欄位讀取逐字查證:只讀 `worldDay`、`idempotencyKey`、`eventId`,**沒有**碰到 Phase 1 填入佔位值的四個欄位(`causedByEventIds`、`publicSummary`、`publicationStatus`、`sceneId`)。這是兩階段讀取安全性的承載前提,成立。
- 故障注入:把後綴的 `gte` 改成 `gt`(即排除 trigger 自身)→ `voteConsequenceProjectionFunctions.test.ts` **12 條轉紅**,包含專設的「有無前置事件輸出必須位元相同」與「讀日、再讀 trigger 後綴、絕不讀整表」兩條。還原後全綠。
- 窗口迴圈終止條件經查為 `exhausted || (majorEventSource !== null && facts.length >= 3)`,正確。最壞情況(兩者永不滿足)讀完整日誌約 2x,已在 docblock 誠實標明。

### 待處理

harness 檔案中殘留一條 `DEBUG multiday numbers` 測試(含 `console.log`),不得進入 PR。

## 獨立審查(code-reviewer,對 14bb46a/456bb9e/400a67b)

結論 **REQUEST CHANGES**:0 CRITICAL / 3 HIGH / 6 MEDIUM / 3 LOW。AC#3 未被攻破 —— 審查者嘗試四條攻擊路線,全部回報「確認實作正確」。失守的是 AC#1 與量測本身。

### HIGH-1:onboarding 成長視窗是讀取量「回歸」(已修)

每次迭代從尾端重讀而非續接游標,總量為 `Σ min(25·2ⁱ, N)` 而非 `N`。分支自己的測試把它釘死:60 筆日誌讀 **135 列**(25+50+60),改動前為 60。而且無法累積 3 筆合格 fact 或無可展示重大事件的世界,**每一次 post-commit 都會跑到耗盡**。這落在本任務存在目的所要疏通的交易位元組預算路徑上,等於把 16 MiB 天花板推得更近。

修法:改為 `.lt(sequenceNumber, lowestSeenSoFar)` 游標分頁並跨迭代累積,頁面不重疊,總量 ≤ N。實測 60 筆日誌:正常型態 135 → 60,病態型態 135 → 60。注入(還原成從頂端重讀)→ 3 條轉紅,全部 `Received: 135`,與審查者算出的數字一致。

三項正確性性質經逐行 diff 確認未受影響:`importanceBySequence` 仍只在 `majorEventSource.sequenceNumber` 查詢;`withheldEventIds`/`redactWithheldSummaries` 仍為逐事件、以 eventId 為鍵;key-scene 點查遮蔽區塊零 diff。

### HIGH-2:`readProjectionViaSnapshot` 未過濾 kind、未防不可用列(已修)

`snapshotVersion` 與 `projectionHash` 在 schema 中是 `v.optional`,`rowToCanonSnapshot` 只能強制轉型,`validateSnapshot` 隨即拋錯 —— 而 **stage 19 沒有 failure isolation**,一拋就中止其後所有階段。ART-100 之前這些 rebuild 根本不讀 `canonSnapshots`,所以這是本任務**新造的**故障模式。

修法:`isResumableSnapshotRow` 要求兩欄位齊備且 `kind ∈ {daily, initial}`(排除 `manual` —— 無人約束營運者何時取、對應哪段歷史);不可用時降級為全量重播而非拋錯。讀取形狀為 `.first()`(常見路徑 O(1)),僅在最新列不可用時才 `.take(8)` 往回找。新增 3 條參數化測試涵蓋缺 hash、缺 version、manual 三種列。

明確不做 `assertSnapshotMatchesHistory`:該檢查要重播整段前綴,正是本 helper 要避免的成本。已在 docblock 寫明「對列的信任委託給寫它的人」,並指出 `readOperationalWorldProjection` 仍是會證明而非信任的讀取者。

### HIGH-3:AC#1 閘門測試無法區分線性與常數

`ratio < 1.5` 在 N=30/60 下,對 `total = C + kN`,只要 `C > 30k` 就會通過 —— 一個完全線性的 O(N) 項可以偽裝成過關。應改為直接斷言 `large.byTable.canonEvents === small.byTable.canonEvents`,那正是 AC#1 的字面意思。已回饋 harness 作者。

### MEDIUM:我自己寫的測試在斷言 `{}` 等於 `{}`(已修)

`snapshotReplay.test.ts` 的 fixture 只發 `fact_created`(world subject),導致 `relationshipHistory` 在兩份投影中皆為空 —— 而那是 `rebuildRelationshipGraphProjection` **唯一**消費的欄位,也是本 commit 的核心主張,該斷言不可能失敗。這正是本任務稍早已經咬過一次的「測試名稱指涉的性質根本沒被觸及」失敗模式,換了個形狀再犯。

修法:fixture 改發三種 state change(fact / relationship_changed / character_location_changed),使 `relationshipHistory`、`characterLocations` 非空;斷言改為**先驗非空再驗相等**;並反向斷言 `locationOccupancy`(seed 欄位)確實分歧,證明四欄位邊界是真實邊界而非不可達分支。

### 審查者獨立確認為正確的部分

- 投票後果兩階段讀取:`selectTrigger` 只讀三個欄位,佔位值永不被觸及;Phase 1 與 Phase 2 可證同選 —— 後綴只會捨棄嚴格早於 trigger 的候選,而捨棄它們不改變選擇。append-only 前提是**被強制而非假設**(`validators.ts:459-463` 拒絕指向未接受事件的 `causedByEventIds`)。
- onboarding 三項正確性性質全部安全,key-scene 修正**完整且正確**,雙向皆有測試。
- story/ 點查語意不僅保留且**更強**:`deriveEventId` 往返檢查會拒絕 `Number(0x10)` 之類能找到列卻不該通過的 id,以及跨世界 id。
- harness 機制誠實:`INDEX_REGISTRY` 未隱藏全日誌讀取,`UNDISPATCHED_MUTATION` 拋錯而非 no-op。

## Slice 3 部分結果

- `rebuildTimelineProjection`:改為僅對達到重要性門檻的 sequence 做點查(門檻與 `buildTimelineProjection` 相同)。200 事件 / 10 個重大 → 10 次讀取。兩次注入:還原為 collect → 僅讀取量測試轉紅(證明它隔離的正是這類回歸);停用 `importanceBySequence` → 全部 11 條轉紅(證明測試確實走到活路徑)。
- **`rebuildLiveProjection` 停手未做,理由成立**:`buildLiveProjection` 的 `locations` 欄位是整段 `location_state_changed` 歷史的 LWW fold,而 `locations` **正是 `SEED_BASELINE_FIELDS` 之一** —— 快照替換會洩漏今日 replay-from-empty 從不呈現的 seed 資料,直接違反 AC#3。另外 `buildVisualReplay` 需在**整段**已接受歷史上排序場景重要性才能挑前三,再對勝出場景做 `foldLocations`,既非尾端可導出亦非日快照在所需子日粒度上可導出。真正的解需要一個增量維護的非 seed 位置/角色快取加上逐場景的位置 fold 快取。已寫入該檔 docblock。

## AC#1 現況(誠實)

比值 **1.895**(基線 1.898)。我拆掉 `loadCanonRows` 移除一處全量讀取,但 `loadProjection` 的兩個獨立呼叫點在無快照的 fixture 下各加回一次 —— 對該 fixture 而言是打平,不是回歸。多日含快照變體為 1.754(三處呼叫點同時修好)。

仍在做全量 collect 的呼叫點:`rebuildWorldProjection`、`rebuildCharacterProjection`(進行中)、`rebuildLiveProjection`(結構性阻塞,見上)、`loadCharacterKnowledge`/`loadCharacterMemories` 的無快照回退、`rebuildRelationshipGraphProjection` 的無快照回退。

已確認消失:`rebuildTimelineProjection` 與 `rebuildEpisodeIndexProjection` 完全不再觸碰 `canonEvents`。
<!-- SECTION:NOTES:END -->
