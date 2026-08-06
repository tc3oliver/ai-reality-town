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
| FR-N003 Public Dynamic Projection | New | ART-115 | To Do | P0 | 擴充 `convex/publicRead/liveState.ts` | ART-114 |
| FR-N004 Character Visual Binding（12） | New | ART-111 | **Done** | P0 | 重用 `data/spritesheets/f1–f8`（共用 `public/assets/32x32folk.png`）；8 款原始 Sprite ＋ 4 組服裝／髮色 Palette Variant，Palette Range 由實際 PNG 量測並與 `PROTECTED_SKIN_WINDOW` 互斥；`convex/visual/`；見 `docs/character-visual-binding.md` | ART-107, ART-143 |
| FR-N005 Location Visual Binding（8） | New | ART-110 | To Do | P0 | 重用 `mistwoodSeed.ts` 8 locations ＋ `connectedLocationIds` | ART-109 |
| FR-N006 Canon／Runtime 同步 | New | ART-117 | To Do | P0 | 重用 `character_location_changed`（含 `fromLocationId`／`toLocationId`） | ART-115 |
| FR-N007 Runtime Snapshot | New | ART-116 | To Do | P0 | 概念沿用 `canon/snapshotManager`（獨立公開快照） | ART-115 |
| FR-N008 素材授權與 Attribution | New | ART-108, ART-143, ART-144 | ART-108 **Done**；ART-143 **Done**；ART-144 To Do | P0 | ART-143：f1–f8 角色美術 provenance 經 primary source 調查仍無法確認，H06 由 owner 決議接受 upstream MIT 授權並承擔殘餘風險，九個路徑轉為 approved 並納入 `PUBLIC_BUNDLE_PATHS`，ART-111 解除阻擋；ART-144：`PUBLIC_BUNDLE_PATHS` 與 vite 實際輸出不一致，16 個非 approved 素材已進入 `dist/` | ART-107 |
| FR-N009 Mistwood 專屬地圖 | New | ART-109 | Done | P0 | `data/mistwood.ts`：僅用既有 `assets/gentle-obj.png` tileset 重組出八個正典地點與 seed 道路圖（見 `docs/mistwood-tilemap.md`） | ART-107 |
| FR-N010 輕量 Visual Runtime | New | ART-114 | To Do | P0 | 抽取 a16z pathfinding | ART-110, ART-111 |
| §10.3 a16z 伺服器端引擎停用 | New | ART-112 | **Done**（ADR-0004，含 24 小時現場 log 觀察） | P0 | — | ART-107（Done） |

### 3.2 Epic O — Dynamic Live Town

| Requirement | Disposition | Task | Delivery State | Release Criticality | Dependencies |
|---|---|---|---|---|---|
| FR-O001 動態 2D 地圖 | New | ART-118 | To Do | P0 | ART-113, ART-115 |
| FR-O002 Canon-driven 移動與動畫 | New | ART-119 | **To Do；production validation blocked by ART-141**（ART-139 schemaVersion／sceneId 契約層已修復） | P0 | ART-118, ART-117 |
| FR-O003 活躍場景視覺化 | New | ART-122 | To Do | P0 | ART-118 |
| FR-O004 公開交談與活動提示 | New | ART-123 | To Do | P0 | ART-119 |
| FR-O005 鏡頭與導航 | New | ART-118（共用） | To Do | P0 | ART-113, ART-115 |
| FR-O006 公開角色卡 | New | ART-124 | To Do | P0 | ART-118, ART-111 |
| FR-O007 Live Story Overlay | New | ART-125 | To Do | P0 | ART-118 |
| FR-O008 響應式觀看體驗 | New | ART-126 | To Do | P0 | ART-125, ART-124 |
| FR-O009 公開只讀保證 | New | ART-128 | To Do | P0 | ART-113, ART-115 |
| FR-O010 動態畫面降級 | New | ART-127 | To Do | P0 | ART-116, ART-118 |
| FR-O011 Ambient Movement | New | ART-120 | To Do | P0 | ART-114, ART-110 |
| FR-O012 Environmental Animation | New | ART-120（共用） | To Do | P0 | ART-114, ART-110 |
| FR-O013 Visual Replay | New | ART-121 | To Do | P0 | ART-119 |
| FR-O014 時間狀態標示 | New | ART-121（共用） | To Do | P0 | ART-119 |

### 3.3 Epic P — Editorial Viewing Integration

| Requirement | Disposition | Task | Delivery State | Release Criticality | Dependencies |
|---|---|---|---|---|---|
| FR-P001 動態首頁入口 | New | ART-129 | To Do | P0 | ART-118, ART-111 |
| FR-P002 Live 與 Episode 連續性 | New | ART-130 | To Do | P0 | ART-122, ART-124 |
| FR-P003 統一視覺系統 | New | ART-131 | To Do | P0 | ART-125 |
| FR-P004 Publication 與 Safety 整合 | New | ART-132 | To Do | P0 | ART-115, ART-121, ART-122 |

### 3.4 Epic Q — Dynamic Viewing Operations

| Requirement | Disposition | Task | Delivery State | Release Criticality | Dependencies |
|---|---|---|---|---|---|
| FR-Q001 Dynamic View 可觀測性 | New | ART-133 | To Do | P0 | ART-115, ART-116 |
| FR-Q002 管理者動態觀看控制 | New | ART-134 | To Do | P1 | ART-133 |
| FR-Q003 Incremental Public Projection | **Carry Forward** | **ART-100**（既有） | To Do | P1 | ART-115 |
| FR-Q004 Dynamic View 無障礙交付（實現 NFR2-006） | New | ART-135 | To Do | P0 | ART-126, ART-120 |
| FR-Q005 效能基準與品質分級（實現 NFR2-002） | New | ART-136 | To Do | P0 | ART-119, ART-120 |
| FR-Q006 Dynamic Live 驗證套件（實現 §21.3） | New | ART-137 | To Do | P0 | ART-126, ART-121 |
| FR-Q007 動態分析事件（實現 §17） | New | ART-140 | To Do | P1 | ART-118, ART-121 |
| FR-Q008 Dynamic MVP Release Gate（實現 §22） | New | ART-138 | To Do | P0 | ART-99, ART-141（ART-139 已完成）＋ 全部 P0 |

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
