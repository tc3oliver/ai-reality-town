# 投票後果追蹤(Vote Consequence Tracking)

**Requirement:** FR-J002(PRD 1.0 §13.13 Epic J) — 「標記由投票觸發的事件、直接影響、後續衍生事件與尚無法確認的間接影響,且不得誇大因果」
**Task:** ART-46
**Depends on:** ART-45(FR-J001 每日環境投票)、ART-13(Canon 讀模型)

## Modules

參與這個功能的每一個檔案:

| 檔案 | 角色 |
|---|---|
| `convex/publicRead/voteConsequenceProjection.ts` | 純建構器與驗證器。四個 bucket 的定義、遞移閉包、provenance 驗證。無 Convex / clock / random |
| `convex/publicRead/voteConsequenceProjection.test.ts` | 建構器的 AC#1 / AC#2 / AC#3 測試 |
| `convex/publicRead/voteConsequenceProjectionFunctions.ts` | `rebuildVoteConsequenceProjection` internalMutation:索引讀取 → ART-132 安全閘 → 建構 → 發佈 |
| `convex/publicRead/voteConsequenceProjectionFunctions.test.ts` | handler 層測試,斷言發佈出去的 payload |
| `convex/publicRead/readModel.ts` | `READ_MODEL_KINDS` 註冊 `voteConsequence` |
| `convex/publicRead/schema.ts` | `publishedReadModels.modelKind` union 註冊 |
| `convex/publicRead/readModelFunctions.ts` | `modelKindValidator` 註冊;讀取沿用既有的 `getPublishedReadModel` |
| `convex/operations/postCommitLive.ts` | `PostCommitPort.rebuildVoteConsequenceProjection` 介面 + stage 19 呼叫(在安全性重建之後) |
| `convex/operations/publicTextModelRefresh.ts` | 共用的「重建所有公開文字讀模型」helper,安全覆寫路徑的唯一入口 |
| `convex/operations/safetyOverrideFunctions.ts` | 覆寫後透過上面的 helper 重建三個文字介面 |
| `convex/shared/environmentVoteCatalog.ts` | `voteConsequenceModelRef()` —— 五個模組共用的 modelRef 拼法 |
| `convex/operations/postCommitLiveFunctions.ts` | `internalFunctionRef` 綁定與 port 實作 |
| `convex/operations/postCommitLive.test.ts`、`convex/operations/longRunHarness.ts` | 兩個 in-memory port 的實作(用真正的建構器) |
| `src/components/vote/voteConsequenceModel.ts` | 純 view model:四個標籤、免責說明、provenance 的中文措辭 |
| `src/components/vote/voteConsequenceModel.test.ts` | view model 測試 |
| `src/components/vote/VoteConsequencePanel.tsx` | 純呈現元件(無 hook、無 Convex) |
| `src/components/public/Homepage.tsx` | 發出 `getPublishedReadModel` 讀取,並把 payload 交給面板 |
| `src/e2e/fixtureWorld.ts` | E2E fixture 的 `voteConsequence:` modelRef 分支 |

已被重用而**沒有**重寫的既有機制:`environmentVoteInterventions`(ART-45)、
`VIEWER_VOTE_IDEMPOTENCY_PREFIX`(`convex/shared/environmentVoteCatalog.ts`)、
`readWithheldSceneLabels`(ART-132)、`sceneEventRows` / `withheldEventIds` /
`redactWithheldSummaries`(`convex/publicRead/liveStateFunctions.ts`)、
`commitReadModelVersion` 與 `getPublishedReadModel`(ART-40)。

---

## 1. 設計前提:Canon 今天有什麼因果證據

`canonEvents.causedByEventIds` 這個欄位**存在而且被完整驗證**:形狀檢查與
`MAX_CAUSED_BY_EVENT_IDS = 32`、禁止自我參照(`convex/canon/validators.ts`),以及
`UNKNOWN_EVENT_REFERENCE` 的參照完整性檢查。

但**系統實際產生的每一筆事件,這個欄位都是空陣列**:

- 投票注入的提案在 `convex/simulation/worldDayLive.ts` 的 `buildViewerVoteProposal()` 裡
  硬寫 `causedByEventIds: []`;
- 預設的決定性 fake provider(`convex/simulation/fakeProvider.ts`)一律回 `[]`。

也就是說,**Canon 目前是一組孤立節點**,沒有任何一條記錄下來的因果邊。

這個事實決定了整個設計。FR-J002 不能靠推論補上因果:如果讀模型把「投票之後發生的事」
當成「投票造成的事」,那正是 AC#2 明文禁止的誇大。所以這個功能是一個
**derived read model**,它只呈現 Canon 真的有的證據,並且把推不出來的東西明確標成
推不出來。

## 2. 為什麼不去改 Canon 讓它寫入因果

被否決的替代方案:在提交管線裡自動替事件蓋上 `causedByEventIds`。

三個理由:

1. **那就是 AC#2 禁止的那件事。** 由基礎設施推斷出來的因果邊,和由模型宣告的因果邊,在
   資料庫裡長得一模一樣。一旦寫進去,下游任何讀者都無法再分辨哪一條是證據、哪一條是猜測,
   而「不得宣稱全部後果由投票直接造成」就再也無法被檢查。
2. **Canon 是 append-only,且 reducer 必須是決定性的**(`docs/architecture/adr/`)。改變寫入
   內容會改變重播結果,而且已接受的歷史不能就地修改,新規則無法回填。
3. **不在這個任務的範圍內。** ART-46 的產出是一個透明度層。真正該補的是 provider 契約——
   讓場景模擬在提案時就說出它認為自己接續了哪些事件。那是獨立、可審查的一件事。

這個模組的寫法讓那一天到來時不需要改動:一旦 provider 開始送出真的
`causedByEventIds`,同一段程式碼就會開始回報它們,`direct` 與 `downstream` 自然被填滿。

## 3. 四個 bucket,四種不同的證據

一個事件只會出現在**一個** bucket 裡(先到者勝:trigger → direct → downstream → uncertain)。
每一條連結都帶 `provenance: { basis, sourceEventIds }`。

| Bucket | 中文標籤 | basis | 是什麼證據 |
|---|---|---|---|
| `trigger` | 投票觸發事件 | `vote_idempotency_key` | 已接受事件自己的 `idempotencyKey` 帶 `vote:` 前綴,並與 `environmentVoteInterventions.appliedEventId` 交叉比對 |
| `direct` | 直接影響 | `canon_caused_by` | 已接受事件的 `causedByEventIds` **明確包含** trigger 的 eventId。深度 1 |
| `downstream` | 後續衍生事件 | `canon_caused_by` | 沿同一種邊的遞移閉包,深度 ≥ 2。每個節點記錄它**實際**被走到的路徑與深度 |
| `uncertain` | 尚無法確認的間接影響 | `director_plan_context` | 該事件所屬 scene 的導演計畫 context 的 `viewerInterventionEventIds` 含 trigger,但**沒有**任何明確因果邊 |

`uncertain` 的基礎是 **context membership,不是因果**。導演在規劃那個場景時被告知了這次投票,
這是關於管線的一個真實、可查核的事實;導演被告知很多事情,而它並不會對每一件都有反應。
標籤與說明文字都必須如實說出這一點,這也是為什麼那一區叫「尚無法確認的間接影響」而不是
「間接影響」。

`uncertain` 的鏈路是照管線真正記錄的連結走的:
`sceneSimulationRuns.sceneId → groupingRunId` →
`groupedSceneRuns.groupingRunId → directorRunId` →
`directorPlans.directorRunId → context.viewerInterventionEventIds`。
鏈路不完整的 scene 不貢獻任何連結——半途中斷的 run 不能被拿來製造關聯。

**沒有任何 bucket 收容「投票之後發生的其他事」。** 一個既沒有因果邊、也不在導演 context 裡的
事件,在四個 bucket 裡都不會出現。「自投票以來的一切」正是要避免的那種誇大。

## 4. 誠實地回報「什麼都沒有」

在今天的真實資料上,`direct` 與 `downstream` 都是空的。這帶來一個措辭問題:

- 一個空的清單讀起來像「這次投票沒有造成任何影響」——那是關於**世界**的宣稱,而且沒有根據。
- 實際成立的是「Canon 沒有記錄到任何明確的因果關聯」——那是關於**證據**的宣稱。

所以 payload 帶一個 `explicitCausalEdgeCount`,而不是讓前端自己數。當它是 0 且確實存在
trigger 時,面板會先顯示 `NO_CAUSAL_EDGE_NOTE`:

> Canon 目前沒有記錄任何事件明確由這次投票引發,因此下方不列出直接影響或後續衍生事件。

另外,免責說明是**無條件**渲染的,不是只有在有不確定項目時才出現。一個觀眾只在系統剛好沒把握
時才會看到的免責說明,讀起來像對某一頁的道歉,而不是對世界如何運作的陳述。

`payload` 為 `undefined`(查詢進行中)與 `null`(這一天沒有發佈過)都渲染「尚未有投票後果資料」,
而不是渲染空結果:「還沒載入」和「沒有後果」絕對不能長得一樣。

## 5. 發佈路徑與安全閘

- **modelKind**:`voteConsequence`,必須註冊在三個地方,否則讀取會拋錯——`READ_MODEL_KINDS`、
  `publicRead/schema.ts` 的 union、`readModelFunctions.ts` 的 `modelKindValidator`。
- **modelRef**:`voteConsequence:<worldId>:<targetWorldDay>`,由
  `convex/shared/environmentVoteCatalog.ts` 的 `voteConsequenceModelRef()` 產生。五個模組要拼出
  同一個字串(投影、管線、首頁、E2E fixture、兩個測試 harness),而它們彼此不能 import——各自
  寫一次 template string 正是 ART-146 的形狀。
- **重建時機**:post-commit stage 19(編輯發佈階段),而且是該階段的**最後一步**——排在
  `rebuildLiveProjection` 與 `rebuildOnboardingSummary` 之後。stage 19 是一個沒有隔離的 handler,
  中間 throw 會中止後面所有步驟;那兩個是**承載安全性**的重建(把被下架的文字從公開介面移除),
  所以最新、最不關鍵的讀模型不能排在它們上游。
- **重建的日期範圍**:committed event 的 world day,**以及它前面
  `VOTE_CONSEQUENCE_LOOKAHEAD_DAYS` 天**(見下)。只重建當天會讓一天的投影在世界往前走之後就
  凍結,而兩個跨日的 bucket 都可能事後才長出成員。
  沒有投票的日子也照樣發佈一個空 payload:讀取必須解析得出來,前端才說得出「這一天沒有投票事件」。

### 5.1 讀取範圍:為什麼不 collect 整個世界

`directorPlans.context`、`groupedSceneRuns.result`、`sceneSimulationRuns.result` 都是 `v.any()`,
裝的是**原始生成 blob**,是整個 deployment 裡最大的 row。而這個 mutation **每一筆已接受事件都會
跑一次**。第一版對這三張表做整個世界的 `.collect()`,等於每次 commit 都重讀整部生成歷史,而且
不設上限。

現在改成跟這三張表的其他讀者一樣(`simulation/directorFunctions.ts`、`sceneGroupingFunctions.ts`、
`sceneSimulationFunctions.ts`)用 run-scoped 索引查詢,而且用的都是本來就存在的索引:

1. `directorPlans.by_world_day_and_slot` —— 依日期取當天(與 lookahead 那天)的計畫;
2. 以這些計畫的 `directorRunId` 走 `groupedSceneRuns.by_director_run`;
3. 以這些 grouping run 走 `sceneSimulationRuns.by_grouping_run`。

`canonEvents` 仍然整批讀。因果閉包無法避免這件事(一條 `causedByEventIds` 可以指向任何更早的
事件),而且 `rebuildTimelineProjection` 與 `rebuildLiveProjection` 在同一條路徑上本來就這樣讀。
ART-100 追蹤把這些改成增量式。

`voteConsequenceProjectionFunctions.test.ts` 直接斷言**用了哪個索引**,不只是斷言結果——退回
`.collect()` 仍然會算出正確的 bucket,只有對索引的斷言抓得到。

### 5.2 日期窗口是個 bound,不是證明

`VOTE_CONSEQUENCE_LOOKAHEAD_DAYS = 1`,推導自實際的常數而不是猜的:`uncertain` 依賴
`DirectorPlanContext.viewerInterventionEventIds`,而 `buildLiveWorldSnapshot` 是從
`acceptedEvents.slice(-RECENT_EVENT_WINDOW)` 填的,`RECENT_EVENT_WINDOW = 10`
(`convex/simulation/worldDayLive.ts`)。一個世界日有五個 time slot,所以在正常運作下——每個 slot
至少一筆事件——那十筆大約橫跨兩個世界日:投票當天,加上隔天。因此 lookahead 是 1。

投影**往後看** lookahead 天找關聯,管線就**往前重建** lookahead 天,兩邊用同一個常數,不會對
「哪些日子還沒定案」產生分歧。

**已知限制,明講:** 這是一個 bound,不是證明。

- 一個每個 slot 都遠少於一筆事件的世界,導演那十筆事件的窗口會橫跨比這更多天;
- 一旦 provider 開始寫出真的 `causedByEventIds`,因果鏈原則上可以跨任意多天。第 7 天的停電造成
  第 10 天的事件,不會出現在 `voteConsequence:<world>:7` 裡。

超出窗口的關聯**不會被回報**。這與整個模組的立場一致:回報不出來的東西就說回報不出來,而不是
猜。要拿掉這個限制,正確的做法是讓 provider 在提案時就說出它接續了哪些事件(見 §2),那時
`downstream` 才有真正需要無界追蹤的內容。

### 5.3 安全覆寫也要重建這個模型

`voteConsequence` 是**第三個**用同一批 `publicSummary` 建出來的快取公開文字介面。
`submitSafetyOverride` 原本只重建 `liveState` 與 onboarding summary,於是:操作者在世界已經走到
第 9 天時下架第 7 天的場景,句子從實況地圖消失,但 `voteConsequence:<world>:7` 繼續供應它——而且
**永遠不會再被重建**,因為管線只重建 committed day 附近那個有界窗口。

修法不是在 handler 裡加第三個呼叫,而是 `convex/operations/publicTextModelRefresh.ts`:一個以
「不變式」命名的 helper,安全路徑只呼叫它一次。同樣的洞已經開過兩次(ART-125 的 onboarding
summary、ART-46 的這個),原因都是「handler 裡的呼叫清單要靠人記得加」。**之後再加任何帶 Canon
文字的公開讀模型,加在那個 helper 裡。** `safetyOverrideFunctions.test.ts` 對重建清單做**窮舉**
斷言,所以漏掉會紅。

要重建哪些日子,是從**讀模型 store 自己**問出來的(`publishedReadModels.by_status` 取
`voteConsequence` 的已發佈列,讀每個 payload 自己的 `targetWorldDay`),而不是猜哪幾天有投票,也
不是去 parse `modelRef`。那個集合剛好就是「目前可能正在供應文字的日子」。
- **讀取**:沿用既有的公開查詢 `getPublishedReadModel`。**沒有新增任何 public query**,所以
  `publicReadOnlyGuarantee.test.ts` 的窮舉清單與 module-boundaries 的 `publicFunctionSurface`
  允許清單都不需要改,公開介面不擴張。
- **安全閘(FR-P004 / ART-132)**:這是一個公開的**文字**介面,所以在**重建時**就過閘,不是讀取時。
  用的是 ART-132 自己的機制(`readWithheldSceneLabels` + `sceneEventRows` + `withheldEventIds` +
  `redactWithheldSummaries`),import 而非重寫,兩個介面才不會對「哪些事件被拒絕」產生分歧。
  被拒絕的節點會**保留**,只失去文字(`publicSummary: null`、`publicationStatus: 'withheld'`)——
  因果結構才是這個視圖要講的事,把整列丟掉會讓鏈的長度被誤報。redaction 一律以 **event id** 為
  鍵,絕不以陣列位置為鍵。沒有 scene provenance 的事件**不會**被 redact(種子與系統事件從來
  沒被分類過,沉默代表「不在範圍內」而不是「被拒絕」)。

## 6. AC#3:每一條顯示出來的連結都要能追到已接受事件

`validateVoteConsequenceLinks()` 比照 `convex/story/consequenceSummary.ts` 的
`validateConsequenceSummaries`:一條連結只有在它提到的每一個 id——事件本身、路徑上的每一步、
provenance 裡的每一個來源——都解析得到**已接受事件**時,才可以發佈。

錯誤碼:

| Code | 何時 |
|---|---|
| `VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED` | 節點、路徑或 provenance 提到不是已接受事件的 id;或某條連結完全沒有 provenance |
| `VOTE_CONSEQUENCE_DUPLICATE_BUCKET` | 同一個事件出現在一個以上的 bucket |
| `VOTE_CONSEQUENCE_INVALID` | envelope 不合法(worldId 空、targetWorldDay 非法、未知的 basis、schema 版本不符) |

**accepted 集合是獨立推導的,這是關鍵。** 早期版本在建構器內部用
`events.map(e => e.eventId)` 當作「已接受事件」的定義,等於把建構器自己的輸入拿來驗自己——
`VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED` 在發佈路徑上結構性地不可能觸發,AC#3 只是恰好因為接線正確
而成立。現在 `acceptedEventIds` 是建構器的**獨立參數**,由 wiring 從 `canonEvents` 的 **row**
以 `deriveEventId(worldId, sequenceNumber)` 推出;如果 `events` 哪天被放寬到含有 Canon 沒接受的
東西(提案中的、被拒絕的),build 會失敗而不是把它發佈出去。
`voteConsequenceProjection.test.ts` 有一條測試就是在做這個放寬,故障注入確認過它會紅。

發佈前 wiring 再對同一個 Canon 集合驗一次(defence in depth):第一次證明**建構器**只宣稱它拿到
證據的關聯,第二次證明**即將發佈的 payload** 只宣稱 Canon 已接受的關聯。

建構器的每一條回傳路徑都經過 `validateVoteConsequenceLinks(...)`——包含「這一天沒有投票事件」的
空 payload 提前回傳那條——所以不可能發佈一個沒驗證過的 payload。重建失敗時,先前發佈的版本會繼續
服務(`commitReadModelVersion` 的 failure isolation),而不是被一個沒有根據的宣稱取代。

## 7. 決定性

同樣的 Canon 必須產生位元相同的輸出,否則 `contentHash` 去重會失效,每一次 commit 都churn 出
一個新版本。所以:

- 每個 bucket 依 `sequenceNumber` 排序;
- 遍歷時的每一個選擇(菱形結構要走哪條路徑)都以 `sequenceNumber` 決勝;
- 建構器沒有 clock、沒有亂數、不讀環境。

遞移閉包**不需要**深度上限就會終止:一個事件最多進入 `reached` 一次,之後永遠跳過,所以每一輪
不是消耗掉一個未觸及的事件,就是產生空的 frontier。A → B → A 這種環會把 B 放置一次然後停止。

## 8. 前端的模組邊界

面板檔案放在 `src/components/vote/`(緊鄰 `EnvironmentVotePanel`),但**讀取**發生在
`src/components/public/Homepage.tsx`。這不是隨意的:`architecture/module-boundaries.json` 裡
`clientViewerWrite`(= `src/components/vote`)**不得**依賴 `publicRead`,而 `clientPublic`
(= `src/components/public`)可以。所以查詢在邊界要求它待的那一側,而元件在它該待的位置旁邊。

這也剛好符合 ART-45 已經建立的模式:面板是純呈現的,`HomepageView` 因此可以在沒有 Convex client
的情況下渲染,可及性測試套件才能拿真正的 markup 去測。

world day 是從頁面已經在讀的 `live:` 投影(`worldTime.worldDay`)取得的,不是從 ballot 的
`targetWorldDay`——後者是**目前開放中**那一輪將影響的日子,那一天的事件還沒發生,沒有東西可追。

## 9. E2E fixture

`src/e2e/fixtureWorld.ts` 的 `fixtureReadModel()` 加了 `voteConsequence:` 分支。這是 ART-146 的
教訓:`fixtureConvexClient` 對沒有 handler 的查詢會**拋錯**,而拋錯發生在 render 期間,所以一個
未註冊的查詢會讓**整頁**空白,而不是只有那一區不見。`src/e2e/fixtureCoverage.test.ts` 會在
`npm run check` 就抓到遺漏。

fixture 用的是**今天的真實生產形狀**:有 trigger、沒有因果邊、一個導演 context 提到過投票的事件。
一條乾淨的假因果鏈會讓瀏覽器證據建立在產品從未處於的狀態上,那正是 ART-107 §8 禁止的。

首頁的公開查詢允許清單(`e2e/dynamicView.spec.ts`)**不需要**改動:這個讀取走的是清單上已有的
`publicRead/readModelFunctions:getPublishedReadModel`。

## Verification

```bash
npm run check
npm run e2e
```

聚焦測試:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --selectProjects unit --runTestsByPath \
  convex/publicRead/voteConsequenceProjection.test.ts \
  convex/publicRead/voteConsequenceProjectionFunctions.test.ts \
  src/components/vote/voteConsequenceModel.test.ts
```
