# PRD 2.0 Requirement Matrix

**版本：** 2.0（依 review 修正狀態模型、統計、NFR 映射與責任邊界）
**來源文件：** `docs/prd-2.0.md`
**前一版基線：** `docs/prd-1.0-closure-matrix.md`
**盤點日期：** 2026-08-05

> **目前狀態：** PRD 1.0 historical closure complete; current baseline has open release-blocking regressions **ART-99** and **ART-141**（ART-139 已修復並經真實 provider 現場驗證，見 §4）。PRD 2.0 Dynamic Viewing MVP In Progress.
>
> 不得只寫「PRD 1.0 Core Simulation and Backend Baseline Complete」——那描述歷史封閉，不是目前基線健康狀態（PRD 2.0 §13.3／§26）。

---

## 1. 狀態模型

先前版本把三個不同維度混在單一「狀態」欄，導致 `Blocked` 同時被用來表達來源分類與發布嚴重度。本版拆為三欄：

| 欄位 | 值域 | 意義 |
|---|---|---|
| **Disposition** | `New` / `New (realized by V2 tasks)` / `Carry Forward` / `Existing Baseline Defect` / `Superseded` | 需求**來源**分類 |
| **Delivery State** | `To Do` / `In Progress` / `Done` / `To Do; production validation blocked by X` | **工作**狀態 |
| **Release Criticality** | `Release Blocker` / `P0` / `P1` / `P2` | **發布**嚴重度 |

三者互不蘊含。ART-99 不是「被阻擋」，它本身是**阻擋上線的缺陷**：Disposition = Carry Forward、Delivery State = To Do、Release Criticality = Release Blocker。

---

## 2. 統計

| 項目 | 數量 |
|---|---:|
| Matrix 需求列總數 | **47** |
| ├ FR-N（含 §10.3 引擎停用） | 11 |
| ├ FR-O | 14 |
| ├ FR-P | 4 |
| ├ FR-Q | 8 |
| ├ NFR2-001 ~ NFR2-008 | 8 |
| └ 基線缺陷（ART-99、ART-139） | 2 |
| 具**專屬**新 Task 的需求列 | 37 |
| 由其他 V2 Task 共同實現、無專屬 Task 的需求列 | 9（8 條 NFR + FR-Q003） |
| 沿用既有 Task 的需求列 | 2（FR-Q003 → ART-100；ART-99） |
| **唯一新 Task 數** | **34（ART-107 ~ ART-140）** |
| Carry Forward Requirement | **1**：FR-Q003 → ART-100 |
| 沿用既有缺陷 Task | **1**：ART-99 |
| Existing Baseline Defect（唯一例外） | **1**：ART-139 |
| Superseded | 0 |
| 重複建立的 Task | **0** |

**需求列數 ≠ 唯一 Task 數。** 37 個具專屬 Task 的需求列只對應 34 個 Task，因為三組需求共用同一個可審查 PR：

| 共用 Task | 涵蓋需求 |
|---|---|
| **ART-118** | FR-O001 動態 2D 地圖 ＋ FR-O005 鏡頭與導航 |
| **ART-120** | FR-O011 Ambient Movement ＋ FR-O012 Environmental Animation |
| **ART-121** | FR-O013 Visual Replay ＋ FR-O014 時間狀態標示 |

FR-O010（動態畫面降級）Disposition 為 **New**，擁有專屬 Task **ART-127**；它與 ART-91 是不同故障域的並存關係，**不是** Carry Forward。

---

## 3. 需求對應表

### 3.1 Epic N — Visual Foundation

| Requirement | Disposition | Task | Delivery State | Release Criticality | 重用證據 | Dependencies |
|---|---|---|---|---|---|---|
| FR-N001 上游視覺能力稽核 | New | ART-107 | To Do | P0 | — | — |
| FR-N002 Read-only Pixi World | New | ART-113 | Done | P0 | `src/components/world/`：PixiJS 元件移入唯讀模組並移除全部指標事件；`architecture/module-boundaries.json` 新增 `clientPublic`／`clientWorldReadOnly` 與 `readOnlyClientBoundary`（禁用 write symbol）由 `npm run check:architecture` 強制；`#help` 改寫為純觀看指南，Clerk 登入以 operator 身分回歸（見 `docs/read-only-world-shell.md`） | ART-112, ART-109 |
| FR-N003 Public Dynamic Projection | New | ART-115 | **Done** | P0 | `convex/publicRead/publicDynamicProjection.ts`：純模組將 ART-114 的 `MovementTrajectory` 白名單收斂為 PRD §10.4 `PublicCharacterMotion`（`bootstrap→idle`、八向→四向），以巢狀 `dynamic` 欄位擴充 `liveState.ts`（`LIVE_PROJECTION_SCHEMA_VERSION` 1→2）；`updatedAt`／`snapshotSequence` 由 Canon 事件而非時鐘推導以維持 `contentHash` 去重；`getPublicDynamicProjection` 為唯讀 query，沿用既有 `serveReadModel` 的 last-known-good 回退（見 `docs/public-dynamic-projection.md`） | ART-114 |
| FR-N004 Character Visual Binding（12） | New | ART-111 | **Done** | P0 | 重用 `data/spritesheets/f1–f8`（共用 `public/assets/32x32folk.png`）；8 款原始 Sprite ＋ 4 組服裝／髮色 Palette Variant，Palette Range 由實際 PNG 量測並與 `PROTECTED_SKIN_WINDOW` 互斥；`convex/visual/`；見 `docs/character-visual-binding.md` | ART-107, ART-143 |
| FR-N005 Location Visual Binding（8） | New | ART-110 | **Done** | P0 | `convex/visual/`：八個 Zone 由 `data/mistwood.ts` 的 footprint／collision 推導（Ambient Anchor 限定在 Entry Anchor 走得到的區域），label 取自 `mistwoodSeed.ts`；抵達判定為多邊形包含而非像素相等（見 `docs/mistwood-location-bindings.md`） | ART-109 |
| FR-N006 Canon／Runtime 同步 | New | ART-117 | **Done**（範圍調整：PRD §14.5 `RuntimeSyncRecord` 刻意不實作，理由見右欄） | P0 | 重用 `character_location_changed`（含 `fromLocationId`／`toLocationId`）。**PRD §14.5 的 `RuntimeSyncRecord` 表、同步命令佇列與 retry 狀態機刻意未實作**，由 ART-114／ART-115 的純函式重新推導架構取代：`planCharacterTrajectories`→`buildPublicDynamicProjectionResult` 全程無狀態、無時鐘、每次讀取重新推導，因此本需求七條 AC 中有五條由**結構性**保證取代**運維性**保證——AC#4（Runtime 失敗不寫壞 Canon）由 `module-boundaries.json` 的 `canonWriteBoundary` 加 `visualRuntime.purity.test.ts` import graph 強制（寫入路徑無法被 import，違反即 CI 失敗，非執行期風險）；AC#5（retry 不產生重複 Canon 事件）為空真，此路徑本就不寫 Canon，重新推導 byte-identical 由 `contentHash` 去重；AC#6（不同時發布於兩地）由 planner 單角色單 unit、`assertPublicDynamicProjection` 的 `seen` 集合、client 依最高 `motionSequence` 收斂三層獨立保證；AC#1／AC#2 由 `visualSyncPlanner.ts` 的 LocationFact 折疊與已發布的 `animationState`／`arriveAt` 滿足。**若改為實作 `RuntimeSyncRecord` 反而是退步**：需將 `movementPhase` 自 `PUBLIC_DYNAMIC_FORBIDDEN_FIELDS` 移除並刪除對應洩漏測試（等同把 PRD §10.4 契約擴大到超出 PRD 自身規格），並為 movement phase 建立第二個**可寫**真實來源，重新引入 §10.5 意在防止的漂移。本任務實際交付兩個真缺口：AC#7 將先前被計算後丟棄的 `snapshot.problems` 收斂為 `dynamicProblemCount`／`dynamicProblemsByCode` 由 `rebuildLiveProjection` 回傳（作為投影的非發布 sibling，`PUBLIC_DYNAMIC_FORBIDDEN_FIELDS` 未變動，ART-133 為預定消費者）；AC#3 將 in-transit 期間 `semanticLocationId` 即為目的地的規則寫入文件並以整合測試鎖定，明確標示 `worldCharacterProjection.ts` 的 `currentLocationId` 為未來必須以 `nowMs >= arriveAt` 把關的消費者（ART-124／ART-119）。見 `docs/canon-runtime-synchronization.md` 與 `convex/publicRead/canonRuntimeSync.test.ts` | ART-115 |
| FR-N007 Runtime Snapshot | New | ART-116 | **Done** | P0 | 概念沿用 `canon/snapshotManager`（獨立公開快照）：新增 `publicRuntimeSnapshots` 表而非複用 `publishedReadModels`，因為 freshness 時鐘 `observedAt` 必須在內容不變時前進，無法置入以 `contentHash` 去重的 payload；純模組 `convex/publicRead/runtimeSnapshot.ts` 承載 PRD §14.3 的雙序號（自有 `snapshotSequence` ＋ Canon 來源 `sourceRuntimeSequence`），內容重用 ART-115 已驗證的 `PublicDynamicProjection`；持久化 `status` 僅 `live｜paused`，`delayed`／`stale` 一律讀取時由 `classifyRuntimeFreshness` 依實際 slot 節奏（`PUBLIC_SLOT_START_MS` 最大間隔 6h）推導門檻，測試以真實 scheduler 常數釘住；`rebuildLiveProjection` 同交易內擷取（內容變動）＋每小時 cron 掃描 running 與 paused 世界（狀態變動與存活證明）（見 `docs/public-runtime-snapshot.md`） | ART-115 |
| FR-N008 素材授權與 Attribution | New | ART-108, ART-143, ART-144 | ART-108 **Done**；ART-143 **Done**；ART-144 **Done** | P0 | ART-143：f1–f8 角色美術 provenance 經 primary source 調查仍無法確認，H06 由 owner 決議接受 upstream MIT 授權並承擔殘餘風險，九個路徑轉為 approved 並納入 `PUBLIC_BUNDLE_PATHS`，ART-111 解除阻擋；ART-144：修正 ART-108 以 JS/TS import grep 判定 reachability 的兩個 false negative（`public/` 被 vite 原樣複製、CSS `url()` 亦會被輸出），16 個非 approved 素材確實已進入 `dist/`；因授權無法驗證且無任何 reachable 使用，該 16 個檔案連同 `src/index.css` 中的 dead CSS 規則一併刪除（非 risk acceptance），閘門改由實際 `public/` 目錄與 `src/**/*.css` 的 `url()` 推導而非人工 allowlist | ART-107 |
| FR-N009 Mistwood 專屬地圖 | New | ART-109 | Done | P0 | `data/mistwood.ts`：僅用既有 `assets/gentle-obj.png` tileset 重組出八個正典地點與 seed 道路圖（見 `docs/mistwood-tilemap.md`） | ART-107 |
| FR-N010 輕量 Visual Runtime | New | ART-114 | **Done** | P0 | `convex/visualRuntime/`：純函式 Visual Sync Planner，A\* 重寫（未沿用已刪除的 a16z `movement.ts`）；Anchor 以 characterId＋locationId＋worldDay＋timeBucket 種子決定；種子角色首次位置由 `initialLocationId` 推導而不寫入 Canon 事件；模組不 import `convex/canon` 或 `convex/util`，由 `visualRuntime.purity.test.ts` 的 import graph 走訪與 `module-boundaries.json` 的 `canonWriteBoundary` 雙重強制（見 `docs/visual-runtime-trajectory-planner.md`） | ART-110, ART-111 |
| §10.3 a16z 伺服器端引擎停用 | New | ART-112 | **Done**（ADR-0004，含 24 小時現場 log 觀察） | P0 | — | ART-107（Done） |

### 3.2 Epic O — Dynamic Live Town

| Requirement | Disposition | Task | Delivery State | Release Criticality | 重用證據 | Dependencies |
|---|---|---|---|---|---|---|
| FR-O001 動態 2D 地圖 | New | ART-118 | **Done** | P0 | `src/components/live/`（新 `clientLive` 模組）＋ `src/components/world/cameraModel.ts`：純鏡頭模型（`fitScale`／`clampScale`／`focusTargetsFrom`／`nextCamera`，NaN／Infinity 皆為全函式），鏡頭操作全部是 DOM `<button>` 而非 canvas pointer handler——因此 ART-113 的「renderer 內無任何 handler」結構性證明維持不變，且聚焦控制天生可鍵盤操作（NFR2-006）。AC#4 由四道獨立閘門保證：`clientLive` 模組邊界、涵蓋整個 `src` 的 `readOnlyClientBoundary` write-symbol 閘、`liveMapSurface.test.ts`（`CameraControls.tsx` 不得出現任何 request API，全模組僅一個 `useQuery`）、以及實測瀏覽器 Network 面板在拖曳／縮放／聚焦／回全鎮／切換跟隨期間 **零** 請求。路由改為真實路徑 `<base>/live/<worldId>`（文字版為 `/text` 手足），舊 `#live/<worldId>` 以 `location.replace` 保留 worldId 轉址,`vercel.json` 新增 SPA rewrite（須排在 `/ai-town/:match*` 之前）。同時修復兩個因「從未被掛載到任何路由」而潛伏的缺陷:`PixiViewport` 繼承自 a16z 的 `.setZoom(-10)`（負縮放,畫面鏡像放大十倍）與 clamp 只在 create 計算一次；以及 `pixi-viewport` 於 `@pixi/react` 銷毀 Application 後才解除 wheel listener 造成離開地圖時整個 app 白屏（`detachViewportFromDom`）。WebGL 不可用時為資訊性 fallback 而非 Canvas renderer——Pixi 7 未內建 canvas renderer,且文字實況已完整涵蓋同樣世界狀態（見 `docs/live-view-navigation.md`）。場景聚焦以 `primaryLocationId` 決定性啟發式作為 seam,FR-O003／ART-122 落地後一行替換；角色 sprite 屬 FR-O002／ART-119,本任務僅掛載定位 character layer 而不繪製(已由 ART-119 填入十二位居民) | ART-113, ART-115 |
| FR-O002 Canon-driven 移動與動畫 | New | ART-119 | **實作 Done；production acceptance 仍由 ART-141 阻斷**（ART-139 schemaVersion／sceneId 契約層已修復並現場驗證,故阻斷者是 ART-141 而非 ART-139) | P0 | 三件新東西:(1) **動畫時鐘**——ART-119 之前沒有任何東西推進 `nowMs`,地圖是靜止畫格,角色只在新 projection 抵達時「跳」到新位置;`src/components/live/useMotionClock.ts` 以 `requestAnimationFrame` 驅動,依 `src/components/world/renderQuality.ts` 的品質層級(high 60Hz／medium 30Hz／low 10Hz,探測失敗一律回落 medium)節流,**不發出任何網路動作**(`liveMapSurface.test.ts` 結構性斷言＋`motionClock.dom.test.tsx` 連續 60 frame 執行期斷言),因此 FR-O009「公開讀取不觸發生成」在地圖持續動畫時仍然成立;本模組刻意不掛任何重複計時器,rAF 是唯一驅動源。(2) **sprite 綁定送達 client 的路徑**——經 `data/`(邊界中立共享層,與 `data/mistwood.ts` 同一機制),**不是**新增 public query,更**絕對不是**把 `visual` 加進 `clientWorldReadOnly`／`clientLive` 的 `mayDependOn`:`convex/visual/mistwoodVisualBindings.ts` 遞移 import `convex/canon/mistwoodSeed.ts`,後者帶著十二位居民的 `privateProfile`／`privateGoal`／`fear`／`secretContents`,放寬邊界等於讓私有角色資料距離瀏覽器只剩一次 bundler 決策;sprite 目錄、調色引擎與公開名冊已搬到 `data/spritesheets/catalogue.ts`／`data/spritePalette.ts`／`data/mistwoodCharacters.ts`,`convex/visual/` 原樣 re-export(零行為變更),並新增 `data/dataBoundary.test.ts` 補上 `data/` 同時落在模組圖與 `readOnlyClientBoundary` 掃描之外的治理缺口。(3) **五個動畫狀態的呈現**——`idle`／`walking` 是 runtime 今天唯一會產生的兩個(`convex/visualRuntime/motion.ts` 的 `AnimationState` 只有這兩值);`speaking`／`thinking`／`activity` 以 fixture 驅動的休眠渲染先行落地(與 `PUBLIC_MOTION_TYPES` 先宣告 `ambient`／`replay` 同一先例),內容由 FR-O004／ART-123 供給。指示符是 `Graphics` 向量圖形而非 emoji 或新 sprite frame:本 repo 未內建 emoji 字型(跨 OS 會變成彩色／單色／tofu 三種結果),且 `f1`–`f8` 每張只有四組行走循環、沒有說話或思考格,PRD §6 又禁止新增美術。AC#7 由 `motionQualityTiers.test.ts` 證明——同一個真實 multi-hop fixture 在 60／30／10／1Hz 四種取樣網格上,`semanticLocationId` 每個取樣點皆相同、最終位置精確等於發布目的地、且沒有任何取樣離開發布路段:**沒有任何 tick rate 能改變語意狀態,語意來自 projection,只有像素位置來自時鐘**。另修掉一個潛伏的 clamp off-by-half-tile(錨點是 tile 中心 `tile + 0.5`,原本卻 clamp 到 `width - 1`,地圖最後一欄的角色被靜默內推半格)。Reduced Motion **不**凍結角色插值(那本身就是 AC#6 禁止的瞬移),只把鏡頭轉場收斂為 0ms 並讓指示符維持靜態。兩項既有架構偏差已記錄於 `docs/character-motion-rendering.md` §10:直線插值忽略碰撞感知路徑(`waypoints` 刻意不發布,否則洩漏碰撞層形狀),以及 `VISUAL_RUNTIME_NO_PATH` 在後端層級本來就是真瞬移(ART-117 已計數的降級,client 無法分辨)。文件:`docs/character-motion-rendering.md`(新增)、`docs/read-only-world-shell.md`、`docs/character-visual-binding.md` | ART-118, ART-117 |
| FR-O003 活躍場景視覺化 | New | ART-122 | **Done** | P0 | 核心修正是**重新綁定生產者**:場景原本只從 `dailyEpisodes`(`status==='ready'`)推導——那是每個世界日僅一次的敘事產物,因此一天五個 slot 中有四個地圖上根本沒有場景(AC#7 的癥結)。新定義為「共享 `(worldDay, timeSlot, locationId)` 的已接受 Canon 事件集合」(`convex/publicRead/activeScenePresentation.ts`,純模組):不需新資料表、不需新事件型別、不需新模組相依,且每次 Canon commit(一日五次)就刷新。明確**排除** `GroupedScene`(違反 `publicRead`→`simulation` 邊界,且被 safety 攔截的場景仍留有 row,讀取等同公開 safety 拒絕的內容)與 `sceneSimulationRuns`(原始 LLM 輸出含對白)。AC#6 由追溯 `sourceEventIds` 解析 `locationId`(最高頻,平手取 id 升冪;退而求其次用 `character_location_changed.toLocationId`;皆無則**整個欄位省略**,絕不捏造)、`participantCharacterIds`(經 `excludedCharacterIds()` 過濾,不列出地圖已拒繪的死亡／停用角色)、`arcIds`(join `storyArcEventClassifications`)、`startedAt`／`endedAt`(取最小／最大 `sequenceNumber` 事件的 Canon `acceptedAt`,非時鐘)。AC#8 當前 slot 無可定位事件時,降級為**唯一一個** `status:'ended'` 的最近完成場景。AC#4 落地四道閘門(Canon 接受閘、欄位閘——`SceneEventLike` 型別上根本沒有 `metadata`／`reason`,讀取即編譯錯誤、episode `ready` 閘、`PUBLIC_DYNAMIC_FORBIDDEN_FIELDS` 新增 `trigger`／`dramaticPressure`／`keyActions`／`dialogueHighlights`／`rumors`);per-scene 發布狀態機／營運 withhold 明確延後至 FR-P004／ART-132,`publicationStatus` 先以單成員 union 出貨。**關鍵相容性約束**:新增的八個欄位**全部 optional**——`assertPublicRuntimeSnapshot` 在 `serveRuntimeSnapshot` 讀取時執行且會 throw(非降級),必填欄位會讓 `publicRuntimeSnapshots` 既有 row 全部讀取失敗、公開地圖直接黑掉;故 `RUNTIME_SNAPSHOT_SCHEMA_VERSION` 刻意不 bump,並以雙向測試釘住(ART-122 前後的 scene 形狀皆須通過)。欄位命名保留 `title`／`summary` 而非 PRD §14.6 的 `publicTitle`／`publicSummary`,改以文件記錄對應(改名會破壞 ART-115/116/119/120 消費者且零隱私收益)。客戶端:`focusTargetsFrom` 產生 `kind:'scene'` 聚焦目標(無對應 footprint 者靜默略過,絕不置中於原點),auto-follow 改為 `primarySceneLocationId(scenes) ?? primaryLocationId(motions)`——後者降級為**有文件記載的 fallback** 而非刪除(無地點世界與 ART-122 前的 last-known-good payload 仍會走到);新增 `ActiveScenePanel.tsx`(真 `<button>`,無 Pixi handler)與文字實況同步顯示參與者／故事線／Episode 連結。AC#5 以既有 `#episode/<worldId>/<worldDay>` deep link 達成,不另建 recent-events UI。見 `docs/active-scene-presentation.md` | ART-118 |
| FR-O004 公開交談與活動提示 | New | ART-123 | To Do | P0 | — | ART-119 |
| FR-O005 鏡頭與導航 | New | ART-118（共用） | **Done** | P0 | 同上：pan／zoom／pinch／聚焦角色／聚焦地點／回到全鎮視角／自動跟隨可關閉，皆為純客戶端 view state；Reduced Motion 解析為 `transitionMs === 0`（直接 snap，不排程 tween）並移除 `decelerate` 慣性外掛；`clampScale`／`clampZoomStep`／viewport `clampZoom([fitScale, 3])` 三層防暴走縮放，實測連按 23 次拉近與 80 次滾輪縮放皆停在 3.0，連續滾輪縮小停在 fitScale 0.41667，平移飽和於地圖邊界內（見 `docs/live-view-navigation.md`） | ART-113, ART-115 |
| FR-O006 公開角色卡 | New | ART-124 | **Done** | P0 | 純模組 `src/components/live/characterCardModel.ts` ＋ 渲染層 `CharacterCard.tsx`,沿用 `characterRoute.ts`(ART-43／FR-I005)既有的**明示白名單**模式而非另立一套:view model 只由**具名欄位**構成、從不展開輸入物件,`CHARACTER_FORBIDDEN_KEYS` 直接自該模組 import 以免兩個表面各自漂移。**開啟方式刻意不是點畫布**:`src/components/world/Character.tsx` 為 `eventMode="none" interactiveChildren={false}`,`readOnlyWorldSurface.test.ts` 更以結構掃描全 `src/` 拒絕角色渲染附近的任何 handler;何況畫布 hit test 本就鍵盤不可達、輔助技術不可見。故改在 `CameraControls.tsx` 既有的每角色聚焦按鈕旁再放一顆具名 `<button>`(`查看 <id> 的角色卡`,每列文字相同故名稱帶角色,WCAG 2.4.4),角色 id 由 `characterIdFromFocusTargetId` 自 `characterTargetId` **反推命名空間**而非另寫字串常數。卡片以區塊堆疊呈現而非覆蓋層:本專案尚無 dialog 模式可循,正確的 modal 需 focus trap 與還原才值得做,且遮住畫布等於遮住觀看者打開卡片想看的那個角色。**兩個新讀取皆 `'skip'` 至卡片開啟為止**(`character:<id>` 與 `timeline:<worldId>`,均走既有失敗隔離的 `getPublishedReadModel`,零新後端表面、讀取不觸發生成),因此看地圖仍只花原本兩個 query;選取狀態因而**上提到資料層** `LiveMapPage.tsx`(與其參數化的讀取同層,沿用 ART-120 上提 `reducedMotion` 的既有理由),`liveMapSurface.test.ts` 同時斷言 query 名稱、總數(4)**與 skip 數**(2)——「四個 query」與「掛載時四個 query」對公開頁面是兩種截然不同的主張。地點／活動／故事線**完全不需新讀取**:前二者取自地圖已載入的 `PublicCharacterMotion`,後者取自 `activeScenes[].arcIds` 並限縮於 `status:'active'` 且 `participantCharacterIds` 含該角色的場景。AC#6 由**同一張資產表**成立:卡片肖像走 `useSpriteAssets()` 以 `mistwoodCharacterSpriteKeys[characterId]` 取鍵,與 Pixi 畫布同源,測試直接比對 `composeReadOnlyWorldViewModel` 實際解析出的 `spriteKey` 而非手寫常數(手寫期望值在兩邊同時漂移時仍會通過)。**範圍延伸(已獲使用者核可)**:研究 AC#5 時發現角色公開傳記(`publicProfile`／`publicGoal`／`personality`／`values`／`fear`／`behaviorRules`／`occupation`)在建世後可由 LLM 透過通用 `fact_created`／`character_state_changed` 改寫,而 ART-132 的 post-generation 閘門**只掃場景敘事文字**,此路徑從無任何 safety 閘門。修法沿用 ART-132 既有機制而非另建:(a) `sceneSimulation.ts` 的 `publicText()` 加入公開可見、`subjectType:'character'` 的 `fact_created.value` 與全部 `character_state_changed.toValue`(後者無 `visibility` 欄位,凡被接受即由 `CHARACTER_STATE_FIELD_MAP` 折入公開投影,故本質公開)——這是**擴大分類器輸入**而非新增第二次分類,每個場景仍只有一個判決、仍以同一 `sceneId` 為鍵,營運 override 因而繼續以場景為單位治理;(b) `worldCharacterProjectionFunctions.ts` 的 `rebuildCharacterProjection` 呼叫同一個有界的 `readWithheldSceneLabels` 掃描(**不**退回逐事件查詢),`characterSourceFrom` 對 `metadata.sceneId` 被拒的事件**視同從未被接受**地跳過,欄位因而保留前一個 known-good 值(首次寫入即被拒者則整個欄位缺席);`character_location_changed`／`character_life_changed` **刻意不閘**,理由與 ART-132 不動角色運動一致——因一句審核中的描述而讓角色在地圖上移動是更大的謊。無 `metadata.sceneId` 者(seed／system／remediation 事件與 ART-132 之前的歷史)**不視為被拒**,沿用 ART-132「分類器沉默＝從不在範圍內」的既定慣例。見 `docs/public-character-card.md`、`docs/dynamic-safety-filtering.md` §4a | ART-118, ART-111 |
| FR-O007 Live Story Overlay | New | ART-125 | **Done** | P0 | 純模組 `src/components/live/storyOverlayModel.ts` ＋ 渲染層 `StoryOverlay.tsx`,沿用 ART-122／ART-124 既有的「pure view model ＋ props-in 渲染層」拆法。**零新後端表面**:世界日／時段／進行中場景**完全不新增讀取**,直接沿用地圖已載入的 `PublicDynamicProjection`——不是為了省一個 query,而是同一個 projection 物件在同一次 render 中同時餵給 canvas 與 overlay,兩者**結構上不可能不同步**(AC#4),而非「通常會同步」。另外兩個讀取皆走既有失敗隔離的 `getPublishedReadModel`(首頁讀的同兩個 model):`onboarding:<worldId>`(FR-H001／ART-37)提供目前情勢、最新大事與建議 Episode——「最新大事」刻意取 `structured.majorEvent`(**依重要度**挑選)而非 `liveState.recentEvents`(僅依時間),因為 AC#1 問的是「為何重要」;`live:<worldId>` 僅為取得 arc 的 **title**——`activeScenes[].arcIds` 只有 id,顯示 `arc-truce` 等於沒回答。AC#6 **由構造成立而非由小心成立**:兩者皆為 Canon commit 時重建、由 public read-model store 服務的快取模型,讀取路徑上根本沒有 generator,亦無 cache-miss 回退生成的分支(ART-37 的既定設計)。與角色卡的兩個讀取不同,**這兩個不 skip-gate**:卡片是被打開的,overlay 依 UX2-004 恆常存在,gate 在無事可 gate 上;`liveMapSurface.test.ts` 因此同時斷言 query 名稱、總數(6)**與 skip 數(2)**——「六個 query」與「掛載時四個 query」對公開頁面是兩種主張。「主線故事」由客戶端排序決定(後端刻意不排:哪條線最重要是呈現問題):`climax > escalating > active > resolving`(即 `ACTIVE_ARC_STATUSES`),平手取 `arcId` 升冪——因此**決定性**(同一 payload 恆得同一條線,與後端發布順序無關)且**全函式**(未知 status 排最後但仍可入選,未來新增生命週期階段降級為「排最後」而非「消失」)。AC#5 以原生 `<details>`／`<summary>` 達成(本專案尚無 collapsible primitive,自建需自理 `aria-expanded`／鍵盤／焦點才能追平瀏覽器內建;渲染面因此**零 `<button>`、零 `aria-expanded`**),預設展開(UX2-004 要求恆常可得,可收合是為小螢幕而非預設),世界日／時段放在 `<summary>` 內以便收合後仍答得出「這是何時」。**「不遮蔽地圖」以結構而非 CSS 保證**:overlay 是 `.live-map-canvas` 之**前**的區塊手足而非定位層,區塊手足在結構上不可能遮住 canvas——`liveMapSurface.test.ts` 釘 DOM 次序與「canvas 不巢套於 overlay 內」,`liveMap.a11y.test.tsx` 釘樣式表 `position: static` 且所有 `.live-story-overlay*` 規則不得出現 `absolute`／`fixed`／`sticky`／`z-index`。`undefined`(讀取中)與 `null`(讀取完成但未發布)沿用 ART-124 的三態不合併慣例,並**逐來源(`summaryStatus`／`arcStatus`)追蹤而非合併為單一面板狀態**:兩個讀取在不同時間到達,合併狀態會讓面板處於任一來源都不在的狀態——摘要為 `null` 但 arc 有資料時會判為 `ready`、吞掉「摘要尚未建立」提示,又以肯定語氣宣稱「目前沒有可顯示的近期大事。」(那其實是「這個來源從未載入」);載入期間更會同時渲染 spinner 與各區「沒有」空狀態,自相矛盾。故「尚未載入」「從未建立」「確實沒有」為三句不同的話,只有第三句是對世界的斷言;空 `activeArcs` 陣列判為 `ready`(模型已發布、此世界確實沒有進行中故事線)。另因兩個 payload 皆經 `as` cast 取自未定型的已發布模型,且本渲染位於包住**整頁**的 `LiveMapErrorBoundary` 內,所有 payload 路徑全程 optional-chain(`summary?.structured?.majorEvent?.…`,對齊 `homeRoute.ts`)、`activeArcs` 以 `Array.isArray` 檢查而非 `?? []`——畸形 payload 只該讓 overlay 降級,不該讓地圖整片空白。**範圍延伸(安全審查發現,阻擋級)**:把 `onboarding:<worldId>` 接上受保護的公開表面時,發現它是 ART-132 安全過濾從未覆蓋的公開文字表面(本 epic 同類缺口第三例,前兩例為 ART-132 自身的 `liveState` 與 ART-124 的 timeline 投影):`rebuildOnboardingSummary` 直接自 `canonEvents` 取 `publicSummary`、自 `stateChanges` 收 `fact_created` 的 predicate／value、自 `dailyEpisodes.keyScenes` 取當日敘事,三者**全部**落入 `summaryText`,因此被營運 withhold 的場景仍以自己被拒絕的句子向每位首次訪客介紹世界。修法沿用 ART-132 既有機制(`readWithheldSceneLabels` ＋ `sceneEventRows`／`withheldEventIds`／`redactWithheldSummaries`／`redactWithheldNarration`,自 `liveStateFunctions.ts` import 而非重寫):major event 自**已遮蔽**的事件陣列挑選(被拒事件沒有 summary,自動往前找下一個可顯示者)、被拒場景的 fact 整筆跳過、被拒敘事的 key scene 由 `redactWithheldNarration` 中性化後往下一個非空場景遞補。與 timeline 的**保留並清空**不同,此表面採**跳過並重挑**——timeline 是公開歷史,刪列等於默默重新編號;本模型無位置、無定址,以 `(無摘要)` 開場嚴格劣於以最佳可顯示事件開場。另 `overridePostGenerationSafetyLabel` 同一交易內加跑 `rebuildOnboardingSummary` 並回報兩次 refresh:只補閘門而不重跑,被拒句子會留在已發布模型直到下次自然 Canon commit——在暫停或已結束的世界即永遠。`onboardingSummaryFunctions.test.ts` 以 handler-level、對**已發布 payload** 斷言,每個受閘欄位皆有一組配對測試(無 withhold 時確實會外洩→證明 fixture 真的把文字送上表面、閘門測試非空過),另涵蓋營運 override、釋放、`human_review_required`、無 provenance 不視為被拒、以及以 event id(而非陣列位置)為鍵。見 `docs/live-story-overlay.md`、`docs/dynamic-safety-filtering.md` §4b | ART-118 |
| FR-O008 響應式觀看體驗 | New | ART-126 | **Done** | P0 | 單一 `.live-stage` grid 容器,恰兩個子元素(`.live-map-canvas`、`.live-story-overlay`)為區塊手足;`<64rem` 一欄故地圖在上(AC#2 行動版以地圖為主),`>=64rem` 兩欄 `minmax(0,3fr) minmax(0,2fr)` 故兩者同時在畫面上(AC#1)。**刻意以「改變欄數」而非 `order` 達成**:翻轉視覺次序而不動 DOM 會讓閱讀次序與焦點次序不一致(WCAG 1.3.2／2.4.3)——明眼鍵盤使用者 tab 到的控制項不在他視線所在處。改變欄數則在任何寬度下視覺次序恆等於 DOM 次序,無可失步之處;因此本任務是**把 canvas 移到 overlay 之前**,而非保留 ART-125 次序再用 CSS 覆蓋,測試並斷言三個選擇器皆無 `order`／`*-reverse` 宣告以防日後回流。此舉更動了 ART-125 的次序設計(overlay 在前,理由是「為何重要」該先於地圖被回答),但 ART-125 AC#5 實際要求的是**可收合且不遮蔽地圖**,該保證原封未動:兩者仍為常規流中的區塊手足、互不巢套,`storyOverlayLayout.dom.test.tsx` 仍在**掛載後的真實樹**上證明之。AC#1 另需頁面加寬:`PublicPageFrame` 新增 opt-in `width` prop,所有既有頁面維持 `max-w-2xl`(中文行長的舒適尺度),**僅**地圖頁要求 `wide`(`max-w-5xl`)——672px 欄寬放不下地圖並排面板,AC#1 在其中根本不可達;逐頁 opt-in 而非全域加寬,故無任何散文頁面靜默失去行長。AC#2 的「Bottom Sheet **或等價模式**」選擇**地圖下方的常規流卡片堆疊**而非固定式 sheet,三個理由:(a) 釘在視窗底部的 sheet 會蓋住地圖,而角色卡描述的正是觀看者在那張地圖上看著的角色——蓋住等於藏起答案,與 ART-124 讓卡片為區塊而非 modal、以及 FR-O007 AC#5 對隔壁面板的要求同一套理由;(b) 正確的 sheet 是一個 dialog,需 focus trap、Esc、背景 inert,本專案無 dialog primitive,半成品對鍵盤使用者比沒有更糟;(c) sheet 要解的「剛打開的東西在畫面外」問題,卡片已由 ART-124 的 mount 取焦解決(取焦即捲入視野),在長堆疊頁面底部按下「角色卡」兩者結果相同。AC#2 另令 overlay 的 `<details>` **桌面展開、compact 收合**:FR-O007 明言行動版不要求同時顯示全部資訊,而 compact 時 overlay 位於地圖**下方**,展開會把重播、場景面板與鏡頭控制再往下推一個螢幕。決策來自 `useCompactViewport()`(`matchMedia` hook,鏡像 `useReducedMotion`),其 `COMPACT_VIEWPORT_MAX_REM = 64` 與 CSS media query **同一個數字且由測試斷言兩者一致**,故 disclosure 不可能與 layout 對「什麼叫 compact」有不同認知;`matchMedia` 不存在時回報**非** compact,偏向顯示脈絡而非隱藏。React 僅在其上次算繪的值改變時才寫 `open`,故觀看者自己的收合在每次 re-render 中存活,僅在跨越斷點(resize／旋轉)時重新決定。AC#3:全表面每個 `<button>` 與 `<a>` 皆帶 `.public-tap`(44×44,WCAG 2.5.5／2.5.8),本任務補上四個原先誤用 WCAG 2.5.8 **行內**例外的獨立連結(文字實況指標、overlay 建議入口、角色卡的 Episode 與完整頁連結);測試在卡片開啟狀態下掃描整棵掛載樹並斷言違規清單為空,故新增控制項不可能漏帶。AC#4 有三個獨立成因,逐一封閉:(a) 世界產生的原始識別碼(`7:evening:mistwood-mill`、arc id、以「、」串接的參與者 id)無斷行機會,會抬高區塊的 min-content 寬度把整頁推寬——`.public-page` 加 `overflow-wrap: anywhere`(用 `anywhere` 而非 `break-word`,只有前者同時縮小 intrinsic min-content 寬度,那才是真正止住溢位的一半);(b) grid track 的自動最小值是 `auto`,canvas 會拒絕縮小而把 grid 撐出視窗——兩個 track 皆用 `minmax(0, …)`;(c) `.live-map-canvas` 原有的 `min-height: 280px` **本身就是** blocking overflow bug——它壓過自己的 `min(70vh, 640px)` 上限(故實際生效的是下限),而橫放手機約 360px 高,地圖加頁首即無其他內容可見。改為 `height: clamp(200px, 60vh, 640px)`,並重複一行 `dvh` 供能量測行動版網址列後實際視窗的瀏覽器使用,另加短橫向規則(`orientation: landscape` 且 `max-height: 32rem`)降至 `clamp(140px, 55vh, 320px)`。AC#5 在 compact viewport 上以真實掛載＋真實 click 證明:角色卡可開、可關、取得焦點、關閉鈕具觸控尺寸,場景卡保有聚焦鈕與 Episode 連結。`liveResponsiveLayout.dom.test.tsx` 把每條 AC 拆成「DOM 能定案的一半」(何者存在、誰包誰、次序、class、小視窗下按下去會怎樣)與「只有樣式表能定案的一半」(`@media` 規則、track 定義、clamp 邊界)並**兩半都斷言**——jsdom 不套用 CSS,任一半單獨都不成立主張。四次 fault injection 反證測試非空過(還原 `min-height:280px`→1 失敗;拿掉一個 `public-tap`→6 失敗;把 overlay 移回 canvas 之前→9 失敗;讓 overlay 恆常展開→11 失敗)。**尚未涵蓋**:真實瀏覽器引擎在真實視窗下的實際排版——本 repo 尚無 headless browser,那是 ART-137(FR-O008 的桌機／行動雙向 E2E)的工作,本套件是其結構性地板而非替代品,瀏覽器證據於發布關卡 ART-138 收齊。見 `docs/live-responsive-layout.md` | ART-125, ART-124 |
| FR-O009 公開只讀保證 | New | ART-128 | **Done** | P0 | 保證成立且已機器強制：公開瀏覽結構上無法寫入或觸發生成。修復兩個 Critical：`convex/init.ts` 原以 `mutation`（非 `internalMutation`）匯出，任何匿名 client 皆可呼叫**且成功**，違反 §18.1「成功公開 mutation 為零」；`POST /replicate_webhook`（`convex/music.ts` 的 `httpAction`）無簽章驗證，匿名 POST 即造成伺服器 `fetch()` 攻擊者可控 URL、儲存無上限 blob 並寫入資料列——該模組為完全無呼叫者的死碼，故整組刪除（含 `MusicButton.tsx`、`replicate` 依賴；`music` 表比照 ADR-0004 留為 inert）。新增第三道邊界 `publicFunctionSurface`（`architecture/module-boundaries.json`）掃描 `convex/**` 的 `query`／`mutation`／`action`／`httpAction` 註冊並與 allowlist 雙向 diff，`httpAction` 一律禁止、公開 mutation 必須 operator-gated——此閘門先於修復落地並實際紅燈抓出上述兩個缺陷（證據見文件 §7）。另修復 `getPublicRuntimeSnapshot` 可由呼叫端偽造 `nowMs` 時鐘以偽造 freshness（GAP 6），並將 `readOnlyClientBoundary` 由兩個元件目錄擴及整個 `src`（GAP 3）。安全套件 `convex/publicRead/publicReadOnlyGuarantee.test.ts`（31 tests）以列舉、對抗式呼叫（throwing-db proxy 證明拒絕發生在讀取任何資料列之前）與缺席證明覆蓋全部 8 條 AC，並經三個 mutant 反證確有效力（見 `docs/public-read-only-guarantee.md`） | ART-113, ART-115 |
| FR-O010 動態畫面降級 | New | ART-127 | To Do | P0 | — | ART-116, ART-118 |
| FR-O011 Ambient Movement | New | ART-120 | **Done** | P0 | 核心架構決定是**混合式**:ambient 位移**無法**由伺服器產生。`getPublicDynamicProjection` 服務的是**已儲存**的 payload,只在 Canon commit(一天五次,約每 4.8 小時)或每小時 snapshot cron 時重建,而 `commitReadModelVersion` 以 `contentHash` 去重——把分鐘級 ambient 座標寫進 payload 會**依構造**摧毀該去重,每天追加約 1,440 筆虛假 read-model version 列。因此伺服器只發布**資格訊號**(`settledTrajectory` 的 `motionType` 由 `'canon'` 改為 `'ambient'`,planner 唯一改動;in-transit 分支不變,`bootstrapTrajectory` 刻意維持 `'bootstrap'`→public `'idle'` 以保留「從未移動」這個可讀狀態),drift 本身由 **client** 以 ART-114 自己的 seeded primitives 重新推導(`import`,非複製)。AC#1 由**幾何**證明而非 pathfinding:每個 ambient anchor 已被斷言位於自身 zone polygon 內、每個 zone polygon 已被斷言為凸,凸集合包含任兩點間線段,故直線插值恆在 zone 內(`ambientMotion.test.ts` 以 8 zones × 全 anchor 對 × 26 取樣點覆檢)。已知限制**未隱藏**:直線可能穿過 zone 內被阻擋的道具格,v1 接受,升級路徑(預算 in-zone 路線)已記錄。AC#4 的每桶 anchor 抽取改為**算術步進**(`index(n) = (base + n·stride) mod L`,`stride ∈ [1, L-1]`),因此「相鄰桶不重複」是**代數保證**且 O(1) 可在任意桶重建——原 `selectAmbientAnchorSequence` 走有狀態 PRNG 串流,無法讓中途加入的觀看者重建;一步回看的補丁只會把碰撞往前推一格(n-1 的調整值本身回看 n-2),精確保證需無界遞迴。AC#6 為四道**零新美術**訊號:速度 0.4 vs 0.75 tiles/s、步態 0.06 vs 0.12、位移範圍(ambient 不出 zone,Canon 走路橫跨全圖)、以及在**既有** `CharacterStateIndicator.tsx` 上新增的 `'ambient'` variant——刻意畫在**腳下**而非頭頂(ART-119 三個指示符都在頭頂且都代表「此處有敘事意義」,ambient 恰恰相反);**明確否決**角色 sprite 的 alpha／tint 降低(讀起來是鬼魂或錯誤狀態,且角色每天有數小時處於 ambient)。RISK2-008 全部緩解皆為**測試**而非散文:鏡頭不可見 drift(`focusTargetsFrom` 輸出在有無 30 秒 drift 下逐位相同,且測試同時證明 drift 真的發生,故非空真)、`semanticLocationId` 不變、零 Canon 寫入、零新 read-model 列(三次相隔四小時的 rebuild 只產生一列)、無對話機制存在於整個 bundled closure。`clientWorldReadOnly.mayDependOn` 新增 `visualRuntime`,**必配**結構性 guard `ambientMotion.boundary.test.ts`:斷言 bundled closure(僅 value import;type import 會被抹除)**恰為** `{seededRandom, ambientAnchor, motion}` 三檔,且永不含 `mistwoodRuntime.ts`→`mistwoodLocationBindings.ts`→`mistwoodSeed.ts`(十二位居民的 `privateProfile`／`privateGoal`／`secretContents`);已於**產出物**驗證:`dist/assets/index-*.js` 內上述私有欄位出現次數為 0。anchor 推導搬至 `data/mistwoodAmbientAnchors.ts`(與 ART-119 sprite 名冊同一路線),`convex/visual/` import 回來,八個 zone 的 anchors 以字面值 golden test 釘住且斷言兩側為**同一物件**。projection `runtimeVersion` 升至 2,新增**可選**根欄位 `worldDay`／`timeSlot`(必填會讓 ART-120 之前持久化的 payload 全部驗證失敗,含 FR-O010 的 last-known-good,直到下次 Canon commit 前地圖空白)。文件:`docs/ambient-and-environmental-animation.md`(新增) | ART-114, ART-110 |
| FR-O012 Environmental Animation | New | ART-120（共用） | **Done（範圍內項目）** | P0 | **零新美術**:入列的四項全部使用 `ASSETS-LICENSE.md` 已核准資產,其中 `campfire.json` 與 `gentlesparkle.json` 先前**完全未使用**。水(`gentlewaterfall` 置於磨坊水道上下游,銜接 ART-109 既有的 `gentlesplash`)、火與煙(`campfire` 置於客棧灶、市集火盆、town hall 中庭火盆)、閃爍(`gentlesparkle`:果園塵埃、報社油墨微粒)、光照／日夜(單一全圖 Pixi `Graphics` 矩形,無 filter 成本)。所有放置點皆落在**碰撞層本來就阻擋**的格子,因此(a)角色不可能站進火裡或瀑布裡,(b)由同一碰撞層推導的 ambient anchors **逐位不變**——兩者皆由 `data/mistwood.test.ts` 斷言。日夜色調由 Canon 發布的 `timeSlot` 驅動,**絕不**由 wall clock:牆上時鐘式循環會在最後一則 accepted event 說是正午時把小鎮畫成黃昏,等於地圖主張一個無人接受的世界事實,是直接的 RISK2-008 違反。**明確降範圍(PRD §9.1.3 用「may include」,故合法)**並附理由:天氣(無核准資產,**且 Canon 根本沒有天氣事實**——憑空發明天氣是 RISK2-008 違反,應等 Canon 建模天氣後再議)、樹木動畫(需辨識 tileset 的樹木 tile index 並逐幀重繪,實質是新的美術作業、對 tileset 變更脆弱、單位風險換得的動態最少)、建築氛圍窗光(可行,同 `timeSlot` 疊層,純粹在四項到位後作為最低價值項目切掉)。**另修復一個自 ART-113 起就存在的線上缺陷**:`PixiStaticMap.tsx` 對環境動畫 sprite **無條件**設 `autoUpdate = true` 並 `play()`,`useReducedMotion` 當時只接到鏡頭——因此已要求作業系統停止動畫的觀看者仍看到轉動的水車與流水。修復採 `gotoAndStop(0)` 而非裸 `stop()`(單純停止會讓火焰凍在半張畫格,本身看起來像算繪故障),且偏好值在非同步 `Spritesheet.parse()` callback 內**重讀** container 而非捕獲(該 callback 在 `applyProps` 可能已改變偏好之後才 resolve)。`environmentAnimation.dom.test.tsx` 呼叫**真正匯出的函式**(測試內重寫一份會在修復被還原時仍然通過),並另以結構性斷言確保 `autoUpdate = true` 與無條件 `play()` 不會回來。Reduced Motion 保留靜態日夜色調(色調不是動態,移除反而對最需要它的觀看者拿走一個真實訊號) | ART-114, ART-110 |
| FR-O013 Visual Replay | New | ART-121 | **Done** | P0 | 兩個新純模組:`convex/publicRead/visualReplay.ts`(推導)與 `convex/publicRead/visualReplayFunctions.ts`(唯一公開 query ＋ 讀取時文字解析)。場景選取重用 ART-122 的 `groupSceneEvents`／`narrationForEvents`／`resolveSceneSpatials`(改為 export 而非重寫),先**剔除當前 slot**(與最新已接受事件同 `(worldDay,timeSlot)` 的分組直接排除)——這把 RISK2-009 收斂為**資料選取層級**的性質而非標籤層級的承諾,再依 `SceneArcMembership.importance` 評分取前三,最後重排回時間順序(重播是照順序重述故事,不是把最重要的擺最前面)。時長修整(`fitSceneDuration`)先砍尾端 `wait`,不夠再等比縮放所有步驟,**絕不砍掉 `eventCard`**(悄悄漏掉一個場景僅有的已發布句子,比讀快一點更糟)。**AC#10 的核心是位址而非文字**:`dialogue`／`eventCard` 只存 `publicSummaryId`/`publicExcerptId` ＋ 建置當下的 `publicationVersion`,文字在**讀取當下**由 `visualReplayFunctions.ts` 對照現行 `publicationRecords` 解析,版本不符或狀態非 `ready`/`published` 一律**不解析**(缺席,不是快取的舊句子)——這正是 FR-P004／ART-132 未來要建的 invalidation 賴以運作的機制,本任務只交付位址形狀與版本閘;`canonEventSummary` 的 `publicationVersion` 恆為 1(Canon 事件 append-only 永不編輯,故無版可計,記錄為已知的部分生命週期限制);`dialogue` 型別完整宣告但**從不產生**(FR-O004／ART-123 的已發布對白庫尚不存在,沿用 `motionType:'replay'` 自己先前「宣告但休眠」的同一慣例)。`REPLAY_FORBIDDEN_FIELDS`(含全部 `PUBLIC_DYNAMIC_FORBIDDEN_FIELDS`)遞迴檢查每一層,建置與served 兩端都跑。**客戶端無第二條渲染路徑**:`replayPlayback.ts` 只存*相對*時長(從不存 `startedAt`),由既有 `useMotionClock` 的 rAF tick(零新計時器)換算成絕對窗口,合成 `PublicCharacterMotion`(`motionType:'replay'`)餵給既有 `composeReadOnlyWorldViewModel`——伺服器端的 `motionType:'replay'` 因而維持自 ART-115 起「已宣告、從未產生」的狀態不變(見 `docs/public-dynamic-projection.md`)。`advanceReplay` 只能 `playing→finished`,**絕不** `finished→playing`(AC#7 的機器可證性質,而非文件承諾)；`skipReplay` 任何時點皆可轉 `finished`(AC#8)。AC#5(每視聽階段最多自動播放一次)以 `sessionStorage`(非 `localStorage`——此架構本無伺服器端 session,瀏覽器分頁的生命週期就是「一次觀看」)、鍵值內嵌 `replayId`(含最高已重播序號,新完成的 slot 天然產生新 id 而合理再次自動播放)、且**寫入失敗一律視為已播放**(fail-closed:Safari 私密模式／jsdom／配額耗盡皆不得讓自動播放重複觸發,手動「重播今日事件」按鈕不受影響)。新增獨立 read-model kind `visualReplay`(而非併入 `liveState`)以隔離重播建置失敗與即時地圖、並讓 contentHash 去重對兩者的變動頻率各自成立、也給 ART-132 一個現成的 `invalidateReadModel` 掛鉤。見 `docs/visual-replay.md`,交接 ART-132 的清單亦列於該文件 | ART-119 |
| FR-O014 時間狀態標示 | New | ART-121（共用） | **Done** | P0 | `src/components/live/timeStateLabel.ts`(純)＋ `TimeStateBanner.tsx`(`role="status" aria-live="polite"`,常駐渲染,**不**以是否正在重播為條件——若橫幅只在播放時出現,「這是不是現場」在其餘時間就沒有答案,而這正是 RISK2-009 的問題)。即時狀態顯示單一「現在」列;重播期間同時顯示「重播／稍早／現在」三列,因為誠實的陳述需要三者同時成立:正在看什麼、何時發生、世界現在在哪。**不單靠顏色區分**(AC#9):每個徽章同時帶有可見文字(`label`)、獨立 `aria-hidden` 圖形符號(`⟲`／`◷`／`◉`,去色仍可分辨)、與驅動獨立邊框樣式(實線/虛線/雙線)的 `data-time-state` 屬性,`announcement` 額外提供完整句子供 `aria-live` 朗讀;移除樣式表後三列仍以純文字互相區別,由測試直接斷言而非推論。延續 `docs/accessibility.md` 為 ART-116 新鮮度詞彙記錄的非顏色慣例。Reduced Motion 只抑制**自動**播放(手動觸發不受影響,沿用 FR-O011 AC#8 的既定慣例:未經觀看者要求的動態才是該偏好要管的事)。見 `docs/visual-replay.md`、`docs/accessibility.md` §4.7 | ART-119 |

### 3.3 Epic P — Editorial Viewing Integration

| Requirement | Disposition | Task | Delivery State | Release Criticality | Dependencies |
|---|---|---|---|---|---|
| FR-P001 動態首頁入口 | New | ART-129 | To Do | P0 | ART-118, ART-111 |
| FR-P002 Live 與 Episode 連續性 | New | ART-130 | **Done** | P0 | 五條 AC 中有兩條由先前任務已達成,據實記錄而非重做:AC#1(已結束場景連往當日 Episode)由 ART-122 的 `ActiveScenePanel` 提供,`liveMap.a11y.test.tsx` 已斷言進行中場景不給該連結、已結束場景才給;AC#4(可從 overlay 直接開啟推薦入口)由 ART-125 的 `StoryOverlay` 提供,同套件已斷言。**本任務補的是回來的方向**:Episode→角色、Arc→角色原本都只連到**頁面**,沒有任何東西回答「他們現在人在哪」——那是地圖的問題。故 Episode 詳情每個關連角色、Arc 詳情每個核心人物各多一個「在地圖上查看」連結,指向 `?focus=character:<id>&card=1`;`card=1` 同時開卡片,因為「人在哪」與「在做什麼」是同一個問題,只給鏡頭只答了一半。地圖連結是**增補而非取代**,兩頁仍保留角色頁連結,並由測試斷言。**焦點命名空間搬家且只有一個擁有者**:target id 建構子(`characterTargetId`／`locationTargetId`／`sceneTargetId`／`characterIdFromFocusTargetId`)自 `components/world/cameraModel` 移入 `components/live/liveMapRoute`,`cameraModel` 原地 re-export 故無任何 importer 變動。搬家是被架構檢查逼出來的,而它拒絕得對:`clientPublic` 不得依賴 `clientWorldReadOnly`。另一個選項是在 `components/public` 再寫一次 `` `character:${id}` ``——那是兩個**今天剛好一致**的命名空間,任一邊改前綴,所有編輯面連結會靜默失效、把觀看者丟到未聚焦的地圖,而**任何地方都不會失敗**。`clientLiveRoute` 是三方都可依賴的唯一模組(因為它自己 `mayDependOn: []`),故 `clientWorldReadOnly` 新增此依賴——一行邊界變更,結構上不可能造成循環。`liveMapLinks.test.ts` 一律斷言**往返**而非字面 href:期望 `/live/mistwood?focus=character%3Ahe-jun` 的測試會在前綴改變後繼續通過,而所有真實連結早已壞掉。往返涵蓋需跳脫的 id(`&`、`=`、`/`、中文)與含冒號的場景 id(`7:evening:mistwood-mill`)。AC#5 由兩個機制達成,兩者都沿用本專案既有做法而非另創:**鏡頭**每次變動即以 `sessionStorage` 逐世界記錄、下次掛載還原——在磨坊看戲的觀看者順著場景讀完 Episode 再回來,看到的仍是磨坊而非全鎮視角,雙向連續的導覽必須連回程也連續;**重播進度**無須新機制,ART-121 的 `replaySession.ts` 已逐分頁標記自動播放過,回到地圖不會重播看過的內容。**優先序**:明確的 `?focus=` **一律勝過**記憶中的鏡頭——剛點下「在地圖上查看 何俊」的人要的是**現在**的何俊,還原一小時前的磨坊等於無視他剛按的那一下;兩者皆無時 `resolveLiveEntry` 回傳 `mode: undefined`(「沒有意見」),讓地圖保留自己的預設而非讓本模組成為第二個決定它的地方。卡片**永不**自記憶重開:開卡片是觀看者的動作,每次回來都替他開等於頁面代他決定。**與 replay 標記相反地 fail OPEN**:`replaySession` fail closed 因其失效模式是重複自動播放;本模組的失效模式只是回到全鎮視角(即一般首次到訪體驗),故無 storage、storage 被封鎖、存取即 throw、JSON 損壞、欄位型別錯誤、存了 `zoomStep: 1e9` 等所有路徑一律回答「沒有記憶」,且不會有任何東西變得不可達——鏡頭控制就在旁邊。`resolveLiveEntry` 刻意抽為純函式置於元件外,正是為了這四個分支與所有畸形輸入都能以假 storage 在單元測試中觸達,而非只能透過 renderer。**驗證**:`npm run check` 全綠(148 套件、2251 通過、5 個既有 skip、build 成功)。**未涵蓋**:真實瀏覽器的往返導覽——本 repo 尚無 headless browser,那是 ART-137(動態視圖 E2E,其範圍明文包含雙向導覽)的工作,本套件為其結構性地板。見 `docs/live-editorial-navigation.md` | ART-122, ART-124 |
| FR-P003 統一視覺系統 | New | ART-131 | **Done** | P0 | 先診斷再上色:RISK2-006 的三個實際成因依影響排序為 (1) 頁面被設定成終端機字體——`PublicPageFrame` 掛著 `font-body` 即 `VCR OSD Mono`,一個完全無 CJK 覆蓋的等寬像素字,每個中文字都退回泛用 monospace,而等寬正是管理主控台的視覺簽名,這一個 class 造成的「工具感」多過任何配色決策;(2) Tailwind preflight 已剝除所有控制項外觀,`.public-tap` 只管尺寸,故每個公開頁的每顆按鈕都渲染成純文字;(3) 根本沒有 surface,內容直接坐在 body 漸層上,無卡片、無邊框、無層次。配色反而是三者中最不重要的——把調色盤套在這三個問題上,結果只是彩色的管理主控台。調色盤以 CSS custom properties 宣告於 `.public-page`,dark scheme 整組覆蓋,此區塊外不出現任何色彩字面值——這正是讓對比檢驗能**解析每一個 token 並在 CI 計算比值**而非依賴一次性人工量測的前提。**背景從一個變成三個**:ART-131 之前只有 body 漸層,所有對比斷言都對它量測;卡片引入 `--public-surface`、巢狀卡片再引入 `--public-surface-sunken`,一個在頁面上過關、在卡片上不及格的 token 是舊斷言結構上看不到的。現在每個 ink token 對三個背景、兩個 scheme 全部檢驗(24 個比值,最差 6.1:1 light／9.3:1 dark)。檢驗工具本身也必須先學會解析 `var(--token)`:否則它計算的是字串 `"var(--public-muted)"` 的亮度(parse 成 NaN),每個 `toBeGreaterThanOrEqual` 都會永遠通過——`the token resolver actually resolves` 對此雙向釘住。**兩個 border token 是刻意的**:`--public-border` 對其 surface 低於 2:1,而這沒問題——WCAG 1.4.11 的 3:1 針對的是**辨識元件所必需**的邊界,卡片髮絲線不辨識任何東西;凡邊框**本身是訊號**者(狀態 chip 的 border-style 即其三個非色彩訊號之一)一律改用 `--public-border-strong`(5.5:1／6.1:1),此區分由測試斷言而非僅止於意圖。**卡片以結構而非逐元素加 class 套用**:每個公開頁早已把內容渲染為單一 `<main>` 內的 `<section class="… mt-4" aria-labelledby>`(ART-93 為無障礙理由建立的形狀),故 `.public-page main > section` 直接吃這個形狀。兩個後果值得明說:頁面 markup 幾乎未動,因此本任務結構上不可能改變任何頁面**所說的內容**(AC#6);以及日後新增的 section 無須任何人記得就會得到同樣處理。測試斷言**兩半**:六個表面確實都渲染出 `main > section`(把 region 包進 `div` 的頁面會靜默退出而看起來格格不入,卻不會有任何測試失敗),以及樣式表中確實存在處理該形狀的規則。`.public-rows` 刻意為 opt-in:全面套用 `li + li { border-top }` 會在實況頁鏡頭控制的 `<ul class="flex flex-wrap">` 按鈕列每顆按鈕上方畫線,而結構選擇器無法分辨這兩種 list。AC#3／AC#7 由 `publicStatusBadge.ts`(純模組)＋ `PublicStatusChips.tsx`(渲染層)提供:live／delayed／paused／stale 四態各帶**三個非色彩訊號**(可見標籤、獨立 `aria-hidden` glyph、樣式表據 `data-state` 給出的獨立 border-style),沿用 ART-121 `TimeStateBanner` 已建立的慣例;測試把 class、`data-state` 與 glyph 的 `aria-hidden` **全部剝除**後仍要求四者由文字互異——因此主張同時撐過灰階**與**樣式表整個關閉。`stale` 不併入 `paused`,且此區分是誠實的:過期快照代表擷取路徑數小時未確認任何事,它宣稱的狀態是沒人查證過的宣稱,說成「已暫停」等於對世界斷言某件目前沒人知道的事。未知／讀取中／無法辨識的狀態一律**不渲染徽章**,故未來新增的伺服器狀態降級為沉默而非錯誤宣稱。freshness 值取自 `getPublicRuntimeSnapshot`——早已列在 `publicFunctionSurface` allowlist 的 anonymous `query`;放在首頁而非只放地圖,因為「這東西到底有沒有在跑」是訪客**在打開地圖之前**就有的問題。ART-128 移除該 query 可由呼叫端指定的 `nowMs` 正是徽章值得渲染的原因:freshness 由伺服器時鐘裁定,無人能藉由自行指定時刻讓五小時前的快照回報 `live`。`publicReadOnlyGuarantee.test.ts` 窮舉客戶端可達的 Convex 表面,故新增此參照必須是刻意且經覆核的動作——該套件存在的目的正是如此,本次也確實紅燈攔下並要求具名加入。實況面(AC#4)改由同一組 token 繪製:先前 `.live-story-overlay`／`.live-character-card` 用 `border-color: currentColor`,那不是共享決策而是各元素各自挑色;測試並斷言任何 `.live-*` 規則不得再以 `currentColor` 作為邊框色。**驗證**:`npm run check` 全綠(147 套件、2228 通過、5 個既有 skip、build 成功),built CSS 直接讀取確認 light／dark 兩組 token、卡片規則與 chip 規則皆通過 Tailwind JIT 與壓縮存活。五次 fault injection 反證斷言非空過,其中一次正是擴充檢驗工具的全部理由:一個**在 body 背景上仍然過關、在卡片 surface 上不及格**的 muted ink——ART-131 之前的斷言結構上看不見它。另修復一個本套件當場抓到的自身缺陷:`role="status"` 原本下在 `<ul>` 上,ARIA role 會取代元素的隱含 role,於是 list role 被剝除、每個 `<li>` 失去合法父層(axe `aria-required-parent`),live region 因此改為外層 wrapper。**未以機器驗證者**:AC#5 的「不再像管理主控台」本質是人的判斷,據實記為人工檢查;測試建立的是「設計系統存在、已套用於每個表面、且非單色」(accent 的通道差必須大於 48,灰色為 0)這個機械可判定的部分,美學裁決歸於 `docs/accessibility.md` §4 的人工覆核與 ART-138 發布關卡。任務自身列為 Out of Scope 者:響應式規則(FR-O008／ART-126,已交付)與無障礙合規計畫(NFR2-006／ART-135);ART-93 的無障礙地板未退步,整個 `a11y` 套件含每個表面的 axe 全數通過。見 `docs/public-design-system.md` | ART-125 |
| FR-P004 Publication 與 Safety 整合 | New | ART-132 | **Done** | P0 | 缺的不是閘門而是**join 本身**:post-generation classification 以 Scene id(`sourceId`)為鍵,但公開投影建自已接受的 Canon 事件,而事件完全沒有回指 Scene 的欄位——閘門無從套用,只能被聲稱。故先補 provenance:`simulate_scenes` 在 `validate_structured_output` 攤平提案並丟棄 scene 之前,對每個 proposal 蓋上 `metadata.sceneId`(`withSceneProvenance`,`fakeSceneNarrator` 同步比照),選 `metadata` 而非新增頂層欄位是因為 FR-B001 的事件契約已固定、新欄位得回填全部歷史事件,且「缺 `sceneId`」下游本就有明確語意。**分類 row 永不可變**:`postGenerationSafetyClassifications` 有 `SAFETY_CLASSIFICATION_CONFLICT` 去重不變式,改為可變會同時毀掉不變式與「分類器當初判了什麼」的紀錄;改以 append-only 的 `safetyStatusOverrides` ledger(`{worldId, classificationId, label, reason, actor, createdAt}`)＋純函式 `resolveEffectiveSafetyLabel`(最新 `createdAt` 勝出,無 override 則沿用原判)推導**有效標籤**,並新增 `by_world_and_source` 索引(公開投影只認得 Scene id,不認得 classification id)。營運面新增 `overridePostGenerationSafetyLabel`(public mutation,首句 `requireOperator('safety.override')`,新 capability 保留給 `admin`),寫 ledger ＋ `operatorAuditLog` 同交易,結束前呼叫 `rebuildLiveProjection`——AC#3 的「安全狀態更新即刻自公開投影移除內容」由此成立而非等下次 Canon commit。閘門**套在 rebuild 端而非 read 端**:公開讀取只服務已發布快照,read-time filter 會讓被拒句子留在 payload 裡、被 FR-O010 的 last-known-good 繼續服務;`redactWithheldSummaries` 在 `buildLiveProjection`／`buildVisualReplay` 之前就砍掉被拒 Scene 事件的 `publicSummary`,因此 AC#6 的 `canonEventSummary` 參照自然解析不到(與已 withheld 的 `episodeScene` 參照行為一致)。場景卡改以安全佔位字串呈現(`title:'內容審核中'`、`summary:''`、`publicationStatus:'withheld'`)而非整個隱藏——地圖的職責是呈現世界所在,角色明明站在該地點而場景卻消失是更大的謊;`PUBLIC_ACTIVE_SCENE_PUBLICATION_STATUSES` 因而自 ART-122 的單成員 union 擴為 `['published','withheld']`(手寫 assert 與 Convex validator 兩端同步)。閘門**有判決則 fail closed、無判決則 fail open**:群組內任一事件指向被拒 Scene 即整組 withhold(群組是把摘要**併接**發布的,放行等於放行被拒的那半),但完全沒有 classification row 的 Scene 解析為 `allow`——Canon 內有大量 seed／system／remediation 事件從未經分類器檢視,把沉默讀成拒絕會讓地圖為從不成問題的內容而空白。AC#4 由**建構本身**成立(`toPublicCharacterMotion` 與軌跡規劃器從不接觸 safety label),另以回歸測試釘住:同一世界建兩次投影(withheld 與否),`characters` 陣列須 byte-identical。AC#5 的佔位字串仍保留 `sourceEventIds`——無 provenance 的公開字串正是該準則所禁止的,不論字串內容為何。`architecture/module-boundaries.json` 為 `publicRead` 加上 `safety` 相依(safety 只依賴 shared,無循環;`viewer` 本就依賴之),但 `activeScenePresentation.ts` 仍不 import safety、改以結構化宣告 `SceneSafetyLabel`,因為 FR-O013 的重播建置器釘住該模組整個相依閉包並拒絕 `convex/safety/` 之下的一切。見 `docs/dynamic-safety-filtering.md` | ART-115, ART-121, ART-122 |

### 3.4 Epic Q — Dynamic Viewing Operations

| Requirement | Disposition | Task | Delivery State | Release Criticality | Dependencies |
|---|---|---|---|---|---|
| FR-Q001 Dynamic View 可觀測性 | New | ART-133 | **Done**（11 項指標中 7 項實測、4 項明示未量測並指派擁有者，理由見下方註） | P0 | ART-115, ART-116 |
| FR-Q002 管理者動態觀看控制 | New | ART-134 | To Do | P1 | ART-133 |
| FR-Q003 Incremental Public Projection | **Carry Forward** | **ART-100**（既有） | To Do | P1 | ART-115 |
| FR-Q004 Dynamic View 無障礙交付（實現 NFR2-006） | New | ART-135 | To Do | P0 | ART-126, ART-120 |
| FR-Q005 效能基準與品質分級（實現 NFR2-002） | New | ART-136 | To Do | P0 | ART-119, ART-120 |
| FR-Q006 Dynamic Live 驗證套件（實現 §21.3） | New | ART-137 | **Done** | P0 | Playwright,Chromium,desktop（1440×900）與 mobile（Pixel 5,含 touch 與 device scale）兩個 project 跑同一份 spec,20 個測試全綠;CI 新增獨立 `browser-e2e` job,失敗時上傳 trace。本套件同時補上兩個既有任務自陳未涵蓋的缺口:ART-126 與 ART-130 各自把 DOM 與樣式表能定案的部分都斷言了,並明確記錄「真實引擎的實際排版／真實往返導覽」未涵蓋,因為當時 repo 內沒有 headless browser。**只替換 transport**:`VITE_E2E_FIXTURE=1` 把 `ConvexClientProvider` 的 client 換成 `src/e2e/fixtureConvexClient.ts`,其餘元件、hook、view model、相機與 renderer 全是出貨的那一份——這正是瀏覽器證據的意義。不能拿線上部署當 fixture:角色在上一個被接受的 slot 把他們放到的位置、replay 可能存在也可能不存在、安全閘門可能剛好把 spec 要斷言的那個場景 withhold 掉,對著它寫的套件不是 flaky 就是斷言不到足以攔截回歸的具體事實。**封裝**由 `fixtureIsolation.test.ts` 以結構釘住四件事(測試 harness 上線會比本套件想攔的任何缺陷都嚴重):`src/e2e/` 只有一個檔案 import、該 import 位於 gate 的 true 分支內、gate 是對**建置期 env 字面值**的精確比對(若改成檢查 `window` 或 `location` 便無法常數摺疊,分支會殘留進 production bundle)、且只有 `build:e2e` 設這個旗標並寫進自己的 `--outDir`。**fixture 必須是真的 payload 而非看起來合理的 payload**:`fixtureWorld.test.ts` 讓每個 payload 通過**production 的** `assertPublicDynamicProjection`／`assertVisualReplay`——伺服器讀回已儲存 payload 時用的同一個斷言。這個測試存在的理由很具體:replay fixture 的第一版自創了 `{ motions, summaryRef }`,沒有任何東西拒絕它、也沒有任何東西播得動它,於是 replay 靜默地從未啟動,三條瀏覽器驗收條件以「看起來像產品缺陷」的方式失敗;它抓到的第二件事是 `participantCharacterIds` 必須排序。兩者同一類錯誤,現在都不可能在不先讓快速單元測試變紅的情況下重新引入。該檔並釘住 ART-107 §8 的 fixture 規則:角色 id 全部來自 `MISTWOOD_CHARACTER_VISUALS`、地點 id 全部來自 `mistwoodLocationFootprints`,以斷言而非信任。**驗收條件以「觀看者如何判定」而非以像素判定**:地圖是 `<canvas>`,對 DOM 與輔助技術都不透明——這不是要繞過的障礙,而正是 ART-113 把所有互動放在 canvas 旁的 DOM 而非 Pixi hit test 的原因。故 AC#2 以「每個已發布角色都有一個具名聚焦控制項(12 個)」＋ canvas 截圖非單一色判定;AC#4 以四個帶不同 `animationState` 的角色其角色卡讀數必須四者互異判定,**以文字**,因此盲人觀看者拿到的也是同一份證據(對 Pixi 指示符做像素比對只會證明一件盲人用不到的事);AC#8 以**實際排版量測**判定(Pixel 5 上堆疊且地圖在前、桌面上並排、無水平溢位、每個 `.public-tap` 實際佈局後 ≥44px)。**兩個刻意的界線,明說而非暗示**:AC#3 證明的是「動態進行中 canvas 連續變化」(這是內插行走與瞬移的差別),**不**指認是哪些像素在動;AC#9 **不**等 playback 自然結束——依契約單一場景是 20–60 秒(`REPLAY_SCENE_MIN_MS`),等它等於每次跑都花四十秒去重證 `advanceReplay` 這個純函式(`replayPlayback.test.ts` 已窮舉覆蓋),瀏覽器真正補上的是「自動播放確實觸發」「跳過後回到 ambient」「不會自己再播一次」,這三件純測試都證不了。**AC#10／#11 刻意雙重觀測**:只由「被替換掉的那個東西」自我檢查的保證不是保證。fixture transport 對任何非 query 呼叫**記錄並 throw**,故 mutation 在被嘗試的當下就讓整個 run 失敗;spec **另外**監看瀏覽器自身的網路層,那是 client 無法影響的機制——裸 `fetch` 或在任何地方另建一個 client 都只會在那裡現形。E2E build 因此也把 `VITE_CLERK_PUBLISHABLE_KEY` 設空:帶 key 時 bundle 會載入 `clerk.com`,第三方請求會讓「這個頁面沒有跟任何東西講話」變成無法斷言;這不是 workaround——公開觀看者看世界本來就沒有理由聯絡 auth provider,空 key 正是尚未啟用營運者認證的部署的出貨行為。**三個值得記住的失敗**(各花了實際時間,現在都有防護):(1) `page.goto('/live/mistwood')` 會丟掉部署前綴——Playwright 以 `new URL` 解析 goto 參數,絕對路徑會捨棄 baseURL 的 path 區段,於是每個測試都 404 並回報「找不到 `<main>`」,症狀與成因毫不相像;現在 `baseURL` 只帶 origin,前綴由 spec 明帶。(2) replay 自動播放蓋過其他測試——每個測試都是全新 context,故 once-per-tab 標記未被消耗,前幾秒跑在**重播**影格上;而 playback 期間頁面會以 replay 的 motions 取代 live 的,不在當前重播場景中的角色因此沒有 motion、卡片讀作「—」,使 AC#4 四個狀態中有兩個相同,看起來像產品缺陷。`openLive` 現在改為**跳過**重播,那是產品本來就提供的真實觀看者動作(FR-O013 AC#8)。(3) `nth(0..3)` 取到的是任意四個居民——鏡頭控制有自己的排序;AC#4 改為**依角色 id** 選取,並由 `fixtureWorld.test.ts` 釘住是哪四個帶那四個狀態。**未涵蓋**:效能與裝置品質分級(ART-136,本任務明列 Out of Scope);安全探測(ART-128);以及 AC#2 第二子句的「公開驗收環境十二位角色」——那是關於真實部署的主張,本套件證明的是「當 projection 發布十二位時介面確實提供十二位」,即 fixture 能誠實建立的那一半,部署端的檢查屬於 ART-138 發布關卡。見 `docs/dynamic-view-e2e.md` | ART-126, ART-121 |
| FR-Q007 動態分析事件（實現 §17） | New | ART-140 | To Do | P1 | ART-118, ART-121 |
| FR-Q008 Dynamic MVP Release Gate（實現 §22） | New | ART-138 | To Do | P0 | ART-99, ART-141（ART-139 已完成）＋ 全部 P0 |

> **FR-Q001 的 4 項延後與其理由（ART-133）：** FR-Q001 列舉 11 項指標，其中 5 項於伺服器端實測（Runtime Projection 更新延遲、Snapshot 年齡、Canon／Runtime Location Mismatch、Missing Character Binding、Missing Location Binding），2 項為**結構性零值**（Public Mutation Attempt、Viewer-triggered LLM Call Count；由 ART-128 的公開函式面政策迭代證明，非計數器），其餘 4 項**明示標示為未量測並指派擁有者**，而非以永久 `0` 充數——儀表板上「永久 0」與「健康的量測值 0」無法區分，會誤導維運判讀（PRD FR-Q007 明文允許標示「未量測」而非估算）。(1) **Active Viewer 數量**與 (2) **Renderer Error Rate** 標為 `client_external`，因兩者皆需瀏覽器**寫入**回報，而 `architecture/module-boundaries.json` 的 `readOnlyClientBoundary` 與 ART-128 的安全套件正是禁止此路徑；登記擁有者為 **ART-136**／**ART-137**，實際收集機制預期落在 FR-Q007／ART-140 的分析事件管線而非 Convex 寫入路徑。(3) **降級模式使用率**（**ART-127**／FR-O010，仍 To Do）與 (4) **Replay 播放次數與跳過率**（**ART-121**／FR-O013）標為 `pending_feature`，於本節記錄當時被量測的功能尚不存在，故僅登記 registry 項目，不建欄位、不建計數器（沿用 `PUBLIC_MOTION_TYPES` 預留 `'replay'` 的既有慣例）。**現況更新**：FR-O013 已於 ART-121 完成並可產生重播，但播放／跳過率的**量測**本身仍是 ART-133 的 registry 項目尚未實作——ART-121 的任務邊界明文排除「Replay play/skip-rate metrics」（見 `docs/visual-replay.md`），故 (4) 仍為 `pending_feature` 直到 ART-133 或其後續補上實際收集機制。另 AC#3 的「記錄」半邊：匿名拒絕**刻意不做持久化**，因 Convex mutation 為交易式、寫在拋出路徑上的資料列會被同一個拋出回滾，且未認證呼叫端可逐次寫入即構成儲存耗盡向量；改以 `anonymousDenialsDurable: null` ＋ 明文 reason 讓限制可見，並實測既有 `outcome: 'refused'` 稽核列數。詳見 `docs/dynamic-view-observability.md`。

> **FR-Q004 ~ FR-Q008 的存在理由：** 先前版本讓 ART-135~138、140 直接掛在 NFR、§17、§21.3、§22 之下，違反「新工作納入 FR-N／O／P／Q Requirement Family」的規則，也讓非功能需求缺少可反向追蹤的 Requirement ID。新增這五條 Cross-cutting Delivery Requirement 後，每個新 Task 都有 FR 級擁有者。

### 3.5 非功能需求（NFR2-001 ~ NFR2-008）

先前版本只列 NFR2-002 與 NFR2-006，其餘六條僅散落於 Task 與 Release Gate，無法反向追蹤，使「所有 V2 P0 Requirement 都有 Task」的宣告不完整。本節補齊，**不建立新 Task**——這些需求由既有 V2 Task 共同實現。

| Requirement | Disposition | 實現 Task | Delivery State | Release Criticality |
|---|---|---|---|---|
| NFR2-001 公開零副作用 | New (realized by V2 tasks) | ART-112, ART-113, ART-114, ART-128, ART-137 | To Do | P0 |
| NFR2-002 效能 | New | **ART-136**（＝FR-Q005） | To Do | P0 |
| NFR2-003 可用性 | New (realized by V2 tasks) | ART-116, ART-127, ART-137 | To Do | P0 |
| NFR2-004 一致性 | New (realized by V2 tasks) | ART-115, ART-117, ART-133 | To Do | P0 |
| NFR2-005 安全 | New (realized by V2 tasks) | ART-115, ART-128, ART-132 | To Do | P0 |
| NFR2-006 Accessibility | New | **ART-135**（＝FR-Q004） | To Do | P0 |
| NFR2-007 可測試性 | New (realized by V2 tasks) | ART-114, ART-115, ART-120, ART-121, ART-137 | To Do | P0 |
| NFR2-008 可維護性 | New (realized by V2 tasks) | ART-112, ART-113, ART-114, ART-115 | To Do | P0 |

> NFR2-008 的執行機制是 `architecture/module-boundaries.json` 註冊（ART-114 AC），`npm run check` 會執行 `check:architecture`。

### 3.6 基線缺陷

| 項目 | Disposition | Task | Delivery State | Release Criticality |
|---|---|---|---|---|
| 種子世界每日 Canon Snapshot 失敗 | **Carry Forward** | **ART-99**（既有，Medium → Critical） | To Do | **Release Blocker** |
| PRD 1.0 FR-C002 真實 provider 場景解析失敗（schemaVersion／sceneId 契約層） | **Existing Baseline Defect**（§13.2 唯一獲准例外） | **ART-139** | **Done**（已對真實 provider 現場驗證） | **Release Blocker**（已解除） |
| PRD 1.0 FR-C002 真實 provider `proposedEvents` 結構不合規（同一缺陷的第二層，ART-139 驗證時發現） | **Existing Baseline Defect**（ART-139 的延伸，非獨立例外） | **ART-141** | To Do | **Release Blocker** |

---

## 4. ART-139 的依賴關係與證據

### 4.1 依賴必須區分實作與驗收

先前版本宣稱 ART-139 阻斷 FR-O002／§22.6，但 ART-119 的依賴只有 ART-118、ART-117，自相矛盾。正確處置是**區分兩種完成度**，而非加一條硬依賴（加硬依賴會讓 ART-119 無法用 fixture 平行開發）：

```text
ART-119 implementation
  依賴：ART-118 ＋ ART-117
  可用 Deterministic Fixture 開發與單元測試

ART-119 production acceptance
  依賴：ART-139 必須完成
  必須以真實 Provider 產生的 Accepted Event 驗證跨地點移動
```

此區分已寫入 ART-119 的驗收條件，且 ART-138 Release Gate 直接依賴 ART-99、ART-139、ART-141。ART-139 完成後，FR-O002 production acceptance 與 §22.6／§22.29 的剩餘阻斷者改為 **ART-141**（見 4.3），不再是 ART-139。

### 4.2 證據（schemaVersion／sceneId 契約層 — 已由 ART-139 確認並修復）

Requirement Matrix 不應只放未附證據的診斷結論。ART-139 的既有證據：

| 項目 | 內容 |
|---|---|
| 發現時機 | ART-106 真實 provider 煙霧測試期間 |
| 證據文件 | `backlog/tasks/art-106 - Generate-scene-narration-in-Traditional-Chinese.md` — Implementation Notes 與 Final Summary 均記錄此缺陷 |
| 發現時的 commit | `972696f` feat(ART-106): generate scene narration in Traditional Chinese |
| 缺陷引入的 commit | `35411d3` feat: add whole-scene simulation |
| Provider | `LLM_API_URL=https://llm.shouri.app/v1`，`LLM_MODEL=auto` |
| 觀察到的錯誤 | `SCENE_OUTPUT_INVALID` — `unsupported schema version` |
| 相關程式位置 | `convex/simulation/sceneSimulation.ts:110`（schemaVersion 檢查）、`:93-105`（`parseEventLinked` 白名單）、`:145-156`（`WHOLE_SCENE_JSON_SCHEMA` 巢狀 items） |
| 診斷 | Schema 將巢狀集合宣告為 `items: { type: 'object' }`，不約束欄位名；parser 以 `record(item, path, allowed)` 嚴格拒絕未知欄位。Schema 無法使 provider 產出 parser 要求的形狀；`schemaVersion` 檢查又遮蔽真正的欄位錯誤 |

**根因狀態更新：已確認，不再是假說。** ART-139 建立了永久回歸測試（`convex/simulation/sceneSimulation.test.ts`「ART-139 real-provider schemaVersion contract」describe block），並以臨時 `internalAction`（同 ART-106 模式，驗證後已刪除）對真實 provider 現場執行確認：真正的缺陷不是 schema 將 `schemaVersion` 型別鬆化為字串，而是真實 provider 會**完全省略** `schemaVersion` 與 `sceneId`（兩者的值對呼叫端而言是已知常數／輸入回顯，並非模型生成內容）。修復：`WHOLE_SCENE_JSON_SCHEMA` 的巢狀集合（`keyActions`、`dialogueHighlights`、`relationshipChanges`、`knowledgeChanges`、`memories`、`rumors`、`proposedEvents`）補上完整 `properties`／`required`／`additionalProperties:false`；`schemaVersion`／`sceneId` 缺漏時以呼叫端已知的值補齊，其餘不符仍嚴格拒絕並回報精確欄位路徑。已對真實 provider 驗證：root 層級欄位（含 `schemaVersion`、`sceneId`）現在正確解析。

### 4.3 現場驗證時發現的第二層缺陷（ART-141）

修復 root 層級後，現場呼叫在 `proposedEvents` 停住：真實 provider 回傳的 `proposedEvents` 項目形狀為 `{ eventId, publicSummary, trigger }`，`ProposedEvent` 所需的 `schemaVersion`、`worldId`、`idempotencyKey`、`proposedBy`、`worldDay`、`timeSlot`、`eventType`、`participantIds`、`causedByEventIds`，尤其是**內容主體 `stateChanges`**全部缺漏。這些欄位是模型生成內容，不像 `schemaVersion`／`sceneId` 有安全的預設值可補。這是同一 FR-C002 缺陷的第二層，已建立 **ART-141**（依賴 ART-139）追蹤；FR-O002 production acceptance、§22.6、§22.29 現在由 ART-141 阻斷。

---

## 5. Closure Matrix 24 條延後需求 ↔ 23 個 To Do Task 對應

**兩者並非一對一。**

### 5.1 一個 Task 覆蓋多條需求

| Task | 覆蓋的 Closure Matrix 條目 |
|---|---|
| **ART-45** | §5.1 G11、UX-005、FR-J001、§19.1、RISK-002 |
| **ART-39** | §5.1 G10、FR-H004 |
| **ART-73** | NFR-007、§19.3 |
| **ART-59** | FR-M003、§16.3、RISK-005 |
| **ART-27** | FR-E004、RISK-003 |
| **ART-32** | FR-F006、RISK-002 |
| **ART-91** | FR-M004、RISK-005 |

### 5.2 一條需求由多個 Task 覆蓋

| Closure Matrix 條目 | 覆蓋的 Task |
|---|---|
| **FR-M002 世界品質指標** | ART-58、ART-88、ART-89、ART-90 |

### 5.3 有 Task 但不對應任何延後需求

| Task | 性質 |
|---|---|
| **ART-76** | P1 測試套件，隨 ART-28／45／46 落地 |
| **ART-99** | ART-98 期間發現的缺陷，非 PRD 1.0 延後需求 |
| **ART-100** | 收尾後提出的效能改善，PRD 2.0 指派承接 FR-Q003 |

### 5.4 有需求但不需要 Task

| 條目 | 原因 |
|---|---|
| §5.2 產品驗證假設 | 需真實流量，非程式閘門 |
| §16.1 產品成功指標 | 上線後量測 |
| FR-H005 劇透控制（P2） | ART-70 **已 Done**，功能性 UI 為 P2 |
| NFR-002 效能實測值 | 需部署後量測；結構性部分 ART-40／41 已 Done |

### 5.5 結論

7 個 Task 各覆蓋多條需求；1 條需求由 4 個 Task 覆蓋；3 個 Task 不源自延後需求；4 條條目不需 Task。**不得假設「補完 23 個 Task 即等於清空 24 條延後需求」。**

---

## 6. PRD 1.0 直接重用的能力（不得重做）

| 能力 | 位置 | PRD 2.0 用途 |
|---|---|---|
| Mistwood 世界種子（12 角色／8 地點） | `convex/canon/mistwoodSeed.ts` | FR-N004／N005 綁定來源 |
| Canon 事件存儲與驗證 | `convex/canon/commit.ts`, `validators.ts`, `continuity.ts` | 唯一語意權威 |
| Deterministic Reducer／Replay／Snapshot | `convex/canon/reducer.ts`, `replay.ts`, `snapshotManager.ts` | FR-N007 概念基礎；ART-99 修復對象 |
| 地點投影 | `convex/canon/locationProjection.ts` | FR-N006 語意位置來源 |
| 位置變更事件 | `character_location_changed`（含 `fromLocationId`／`toLocationId`） | ART-114 軌跡規劃輸入 |
| 決定性抵達產生器 | `convex/simulation/worldDayLive.ts` `withArrivalStateChanges` | ART-117 同步來源（非 LLM 產出） |
| 世界排程（5 時段／日） | `convex/simulation/scheduler.ts` | §9.1 混合動態模型前提，**不得加速** |
| Live 公開投影 | `convex/publicRead/liveState.ts` | FR-N003 的**擴充基礎** |
| 公開讀模型基礎設施 | `convex/publicRead/readModel.ts` | 失敗隔離與零生成保證 |
| Episode／Recap／Arc 投影 | `convex/publicRead/episode*`, `arcPrimer.ts` | FR-O007／FR-P002 內容 |
| 內容安全與發布狀態 | `convex/safety/` | FR-O004／FR-P004 公開文字閘門 |
| Operator 授權與稽核 | `convex/operations/operatorAuthorization.ts` | FR-Q002 重用 |
| 可觀測性 | `convex/observability/` | FR-Q001 重用 |
| 無障礙基線 | ART-93（Done） | FR-Q004 延伸基礎 |

## 7. 直接重用的前端元件

| 元件／資產 | 處置 |
|---|---|
| PixiJS Renderer、PixiViewport、Tilemap Renderer、Character Sprite Renderer | **保留並抽取為只讀版本**（ART-113） |
| Idle／Walking／Speaking／Thinking 動畫定義 | 保留（ART-119） |
| `data/spritesheets/f1–f8`（8 款） | 保留 ＋ Palette Variant 擴充至 12（ART-111） |
| `assets/gentle-obj.png` tileset | 保留，用於重排 Mistwood 地圖（ART-109） |
| `data/gentle.js` 通用地圖 | **不用於公開頁面**，由 `data/mistwood.ts` 取代 |
| 碰撞資料格式、pathfinding 工具 | 抽取至 Visual Runtime（ART-114） |
| `src/components/public/*.tsx` 純文字頁面 | 動態版成為預設（ART-118／129）；既有文字 LiveView 保留為非地圖 Accessibility Fallback（ART-113），由 ART-135 完成正式無障礙整合；Episode 類頁面保留 |

## 8. 停用的 a16z 引擎能力（ART-112）

```text
convex/aiTown/ 世界執行生命週期
convex/agent/ Agent 推理
aiTown/main:runStep
heartbeat 啟動／維持模擬
Human Player
joinWorld / moveTo / sendWorldInput
chat / interact
cron: restart dead worlds
cron: stop inactive worlds
```

停用理由：該引擎自行產生對話與記憶，構成第二個敘事來源，違反 PRD 2.0 §10.5「Canon 是語意事實唯一權威」，且與觀看人數無關地持續消耗 LLM 成本。

ART-112 同時負責移除公開面的 Human Player／Interact 語意與相關文案——這本來就是引擎停用與只讀 Renderer 的一部分，不另立 Task。

## 9. 需要擴充的資料模型

| 資料模型 | 性質 | 擁有 Task |
|---|---|---|
| `CharacterVisualBinding` | 新增（`paletteVariant`／`nameplate`／`portraitFrame`／`displayName`／`locale`） | ART-111 |
| `LocationVisualBinding` | 新增（`zonePolygon`／`entryAnchors`／`ambientAnchors`／`sceneFocusPoint`） | ART-110 |
| `PublicCharacterMotion` | 新增（`motionType`／`motionSequence`／插值時間戳） | ART-115 |
| `PublicRuntimeSnapshot` | 新增 | ART-116 |
| `RuntimeSyncRecord` | 新增 | ART-117 |
| `ActiveScenePresentation` | 新增 | ART-122 |
| `VisualReplay` | 新增（衍生，**只引用**已發布內容識別碼） | ART-121 |
| `liveState` 投影 | **擴充既有**，非重建 | ART-115 |

---

## 10. Canon／Visual Binding／Visual Runtime 三方責任

先前版本寫「Zone 邊界由 Canon 決定」是**錯的**——那會讓 Canon Domain 開始持有地圖 Polygon，破壞語意與視覺的分離，並使 Canon 依賴地圖版本。正確歸屬為三方：

| 資料 | Owner |
|---|---|
| 角色目前的 `locationId` | **Canon** |
| 角色是否存活／參與事件 | **Canon** |
| Accepted Event、Arc、Episode | **Canon** |
| `locationId → zonePolygon／anchors／mapId` | **Visual Binding** |
| `characterId → spriteKey／paletteVariant／nameplate／displayName／locale` | **Visual Binding** |
| 角色 x／y、路徑、速度、插值 | **Visual Runtime** |
| 動畫狀態與方向 | **Visual Runtime** |
| Zone 內的 Ambient 位置 | **Visual Runtime** |
| 是否抵達 Polygon | **Visual Runtime** 依 Visual Binding 幾何判定 |
| 相機位置 | **客戶端** View State |

**不可違反：**

- Canon 不持有任何地圖幾何。
- Visual Runtime 不建立 Canon 事實、不為修正畫面修改 Canon、不每幀回寫座標。
- **抵達判定不新增或修改 Canon Event**，只推進 Runtime Movement Phase 與公開投影顯示狀態。

---

## 11. Replay 與即時狀態如何區分

| 機制 | 實作 | 擁有 Task |
|---|---|---|
| 資料層 | `PublicCharacterMotion.motionType` ∈ `canon` \| `ambient` \| `idle` \| `replay` | ART-115 |
| 畫面層 | 持續顯示「重播｜今日 11:00」「稍早｜…」「現在｜…」，不只依賴顏色 | ART-121 |
| 行為層 | 每 Session 最多自動播放一次；可跳過；不循環；可手動觸發 | ART-121 |
| 視覺層 | Ambient 與 Canon-driven 移動視覺可區分 | ART-120 |
| 風險登錄 | RISK2-008、RISK2-009 | PRD 2.0 §23 |

### 11.1 Replay 公開內容追蹤（review 修正）

先前 `VisualReplay.steps` 直接保存自由文字（`text`、`title`、`summary`），僅以 `sourceEventIds` 佐證。這**不足以證明畫面上顯示的是安全版本**——同一 Accepted Event 的公開摘要可能被 Withhold 或 Supersede，內嵌副本會讓已撤下的內容透過重播外洩，違反 FR-P004。

改為引用式：

```ts
{ type: "dialogue";  characterId: string; publicExcerptId: string; publicationVersion: number }
{ type: "eventCard"; publicSummaryId: string; publicationVersion: number }
```

| 規則 | 擁有 Task |
|---|---|
| Replay 不保存自由文字副本，只引用識別碼＋版本 | ART-121 |
| 來源被 Withhold／Supersede 時 Replay 同步失效或重新建構 | ART-132（ART-121 只負責引用式 Schema 與播放，不負責偵測與失效） |

---

## 12. 如何證明公開觀看不觸發 LLM 或 Canon 寫入

六層獨立證據，任一層失效其他層仍成立：

| 層級 | 證據 | 擁有 Task |
|---|---|---|
| **結構層** | a16z 引擎停用，heartbeat／Human Player／world input 路徑不存在 | ART-112 |
| **客戶端層** | 只讀元件樹不含 mutation；模組邊界測試禁止 import 寫入模組 | ART-113 |
| **模組層** | Visual Runtime 模組圖不含 provider import、不含 Canon 寫入路徑 | ART-114 |
| **伺服器層** | 公開 API 拒絕角色控制 payload；偽造識別碼被拒；UI 隱藏非唯一防線 | ART-128 |
| **運行層** | E2E 期間網路請求不含未授權 mutation，LLM call count 不增加 | ART-137 |
| **營運層** | Viewer-triggered LLM Call Count 必須為 0；Public Mutation Attempt 被拒並記錄 | ART-133 |

---

## 13. 如何避免建立重複 Task

1. **建立前完整盤點** — 讀取 closure matrix 全文與 23 個 To Do Task，建立 §5 的非一對一對應表。
2. **明確承接而非重建** — FR-Q003 指派給既有 **ART-100**。
3. **明確並存而非合併** — FR-O010（Renderer 降級）與 **ART-91**（模型中斷降級）是不同故障域，PRD §13 明文要求並存。
4. **明確分離而非吸收** — FR-Q004（動態層 a11y）不吸收 **ART-94**（圖表／時間軸 a11y）。
5. **擴充而非重建** — FR-N003 明確定義為擴充 `liveState.ts`。
6. **重用而非新建授權** — FR-Q002 重用 `operatorAuthorization.ts`。
7. **合併重複範圍** — 原 ART-141（公開登入語意）與 ART-112 的引擎停用範圍重疊，**已合併入 ART-112／ART-113 並封存**，不留重複 PR。
8. **分析事件不重建平台** — ART-140 只發出 §17 事件，平台仍由既有 **ART-47** 承接。
9. **23 個既有 Task ID 全數保留** — 無任何一個被關閉、取代或以新 ID 重建。
10. **新 Task 全部標註 Requirement ID** — ART-107 ~ ART-140 描述首行即為對應 Requirement ID，可反向查重。

**驗證：** 唯一新 Task 34 個（ART-107 ~ ART-140），既有 23 個 Task 全部維持原 ID 與原優先級（ART-99 除外，提升為 Critical）。重複建立數 = **0**。

### 13.1 §22 驗收標準覆蓋檢查（31 條）

| §22 條目 | 擁有 Task |
|---|---|
| 1 PRD 1.0 P0 無回歸 | ART-138 |
| 2 ART-99 修復 | ART-99 |
| 3 /live 可操作地圖 | ART-118 |
| 4 12 位角色綁定 | ART-111 |
| 5 8 個地點綁定且語意相符 | ART-110, ART-109 |
| 6 平滑跨地點移動 | ART-119（production acceptance 需 ART-141；ART-139 schemaVersion／sceneId 契約層已修復） |
| 7 Idle／Walking／Speaking／Thinking | ART-119 |
| 8 Ambient 零 Canon 副作用 | ART-120 |
| 9 Replay 自動一次可手動、不呼叫 LLM | ART-121 |
| 10 重播／稍早／現在 | ART-121 |
| 11 Active Scene 地圖與 Overlay 同步 | ART-122, ART-125 |
| 12 公開角色卡 | ART-124 |
| 13 場景公開摘要 | ART-122 |
| 14 不送 Heartbeat | ART-112, ART-128 |
| 15 不建 Human Player | ART-112, ART-128 |
| 16 零成功 Mutation | ART-128 |
| 17 零 Viewer-triggered LLM | ART-128 |
| 18 投影不含私人資料 | ART-115 |
| 19 漂移可偵測 | ART-117, ART-133 |
| 20 中斷時用最後有效快照 | ART-116 |
| 21 降級且歷史可讀 | ART-127 |
| 22 桌面與行動 E2E | ART-137, ART-126 |
| 23 Reduced Motion 與非地圖檢視 | ART-135 |
| 24 素材授權完整 | ART-108 |
| 25 公開授權稽核通過 | ART-128 |
| 26 Typecheck／Lint／Tests／Build／CI | 全 Task DoD |
| 27 全部 V2 P0 有 Task 與證據 | ART-138 |
| 28 Closure Matrix 不再以後端完成宣稱產品完成 | ART-138 |
| **29 真實 provider 產生 Accepted Event** | ART-139（schemaVersion／sceneId 契約層，Done）＋ ART-141（proposedEvents 結構合規，To Do） |
| **30 效能固定 Benchmark 公開前通過** | ART-136 |
| **31 Replay 只引用已發布內容識別碼與版本** | ART-121, ART-132 |

**31/31 全部有擁有者。**

---

## 14. 尚未解決的風險與阻斷項目

| 項目 | 類型 | 說明 | 處置 |
|---|---|---|---|
| **ART-99** | **Release Blocker** | `importWorld` 寫入的 `initial` 快照（`lastSequenceNumber: -1`）無法由 accepted events 推導，`assertSnapshotMatchesHistory` 以 `SNAPSHOT_CORRUPT` 拒絕。FR-N007 公開快照建立其上 | Critical；ART-138 依賴 |
| **ART-141** | **Release Blocker** | ART-139 修復並經真實 provider 現場驗證後，真實 provider 的 `proposedEvents` 項目仍不符合 `ProposedEvent` 契約（缺 `stateChanges` 等生成內容欄位），`simulateWholeScene()` 因而在真實 provider 下仍無法產出 Accepted Event，`withArrivalStateChanges` 不附加 `character_location_changed`，§22.6 無法達成（§4.3） | Critical；ART-138 依賴；依賴 ART-139（已完成） |
| **RISK2-008 / RISK2-009** | 產品風險 | Ambient 被誤認為劇情、Replay 被誤認為即時 | ART-120／ART-121 驗收條件緩解，上線後觀察 |
| **RISK2-004** | 技術風險 | 12+ 角色動畫 ＋ ambient ＋ 環境動畫在中階行動裝置的效能 | **ART-136 固定 Benchmark 必須在公開前通過**，不得以「上線後補」規避 |
| **地圖工作量未知** | 排程風險 | `data/mistwood.ts` 需以既有 tileset 手工重排八個地點 | ART-107 完成後重估 ART-109 |
| **Palette Variant 可行性** | 技術風險 | 需確認 f1–f8 調色盤是否支援只替換服裝／髮色範圍 | ART-107 稽核項目；不可行需回頭確認 PRD §24.23 |
| **§18.1 指標未量測** | 量測缺口 | FR-Q007（ART-140）完成前，點擊率與 Replay 完成率無法量測 | 相關指標一律標示「未量測」，不得以推估值宣稱達標 |

---

## 15. 第三輪 Review 修正紀錄

依據對 `main@9e84d08` 的 source-level review，修正以下五項實作缺口。**不新增 Task，不重寫整體架構**，僅調整以下既有 Task 的 Scope／AC／Dependencies。

| # | 問題 | 驗證方式 | 修正 Task |
|---|---|---|---|
| 1 | `liveState.ts` 只從 `character_location_changed`／`character_died`／`character_deactivated` 三種事件推導角色，Mistwood 12 位角色僅寫入 `worldCharacters`（含 `initialLocationId`），初始化時不產生位置事件 → 零事件世界無法保證 12 位角色出現於投影 | 讀 `convex/publicRead/liveState.ts:82-104` 與 `convex/canon/schema.ts:59-65` 確認 | **ART-114**（+1 AC：由 `worldCharacters` seed 產生初始靜態位置）／**ART-115**（+3 AC：投影含全部 seed 角色、Event 覆蓋 seed、零事件世界測試） |
| 2 | `convex/canon/mistwoodFixture.ts` 是另一套不相容的舊測試世界（Cassia／Rowan，`mistwood-market`／`mistwood-grove`），與正式 `mistwoodSeed.ts`（12 角色／8 地點）並存但無區分標記 | 讀 `mistwoodFixture.ts:6,50-51` 確認角色與地點 ID 確實不同 | **ART-107**（+3 AC：分類 Production Seed／Legacy Fixture／V2 Fixture；重新命名或重建 `mistwoodFixture.ts`；明文禁止 Production Acceptance 使用 Cassia／Rowan） |
| 3 | ART-121 與 ART-132 的 Replay 失效／重建驗收重疊，且 ART-132 原依賴不含 ART-121 | 讀兩個 Task 的 `dependencies` 欄位確認 | **ART-121**（移除失效／重建 AC，Scope 限定在 Schema／引用／播放）／**ART-132**（+ `ART-121` 依賴，統一擁有 Withhold／Supersede Invalidation） |
| 4 | `mistwoodSeed.ts` 的 `name` 欄位是羅馬拼音（`Lin Yingxue`），非繁體中文，ART-111 未定義公開顯示名稱來源 | 讀 `mistwoodSeed.ts:71` 確認 `name: 'Lin Yingxue'` | **ART-111**（+3 AC：新增 `displayName`／`locale` 欄位；地圖／角色卡／Episode／Arc 顯示名稱一致；內部 ID 與 seed name 維持穩定但不作為公開顯示） |
| 5 | `README.md` 仍將 `convex/aiTown/`、`convex/engine/` 標記為「(retained)」，與 §10.3 停用決策矛盾 | 讀 `README.md:55-70` 確認字面矛盾 | **ART-112**（+4 AC：明確列出 README／架構文件／部署文件／環境變數範例／cron 清單為 Documentation Impact 並須更新） |

**額外採納（P1，非缺口修正）：** ART-113 Scope 增加「保留既有文字版 Live View 作為 NFR2-006 非地圖 Fallback，直到 ART-135 完成正式替代」，使 ART-135 有現成基線可擴充，而非從零開始。

**未採納：** review 建議的 Task 對照表全部依實作，無需另建 Task；未發現需要調整 Requirement Matrix 整體結構（Disposition／Delivery State／Release Criticality 三軸模型、Canon／Visual Binding／Visual Runtime 三方責任、§22 覆蓋表）的理由。

**整體結構不變，但下列主表欄位已同步修正以符合上述 Task 變更**（第四輪 review 發現本節初版遺漏了這一步）：

- §3.3 FR-P004／ART-132 的 Dependencies 補上 ART-121。
- §9 `CharacterVisualBinding` 資料模型補上 `displayName`／`locale`。
- §10 Visual Binding 責任表的 `characterId →` 列補上 `displayName`／`locale`。
- §11.1 Replay Invalidation 的 Owner 由 `ART-121, ART-132` 更正為 `ART-132`（ART-121 只負責 Schema 與播放，不負責偵測與失效）；§22 #31 維持 `ART-121, ART-132` 不變，因為該條驗收同時涵蓋「引用式資料結構」與「發布狀態失效」兩件事。
- §7 前端元件重用表更正「純文字頁面由動態版取代」為「動態版成為預設，既有文字 LiveView 保留為 ART-135 的非地圖 Accessibility Fallback」，以符合 ART-113 的決定。
