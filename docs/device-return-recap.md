# 裝置層級回訪摘要(Device-Aware Return Recap)

**Requirement:** FR-H004(PRD 1.0 §12 Epic H、§13.12 Viewer Progress、§5.1 G10) — 「根據最後觀看
Episode 產生離開期間重大事件、追蹤角色變化、追蹤 Arc 進展、投票事件後果與推薦繼續觀看點」
**Task:** ART-39
**Depends on:** ART-38(FR-H002 Arc primer)、ART-46(FR-J002 投票後果)、ART-45(FR-J001 觀眾寫入閘)
**Related:** ART-70(FR-H005 劇透模式資料相容)、ART-71(FR-J003,擁有 AC#7 的第二子句)

## Modules

參與這個功能的每一個檔案:

| 檔案 | 角色 |
|---|---|
| `convex/viewer/schema.ts` | `viewerProgress`(§13.12 每位觀眾一列)與 `viewerProgressCounters`(每世界列數計數) |
| `convex/viewer/viewerProgress.ts` | 純決策層:命名空間化的 `viewerKey`、嘗試預算、長度上限、參照驗證、拒絕碼、寫入與讀取兩側的 runtime validator |
| `convex/viewer/viewerProgress.test.ts` | 決策層與 validator 的 AC#6 / 濫用防護測試 |
| `convex/viewer/viewerProgressFunctions.ts` | Convex 接線:`getViewerProgress`(viewer-gated query)、`recordViewerProgress`(viewer-gated mutation) |
| `convex/viewer/viewerProgressFunctions.test.ts` | handler 層測試,含 **AC#7 跨身分反向測試**、超出預算零寫入、未知 id 拒絕 |
| `convex/safety/viewerInput.ts` | 新增 `viewer_progress` surface,讓分類記錄如實標示輸入來源 |
| `convex/shared/publicText.ts` | `countChineseCharacters` 搬到 `shared`(見 §13),`recapFormats.ts` 原地 re-export |
| `architecture/module-boundaries.json` | `publicFunctionSurface` + `viewerWriteBoundary` 兩處宣告、`maxViewerMutations` 1 → 2、新 client root、新 `useMutation` 豁免 |
| `scripts/architecture/check-boundaries.test.mjs` | 上限測試改為對「上限會生效」而非對數字 1 斷言 |
| `convex/publicRead/publicReadOnlyGuarantee.test.ts` | 兩處窮舉 pin(viewer mutation 清單、`src/` 的 `publicFunctionRef` 字串)與寫入閘的規則測試 |
| `src/components/world/readOnlyWorldSurface.test.ts` | 寫入豁免由「唯一一個檔案」改為「政策宣告的每一個檔案,各自仍必須是瑣碎的」 |
| `src/components/recap/viewerProgressKey.ts` | 用戶端裝置 token,**獨立的 localStorage key** |
| `src/components/recap/viewerProgressRefs.ts` | 兩個 `publicFunctionRef`,刻意與豁免檔案分開 |
| `src/components/recap/useViewerProgress.ts` | 產品中第二個(也是最後一個)可以命名 Convex 寫入 API 的檔案 |
| `src/components/recap/returnRecap.ts` | 純 view model:路由解析、有界摘要、追蹤優先排序、誠實的投票措辭、全部中文文案 |
| `src/components/recap/ReturnRecapView.tsx` | 純呈現元件(無 hook、無 Convex、無 effect) |
| `src/components/public/ReturnRecapPage.tsx` | 容器:三個已發佈讀模型 + 本裝置進度列的讀取,以及只由使用者操作觸發的寫入 |
| `src/App.tsx` | `#recap/<worldId>` 路由註冊 |
| `src/e2e/fixtureConvexClient.ts`、`src/e2e/fixtureWorld.ts` | `getViewerProgress` handler 與 `episodes:` 讀模型分支 |
| `e2e/dynamicView.spec.ts` | 真實瀏覽器證據:開啟回訪摘要頁時寫入為零 |

已被重用而**沒有**重寫的既有機制:`deviceDigest`(ART-45)、`classifyViewerInput`(ART-56)、
`isSpoilerMode` / `SPOILER_MODES`(ART-70)、`serveReadModel` 與 `getPublishedReadModel`(ART-40)、
`countChineseCharacters`(ART-33 FR-G003)、`voteConsequenceModelRef`(ART-46)、
`PublicPageFrame`(ART-93)。

---

## 1. 出貨內容

`#recap/<worldId>` 是一個獨立的公開路由。它從**已發佈的讀模型**組出一份有界摘要:上次看到哪裡、
離開期間新增幾集、最多五則重點(追蹤內容排在前面)、追蹤故事線的進展、當天的觀眾投票事件,以及
一個接續觀看點。頁面同時提供追蹤角色 / 追蹤故事線 / 劇透模式三組控制項,按下才會寫入。

進度存在**伺服器端**,以裝置為單位,不需要登入。

## 2. 為什麼進度存在伺服器,而不是只存在 localStorage

只用 localStorage 可以讓 AC#3 看起來成立,但會讓另外兩件事不成立:

- **AC#7 的第一子句沒有東西可以測。** 「不得跨身分讀取或修改」是一個關於**儲存**的性質。若進度
  只在瀏覽器裡,伺服器沒有任何列,這條就退化成一句對 localStorage 同源政策的轉述——那是瀏覽器的
  保證,不是這個系統的。
- **ART-71(FR-J003)得從零建整個儲存層。** ART-71 依賴 ART-39,而它要做的是把匿名進度**合併**
  到已登入身分。沒有伺服器端的匿名列,就沒有東西可以合併。

PRD §13.12 也把 Viewer Progress 定義成帶 `id` 與 `viewerId` 的持久化實體,而不是一組用戶端偏好。

## 3. 這次把觀眾寫入閘從 1 放寬到 2

`architecture/module-boundaries.json` 的 `maxViewerMutations` 從 1 改成 2。這個邊界是 ART-45 刻意
設計成「要在兩個地方各改一次」才能打開的(`publicFunctionSurface.allowed` 加 `gate: viewer`,
`viewerWriteBoundary.allowed` 加同一個路徑名稱,兩者缺一 `check:architecture` 就失敗),所以這是
一次審慎的放寬,不是繞過。放寬之後仍然成立的事:

- `anonymous` 依然代表**唯讀**。`validatePolicy` 照舊拒絕任何 anonymous mutation。
- 觀眾寫入只能住在 `convex/viewer`,只能命名政策要求的安全符號,不能命名任何 Canon 寫入符號。
  `requiredSymbols` 現在還多要求 `evaluateViewerProgressSubmission`——也就是說,一個沒有速率控制
  的進度寫入會讓建置失敗,而不是通過審查。
- 用戶端的 `useMutation` 豁免仍然是**逐檔案**授予,而且只能授予在
  `viewerWriteBoundary.clientRoots` 之下。首頁、`/live`、世界介面與每一個公開頁面仍然由同一個
  檢查證明無法寫入。
- `readOnlyWorldSurface.test.ts` 現在對**每一個**豁免檔案要求同一個上限(去掉註解後少於 20 行、
  不得出現 `useState` / `useEffect` / `localStorage` / `fetch`),而不是只對第一個。這是為什麼
  兩個 `publicFunctionRef` 被移到 `viewerProgressRefs.ts`:命名一個函式不是透過它寫入。

被拒絕的替代方案是把進度寫入掛在既有的 `submitEnvironmentVote` 上(投票時順便記進度)。那會讓
一個函式同時擁有兩個不相干的驗證面與兩份預算,而且會讓「不投票的人沒有進度」——把一個 P1 功能
綁在另一個 P1 功能的使用行為上。

## 4. `viewerKey` 是命名空間化的

儲存的值是 `device:<digest>`,未來是 `auth:<subject>`。命名空間放在**值裡面**而不是另開一欄,是
為了讓 ART-71 可以把已登入的列寫在匿名列**旁邊**再合併,而不是先把每一列改寫一遍才騰出位置。
「合併」與「破壞性遷移」的差別就在這裡。

`digest` 沿用 ART-45 的 `deviceDigest`(FNV-1a,64 bit,非密碼學)。它不是在保護秘密:token 是
瀏覽器自己產生、在別處沒有意義的隨機字串。它買到的是「外洩一列 `viewerProgress` 不等於拿到某個
瀏覽器現在還在送的值」,所以這張表無法被重放到線上介面(§15)。

`lastViewedEpisodeId` 是**推導**出來的:`episode:<worldId>:<worldDay>`。這個 codebase 的 Episode
沒有自己的 id,到處都用 `(worldId, worldDay)` 定址(包括公開頁面已經在產生的 `#episode/…` 深連結),
所以推導比新增一個識別碼更不容易對不上,而且可以拿去對已發佈的 episode index 做參照驗證。

## 5. AC#7 的誠實處理 —— 交付第一子句,不假裝第二子句

AC#7 是:「匿名裝置進度與已登入進度不得跨身分讀取或修改;合併或遷移必須明確、經授權且無損。」

### 第一子句:交付,而且是結構性的

`getViewerProgress` 與 `recordViewerProgress` 都用呼叫端**自己**的 token 算出 digest,再走
`by_world_and_viewer` 索引取列。沒有呼叫端提供的 row id(`_id` / `viewerKey` / `viewerId` 都不是
宣告的參數,Convex 會在 handler 執行前就擋掉)、沒有列舉介面、沒有掃描。跨身分存取不是被一個
「可能忘記寫」的檢查擋下來,而是**沒有任何程式路徑**能走到別人的列。

反向測試在 `convex/viewer/viewerProgressFunctions.test.ts`:裝置 A 寫入後,持 digest B 的請求
讀不到 A 的列,而且 B 的寫入會產生 B 自己的列、A 的列逐位元不變。

### 這個保證值多少,說清楚

token 由瀏覽器產生,從未對任何東西驗證過。所以這個隔離**防意外**(兩個裝置不會撞進同一列)、
**防列舉**(沒有 id 可以猜、沒有清單可以走),**不防對手**——任何持有他人 token 的人,對這個
部署而言就是那個人。這與 `convex/viewer/environmentVote.ts` 對投票已經寫下的「deviceKey 是一項
主張,不是身分」是同一個保留,在這裡必須重述,不能讓 AC#7 讀起來像一個它不是的安全保證。

### 第二子句:現在無法滿足,**且不會模擬**

這個 codebase 沒有任何觀眾端登入:`convex/auth.config.ts` 在缺 `CLERK_JWT_ISSUER_DOMAIN` 時回
`providers: []`,唯二 `getUserIdentity()` 的呼叫端是 `convex/operations/opsConsoleFunctions.ts` 與
`convex/operations/proposalReviewFunctions.ts` 兩個營運端函式,`src/` 裡沒有觀眾登入介面。

因此「已登入進度」是一個**可證明為空的集合**。現在寫一段合併程式:它沒有第二個運算元,它的授權
判斷沒有憑證可查,它的無損性只能對著一個在單元測試裡捏造的身分證明——那是關於測試的證據,不是
關於系統的證據。ART-71(FR-J003,依賴 ART-39)擁有這一半;§4 的命名空間就是為它預留的。

**ART-39 不勾選 AC#7。**

## 6. 摘要在用戶端組出來,安全閘在上游已經套用

回訪摘要**完全**由已發佈的讀模型組成:`episodes:<worldId>`(FR-I004)、`timeline:<worldId>`
(FR-I008)、`voteConsequence:<worldId>:<day>`(FR-J002),再加上這個裝置自己的進度列。它不從
Canon 推導任何文字,也不發佈新的讀模型。

所以 ART-132 的發佈後安全閘**已經**套用在它能呈現的每一句話上:`rebuildTimelineProjection` 在
發佈前就用 `readWithheldSceneLabels` / `sceneEventRows` / `withheldEventIds` /
`redactWithheldSummaries` 把被撤下的場景敘述改寫掉,投票後果模型走同一條路。在用戶端再跑一次
安全閘,會是把伺服器已經做過的決定複製一份到一個會漂移的地方。

被拒絕的替代方案是做一個伺服器端的 `recap:<worldId>:<viewerKey>` 讀模型。它會把一個 per-viewer
的列放進一張整體設計都假設內容是世界層級、可快取的表,而且會讓「某位觀眾追蹤了誰」變成發佈管線
每次 Canon commit 都要重建的東西。

## 7. 為什麼是獨立路由,不掛首頁

`e2e/dynamicView.spec.ts` 對首頁斷言了兩件事:`recorded.writes` 為空,以及首頁發出的 query 集合
**窮舉**等於三個名字。這兩條是 ART-127 / ART-137 對「公開觀看不執行任何成功 Mutation」的瀏覽器
證據。把 per-viewer 的進度讀取與追蹤控制項掛到首頁,會同時改掉那個 query 集合,並且把一個寫入
控制項放進那些斷言所描述的介面裡。

獨立路由讓首頁的證據原封不動,也讓回訪摘要有自己的、範圍更窄的主張:這一頁讀三個已發佈模型加上
本裝置的進度列,而且只有在觀眾按下東西時才寫入。`e2e/dynamicView.spec.ts` 的
「the return recap performs no write on load」就是這條主張的證據——而且只有真實瀏覽器能給:一個
在 mount 時偷偷記錄造訪的頁面,在原始碼裡看起來與不記錄的一模一樣。

## 8. AC#1 是對**輸出**的約束

「不逐日完整列出所有事件」。離開三十天的觀眾不應該收到三十天的事件清單。所以:

- 缺口以**數字**回報(離開期間新增幾集、涵蓋哪幾天),不是清單。
- 重點最多 `MAX_RECAP_HIGHLIGHTS = 5` 則,**與可用數量無關**;被省略的則數會明說,並連到大事紀。
- 每一行以 `countChineseCharacters` 計長截斷(上限 40 個中文字)。用中文字而不是 code unit,是
  因為這個專案其他地方的長度單位就是中文字(FR-G003),用 `String.length` 會讓中文句子與英文句子
  用兩把尺量。

測試 `a thirty-day absence produces the same size recap as a two-day one` 就是這條:摘要的大小
不隨缺席長度成長。

## 9. AC#2 是對**排序**的保證

「優先顯示使用者追蹤內容」。追蹤的角色與故事線先填滿預算,才輪到其他內容;各組內部維持世界自己的
時序,所以每一組讀起來是一段序列,而不是一個沒人能檢查的排名。追蹤中的項目在畫面上也有文字標示,
不是只靠位置。

## 10. 投票後果必須誠實取用 ART-46

`VoteConsequenceProjection.explicitCausalEdgeCount` 在**所有真實資料上恆為 0**——沒有任何 provider
寫 `causedByEventIds`——所以唯一非空的 bucket 是 `uncertain`,而 `uncertain` 是**脈絡成員關係**:
導演在規劃那個場景時被告知了這次投票。那不是因果主張。把它放在「投票效果」這種標題下呈現,會**違反
FR-J002 AC#2**。

因此回訪摘要只呈現 **trigger**,再加一句說明 Canon 記錄了什麼、沒有記錄什麼。`composeVoteRecapLine`
**完全不讀** `uncertain` 欄位——一個 builder 從來不碰的欄位,不會被後續某次修改順手升級成「效果」。
`returnRecap.test.ts` 的
`an uncertain-only payload contributes nothing beyond the trigger` 對整份 view model 序列化後斷言
沒有任何一則 uncertain 摘要或 eventId 出現。

## 11. 濫用防護

| 控制 | 值 | 為什麼 |
|---|---|---|
| 每裝置每世界嘗試預算 | `MAX_ATTEMPTS_PER_DEVICE_PER_WORLD = 60` | 計**嘗試**而非成功寫入,所以拿未知 id 探測介面的成本與正常記錄進度相同。60 足夠讓一個誠實觀眾多次調整追蹤設定,又小到無法用來列舉世界有哪些角色與故事線 id |
| 追蹤上限 | 角色 12、故事線 6 | 不只是儲存考量:AC#2 要求「優先」,一個等於全體卡司的追蹤集合等於沒有優先 |
| **世界必須已發佈** | `PROGRESS_WORLD_UNKNOWN` | `worldId` 也是呼叫端送來的字串。沒有這一層,一個「空提交」對一個**捏造的世界**會**空洞地**通過每一個參照檢查(`[].some(...)` 是 `false`),然後配置一列 `viewerProgress` 加一個從 0 開始的新計數器——於是每世界上限跨世界之後什麼都沒有 bound 住 |
| 參照驗證 | 對 `episodes:<worldId>` 已發佈的 id 集合 | 沒有這一層,兩個追蹤陣列就是一個帶 60 次寫入預算的自由字串儲存,正是 `classifyViewerInput` 存在要防的形狀 |
| 每世界列數上限 | `MAX_PROGRESS_ROWS_PER_WORLD = 100_000` | 清掉 storage 會產生新 token,也就是新的一列。列數才是真正會消耗成本的資源 |
| 不寫入的拒絕 | `NON_WRITING_REJECTION_CODES` | 見下 |

拒絕順序由最便宜、資訊量最低者優先:預算 → key 形狀 → **世界未發佈** → 世界已滿 → 長度上限 →
安全分類器 → 劇透模式 → 參照。參照拒絕是唯一會透露一點世界資訊的,排在最後,由預算限制一個呼叫端
能收集幾次。每一個分支回傳穩定拒絕碼,沒有任何分支回聲呼叫端送來的值。

### 哪些拒絕完全不寫入

規則寫得出來,而不是靠記:**在檢查提交的「內容」之前就決定的拒絕,完全不寫入。** 那是
`PROGRESS_ATTEMPTS_EXHAUSTED`、`PROGRESS_DEVICE_KEY_INVALID`、`PROGRESS_WORLD_UNKNOWN`、
`PROGRESS_WORLD_FULL` 四個——它們是關於呼叫端與世界的性質,不是關於送來的東西。其中兩個是**配置**
拒絕,若替它們記下嘗試,就會配置它們存在要拒絕的那一列:

- `PROGRESS_WORLD_FULL` 只可能在這個裝置**還沒有列**時觸發,所以寫下嘗試 = 插入新列 + 把
  `rowCount` 推過上限。「不要配置」的那個拒絕會去配置。
- `PROGRESS_WORLD_UNKNOWN` 是同一個失敗再乘上一個無界的倍數(每個捏造的 worldId 一個計數器)。

其餘四個拒絕(長度上限、分類器、劇透模式、參照)**都**記下嘗試——它們正是可能把這個介面變成
oracle 的那些,也正是預算存在的理由。handler 的提前 return 由 `NON_WRITING_REJECTION_CODES`
推導,不另存一份會漂移的清單;`viewerProgress.test.ts` 對整個拒絕碼清單窮舉分類,所以新增一個碼
必須被刻意歸類。

## 12. 已知限制

- **跨裝置進度不會同步。** 這是「不需登入」的直接代價,ART-71 是解法。
- **清除瀏覽器資料就會失去進度。** 同上,而且這是 AC#3 的定義,不是缺陷。
- **`watchedOnly` 劇透模式下不列出重點。** 回訪摘要的內容全部來自尚未觀看的集數,列出來就是這個
  模式在做它存在要避免的事。頁面會說明,並仍然提供接續觀看點。
- **投票後果只看「最新一集所在的世界日」。** 若觀眾離開期間跨了多個有投票的世界日,只會摘要最新
  那一天。多天彙整需要每天一次讀取,而 §13.12 沒有要求,也會讓一個有界摘要的讀取次數隨缺席長度
  成長。**這個限制寫進了文案**:該區塊的三句話都說「第 N 天」而不是「你離開期間」
  (`voteNoTriggerNote()`),因為那是它實際看過的範圍。
- **`viewerProgressCounters` 只增不減。** 只在 `viewerProgress` 永不被回收時安全。該表刻意不在
  `convex/crons.ts` 的 `TablesToVacuum` 裡(`viewerProgressFunctions.test.ts` 有守衛)。若日後
  啟用保留期,**必須先加上對帳路徑**:否則計數器會單向偏高,最終讓一個幾乎沒有資料的世界被
  `PROGRESS_WORLD_FULL` 永久鎖死,而且除了這個拒絕碼之外看不到任何異常。
- **追蹤選項以 id 顯示。** `episodes:<worldId>` 只發佈 id 的聯集,沒有顯示名稱。要顯示人名需要
  另外讀每個 `character:<id>` 模型,那會讓這一頁的讀取次數隨卡司規模成長。

## 13. `countChineseCharacters` 為什麼在 `shared`

回訪摘要要用中文字數截斷每一行,而這個函式原本在 `convex/recaps/recapFormats.ts` —— 屬於
`editorial` 模組。從用戶端匯入它,等於為了五行、零 import 的一個 helper,替
`src/components/recap/*` 開一條通往整個 `editorial` 的邊界;而 `editorial` 的 roots 同時涵蓋
`convex/recaps`,其中四個檔案註冊了 `internalMutation`,之後不會有任何檢查攔得住。那也會是 repo
裡第一條、也是唯一一條 client → editorial 邊,與 `ambientMotion.boundary.test.ts` 對反方向的斷言
互相矛盾。

這個情境 repo 已經解過一次:`truncateForPublic` 就在 `convex/shared/publicText.ts`,理由正是
「伺服器與用戶端必須得到同一個答案」。所以 `countChineseCharacters` 搬到同一個檔案,
`recapFormats.ts` 原地 re-export(既有呼叫端一行都不用改),`clientViewerProgress.mayDependOn`
維持 `["viewer", "shared"]`。

## Verification

```bash
npm run check
npm run e2e
```

聚焦測試:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --selectProjects unit --runTestsByPath \
  convex/viewer/viewerProgress.test.ts \
  convex/viewer/viewerProgressFunctions.test.ts \
  src/components/recap/returnRecap.test.ts \
  src/components/recap/viewerProgressKey.test.ts

NODE_OPTIONS=--experimental-vm-modules npx jest --selectProjects a11y

npx playwright test --grep "return recap"
```
