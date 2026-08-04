# PRD 2.0 Requirement Matrix

**版本：** 1.0（初次盤點）
**來源文件：** `docs/prd-2.0.md`
**前一版基線：** `docs/prd-1.0-closure-matrix.md`
**盤點日期：** 2026-08-04
**狀態：** PRD 1.0 Core Simulation and Backend Baseline Complete；PRD 2.0 Dynamic Viewing MVP In Progress

---

## 1. 盤點結論摘要

| 項目 | 數量 |
|---|---:|
| PRD 2.0 新需求（FR-N／FR-O／FR-P／FR-Q／NFR2） | 32 |
| 標記為 **New**（需建立新 Task） | 30 |
| 標記為 **Carry Forward**（沿用既有 Task ID） | 2（FR-Q003→ART-100、FR-O010 相關降級→與 ART-91 分離但並存） |
| 標記為 **Existing**（PRD 1.0 已交付，直接重用） | 見 §4 |
| 標記為 **Superseded** | 0 |
| 標記為 **Blocked** | 1（ART-99 為 Release Blocker，非需求阻斷） |
| 新建立 Task | 32（ART-107 ~ ART-138） |
| 沿用既有 To Do Task | 23（未建立任何重複項） |
| 重複建立的 Task | **0** |

---

## 2. 需求對應表

狀態值：`Existing`（PRD 1.0 已交付可直接重用）／`New`（需新 Task）／`Carry Forward`（沿用既有 Task）／`Blocked`／`Superseded`。

### Epic N — Visual Foundation

| Requirement | 狀態 | New Task | Existing Task／證據 | Impact Areas | Dependencies |
|---|---|---|---|---|---|
| FR-N001 上游視覺能力稽核 | New | **ART-107** | — | 文件、視覺層 | — |
| FR-N002 Read-only Pixi World | New | **ART-113** | 重用 `src/components/` PixiJS 元件 | 前端、模組邊界 | ART-112, ART-109 |
| FR-N003 Public Dynamic Projection | New | **ART-115** | 擴充 `convex/publicRead/liveState.ts`（已有 `LiveCharacter{characterId, locationId, alive}`） | Schema、公開 API、安全 | ART-114 |
| FR-N004 Character Visual Binding（12 位） | New | **ART-111** | 重用 `data/spritesheets/f1–f8` | Schema、視覺層 | ART-107 |
| FR-N005 Location Visual Binding（8 個） | New | **ART-110** | 重用 `convex/canon/mistwoodSeed.ts` 的 8 個 location 與 `connectedLocationIds` | Schema、視覺層 | ART-109 |
| FR-N006 Canon／Runtime 同步 | New | **ART-117** | 重用 Accepted Event 與 `locationProjection` | Schema、Canon 邊界 | ART-115 |
| FR-N007 Runtime Snapshot | New | **ART-116** | 概念沿用 `canon/snapshotManager` 但為獨立公開快照 | Schema、公開 API | ART-115 |
| FR-N008 素材授權與 Attribution | New | **ART-108** | — | 合規、CI | ART-107 |
| FR-N009 Mistwood 專屬地圖 | New | **ART-109** | 重用 `assets/gentle-obj.png` tileset | 靜態資料、視覺層 | ART-107 |
| FR-N010 輕量 Visual Runtime | New | **ART-114** | 抽取 a16z pathfinding；取代其伺服器端引擎 | 新模組、Canon 邊界 | ART-110, ART-111 |
| §10.3 a16z 引擎停用 | New | **ART-112** | — | 後端、cron、安全 | ART-107 |

### Epic O — Dynamic Live Town

| Requirement | 狀態 | New Task | Existing Task／證據 | Impact Areas | Dependencies |
|---|---|---|---|---|---|
| FR-O001 動態 2D 地圖 | New | **ART-118** | 取代現有純文字 `src/components/public/LiveView.tsx` | 前端 | ART-113, ART-115 |
| FR-O002 Canon-driven 移動與動畫 | New | **ART-119** | 重用既有 Character sprite renderer | 前端 | ART-118, ART-117 |
| FR-O003 活躍場景視覺化 | New | **ART-122** | 重用 `liveState.activeScenes` | Schema、前端 | ART-118 |
| FR-O004 公開交談與活動提示 | New | **ART-123** | 重用 PRD 1.0 publication／safety 狀態 | 前端、安全 | ART-119 |
| FR-O005 鏡頭與導航 | New | **ART-118**（與 FR-O001 同一 PR） | 重用 PixiViewport | 前端 | ART-113, ART-115 |
| FR-O006 公開角色卡 | New | **ART-124** | 重用 `publicRead/worldCharacterProjection` | 前端、安全 | ART-118, ART-111 |
| FR-O007 Live Story Overlay | New | **ART-125** | 重用 `liveState`、`onboardingSummary`、`arcPrimer` | 前端 | ART-118 |
| FR-O008 響應式觀看體驗 | New | **ART-126** | — | 前端 | ART-125, ART-124 |
| FR-O009 公開只讀保證 | New | **ART-128** | 延續 PRD 1.0 ART-62 安全稽核方法 | 安全（最高） | ART-113, ART-115 |
| FR-O010 動態畫面降級 | New | **ART-127** | 與 ART-91（模型中斷降級）**並存不合併** | 前端、韌性 | ART-116, ART-118 |
| FR-O011 Ambient Movement | New | **ART-120** | — | 視覺 Runtime、Canon 邊界 | ART-114, ART-110 |
| FR-O012 Environmental Animation | New | **ART-120**（與 FR-O011 同一 PR） | — | 前端 | ART-114, ART-110 |
| FR-O013 Visual Replay | New | **ART-121** | 只使用既有 Accepted Event 與已發布摘要 | Schema、前端 | ART-119 |
| FR-O014 時間狀態標示 | New | **ART-121**（與 FR-O013 同一 PR） | — | 前端 | ART-119 |

### Epic P — Editorial Viewing Integration

| Requirement | 狀態 | New Task | Existing Task／證據 | Impact Areas | Dependencies |
|---|---|---|---|---|---|
| FR-P001 動態首頁入口 | New | **ART-129** | 取代現有純文字 `Homepage.tsx` | 前端 | ART-118, ART-111 |
| FR-P002 Live 與 Episode 連續性 | New | **ART-130** | 重用既有 Episode／Arc／Character 路由 | 前端 | ART-122, ART-124 |
| FR-P003 統一視覺系統 | New | **ART-131** | — | 前端、設計 | ART-125 |
| FR-P004 Publication 與 Safety 整合 | New | **ART-132** | 重用 PRD 1.0 post-generation safety 與 publication status | 安全（最高） | ART-115, ART-122 |

### Epic Q — Dynamic Viewing Operations

| Requirement | 狀態 | New Task | Existing Task／證據 | Impact Areas | Dependencies |
|---|---|---|---|---|---|
| FR-Q001 Dynamic View 可觀測性 | New | **ART-133** | 重用 `convex/observability/` | 可觀測性 | ART-115, ART-116 |
| FR-Q002 管理者動態觀看控制（P1） | New | **ART-134** | 重用 `convex/operations/operatorAuthorization.ts` | 管理、安全 | ART-133 |
| FR-Q003 Incremental Public Projection（P1） | **Carry Forward** | — | **ART-100**（既有 To Do，不建立新 Task） | 效能 | ART-115 |

### 非功能與交付閘門

| Requirement | 狀態 | New Task | Existing Task／證據 | Impact Areas | Dependencies |
|---|---|---|---|---|---|
| NFR2-006 Dynamic View 無障礙 | New | **ART-135** | 重用 ART-93（Done）；圖表／時間軸 a11y 仍由 ART-94 承接 | 前端、a11y | ART-126, ART-120 |
| NFR2-002 動態層效能 | New | **ART-136** | — | 效能 | ART-119, ART-120 |
| §21.3 Browser E2E 套件 | New | **ART-137** | — | 測試 | ART-126, ART-121 |
| §22 Release Gate | New | **ART-138** | 方法沿用 ART-63 closure matrix | 交付閘門 | ART-99 + 全部 P0 |
| §13.1 ART-99 Snapshot 修復 | **Blocked → P0** | — | **ART-99**（既有，優先級由 Medium 提升為 Critical） | Canon、快照 | — |

---

## 3. Closure Matrix 24 條延後需求 ↔ 23 個 To Do Task 對應

**兩者並非一對一。** 實際盤點如下。

### 3.1 一個 Task 覆蓋多條需求

| Task | 覆蓋的 Closure Matrix 條目 |
|---|---|
| **ART-45** | §5.1 G11（每日投票）、UX-005（觀眾影響環境）、FR-J001（投票機制）、§19.1（投票規則單元測試）、RISK-002（環境注入緩解） |
| **ART-39** | §5.1 G10（回訪快速跟上）、FR-H004（裝置感知回訪摘要） |
| **ART-73** | NFR-007（90 天模擬）、§19.3（長期模擬測試） |
| **ART-59** | FR-M003（Token／速率控制）、§16.3（資源指標）、RISK-005（配額緩解） |
| **ART-27** | FR-E004（長期記憶壓縮）、RISK-003（歷史壓縮緩解） |
| **ART-32** | FR-F006（Arc 熱度評分）、RISK-002（無聊世界緩解） |
| **ART-91** | FR-M004（降級模式）、RISK-005（配額緩解） |

### 3.2 一條需求由多個 Task 覆蓋

| Closure Matrix 條目 | 覆蓋的 Task |
|---|---|
| **FR-M002 世界品質指標** | ART-58、ART-88、ART-89、ART-90（四個 Task 共同覆蓋一條需求） |

### 3.3 有 Task 但不對應任何 Closure Matrix 延後需求

| Task | 性質 | 說明 |
|---|---|---|
| **ART-76** | P1 測試套件 | 謠言與觀眾介入整合測試，隨 ART-28／ART-45／ART-46 落地，非獨立 PRD 需求 |
| **ART-99** | **缺陷** | ART-98 期間發現的快照缺陷，非 PRD 1.0 延後需求。PRD 2.0 §13.1 提升為 P0 Release Blocker |
| **ART-100** | 效能改善 | 收尾後提出的增量投影改善，PRD 2.0 指派承接 FR-Q003 |

### 3.4 有需求但無 To Do Task（不需建立 Task）

| Closure Matrix 條目 | 原因 |
|---|---|
| §5.2 產品驗證假設 | 需真實流量與分析，非程式閘門；結構性前置條件已由 ART-47 承接 |
| §16.1 產品成功指標 | 上線後量測項目，非程式閘門 |
| FR-H005 劇透控制（P2） | ART-70 **已 Done**，交付 PRD 要求的資料相容性約束；功能性 UI 為 P2，PRD 1.0 明示「MVP 可不實作」 |
| NFR-002 效能實測值 | 需部署後量測；結構性部分 ART-40／ART-41 已 Done |

### 3.5 結論

- Closure Matrix 的 24 條延後需求 **不是** 23 個 Task 的一對一映射。
- 7 個 Task 各覆蓋多條需求；1 條需求（FR-M002）由 4 個 Task 覆蓋。
- 3 個 Task（ART-76／99／100）不源自 PRD 1.0 延後需求。
- 4 條 Closure Matrix 條目不需要 Task（量測型或已 Done）。
- **因此 PRD 2.0 不得假設「補完 23 個 Task 即等於清空 24 條延後需求」。**

---

## 4. PRD 1.0 直接重用的能力（不得重做）

| 能力 | 位置 | PRD 2.0 用途 |
|---|---|---|
| Mistwood 世界種子（12 角色／8 地點／組織／歷史） | `convex/canon/mistwoodSeed.ts` | FR-N004／N005 綁定來源；地點連通圖供地圖佈局 |
| Canon 事件存儲與驗證 | `convex/canon/commit.ts`, `validators.ts`, `continuity.ts` | 唯一語意權威；Visual Runtime 只讀 |
| Deterministic Reducer／Replay／Snapshot | `convex/canon/reducer.ts`, `replay.ts`, `snapshotManager.ts` | FR-N007 概念基礎；ART-99 修復對象 |
| 地點投影 | `convex/canon/locationProjection.ts` | FR-N006 語意位置來源 |
| 世界排程（5 時段／日） | `convex/simulation/scheduler.ts` | §9.1 混合動態模型的節奏前提，**不得加速** |
| Live 公開投影 | `convex/publicRead/liveState.ts`（已含 `LiveCharacter{characterId, locationId, alive}`、locations、activeScenes、activeArcs） | FR-N003 的**擴充基礎**，非重建 |
| 公開讀模型基礎設施 | `convex/publicRead/readModel.ts` | 失敗隔離與零生成保證 |
| Episode／Recap／Arc 投影 | `convex/publicRead/episode*`, `arcPrimer.ts`, `relationshipArcProjection.ts` | FR-O007 Overlay 與 FR-P002 導航內容 |
| 內容安全與發布狀態 | `convex/safety/` | FR-O004／FR-P004 公開文字閘門 |
| Operator 授權與稽核 | `convex/operations/operatorAuthorization.ts` | FR-Q002 重用，不另建授權機制 |
| 可觀測性 | `convex/observability/` | FR-Q001 重用 |
| 無障礙基線 | ART-93（Done） | NFR2-006 延伸基礎 |

## 5. 直接重用的前端元件

| 元件／資產 | 用途 | 處置 |
|---|---|---|
| PixiJS Renderer、PixiViewport、Tilemap Renderer、Character Sprite Renderer | 地圖與角色渲染 | **保留並抽取為只讀版本**（ART-113） |
| Idle／Walking／Speaking／Thinking 動畫定義 | 動畫狀態 | 保留（ART-119） |
| `data/spritesheets/f1–f8`（8 款） | 角色外觀 | 保留 + Palette Variant 擴充至 12（ART-111） |
| `assets/gentle-obj.png` tileset | 地圖磚組 | 保留，用於重排 Mistwood 地圖（ART-109） |
| `data/gentle.js` 通用地圖 | a16z 通用小鎮 | **不用於公開頁面**，由 `data/mistwood.ts` 取代 |
| 碰撞資料格式、pathfinding 工具 | 路徑規劃 | 抽取至 Visual Runtime（ART-114） |
| `src/components/public/*.tsx` 純文字頁面 | 現有公開頁 | 由動態版取代（ART-118／129），Episode 類頁面保留 |

## 6. 停用的 a16z 引擎能力（ART-112）

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

停用理由：該引擎會自行產生對話與記憶，構成第二個敘事來源，違反 PRD 2.0 §10.5「Canon 是語意事實唯一權威」，且與觀看人數無關地持續消耗 LLM 成本。

## 7. 需要擴充的資料模型

| 資料模型 | 性質 | 擁有 Task |
|---|---|---|
| `CharacterVisualBinding` | 新增（含 `paletteVariant`、`nameplate`、`portraitFrame`） | ART-111 |
| `LocationVisualBinding` | 新增（含 `zonePolygon`、`entryAnchors`、`ambientAnchors`、`sceneFocusPoint`） | ART-110 |
| `PublicCharacterMotion` | 新增（公開投影單元，含 `motionType`／`motionSequence`／插值時間戳） | ART-115 |
| `PublicRuntimeSnapshot` | 新增 | ART-116 |
| `RuntimeSyncRecord` | 新增 | ART-117 |
| `ActiveScenePresentation` | 新增 | ART-122 |
| `VisualReplay` | 新增（衍生，不入 Canon） | ART-121 |
| `liveState` 投影 | **擴充既有**，非重建 | ART-115 |

## 8. Canon 與 Visual Runtime 責任邊界

| 面向 | Canon | Visual Runtime |
|---|---|---|
| 角色語意位置（「在診所」） | ✅ 唯一權威 | ❌ 只讀 |
| 角色存活／參與事件 | ✅ | ❌ |
| Accepted Event／Arc／Episode | ✅ | ❌ |
| x／y 座標 | ❌ | ✅ |
| 路徑、速度、插值 | ❌ | ✅ |
| Sprite 動畫 Frame、方向 | ❌ | ✅ |
| 相機位置 | ❌ | ✅（純客戶端） |
| Zone 邊界 | ✅ 決定角色在哪個 Zone | ✅ 決定 Zone 內的位置 |
| Ambient 活動 | ❌ 不知情 | ✅ 決定性產生 |

**不可違反：** Visual Runtime 不得建立 Canon 事實；不得為修正畫面而修改 Canon；不得每幀回寫座標。

## 9. Replay 與即時狀態如何區分

| 機制 | 實作 | 擁有 Task |
|---|---|---|
| 資料層 | `PublicCharacterMotion.motionType` 為 `canon` \| `ambient` \| `idle` \| `replay` | ART-115 |
| 畫面層 | 持續顯示「重播｜今日 11:00」「稍早｜…」「現在｜…」三態標示，且不只依賴顏色 | ART-121 |
| 行為層 | 每個觀看 Session 最多自動播放一次；可隨時跳過；不得循環；可手動觸發 | ART-121 |
| 視覺層 | Ambient 與 Canon-driven 移動必須視覺可區分 | ART-120 |
| 風險登錄 | RISK2-008（Ambient 被誤認為劇情）、RISK2-009（Replay 被誤認為即時） | PRD 2.0 §23 |

## 10. 如何證明公開觀看不觸發 LLM 或 Canon 寫入

四層獨立證據，任一層失效其他層仍成立：

| 層級 | 證據 | 擁有 Task |
|---|---|---|
| **結構層** | a16z 引擎停用，heartbeat／Human Player／world input 路徑不存在 | ART-112 |
| **客戶端層** | 只讀元件樹不含任何 mutation；模組邊界測試禁止 import 寫入模組 | ART-113 |
| **模組層** | Visual Runtime 模組圖不含 provider import、不含 Canon 寫入路徑（測試斷言） | ART-114 |
| **伺服器層** | 公開 API 伺服器端拒絕所有角色控制 payload；偽造 characterId／worldId／runtimeSequence 被拒；UI 隱藏不是唯一防線 | ART-128 |
| **運行層** | E2E 執行期間網路請求不含未授權 mutation，LLM call count 不增加 | ART-137 |
| **營運層** | Viewer-triggered LLM Call Count 指標必須為 0；Public Mutation Attempt 被拒並記錄 | ART-133 |

## 11. 如何避免建立重複 Task

已採取的去重措施：

1. **建立前完整盤點** — 讀取 `docs/prd-1.0-closure-matrix.md` 全文與全部 23 個 To Do Task，建立 §3 的非一對一對應表。
2. **明確承接而非重建** — FR-Q003 指派給既有 **ART-100**，未建立新 Task。
3. **明確並存而非合併** — FR-O010（Renderer 降級）與 **ART-91**（模型中斷降級）是不同故障域，PRD 2.0 §13 明文要求「整合但不得合併刪除」，兩者並存。
4. **明確分離而非吸收** — NFR2-006 動態層無障礙（ART-135）不吸收 **ART-94**（圖表／時間軸 a11y），後者維持獨立。
5. **擴充而非重建** — FR-N003 明確定義為擴充既有 `convex/publicRead/liveState.ts`，該檔案已具備 `LiveCharacter{characterId, locationId, alive}`、locations、activeScenes、activeArcs。
6. **重用而非新建授權** — FR-Q002 明文重用 `operatorAuthorization.ts`，不建立第二套授權機制。
7. **23 個既有 Task ID 全數保留** — 無任何一個被關閉、取代或以新 ID 重建。
8. **新 Task 全部標註 Requirement ID** — ART-107 ~ ART-138 每個描述首行即為對應的 PRD 2.0 Requirement ID，可反向查重。

**驗證：** 新建 32 個 Task，既有 23 個 Task 全部維持原 ID 與原優先級（ART-99 除外，依 PRD 2.0 §13 提升為 Critical）。重複建立數 = **0**。

---

## 12. 尚未解決的風險與阻斷項目

| 項目 | 類型 | 說明 | 處置 |
|---|---|---|---|
| **ART-99** | **Release Blocker** | 種子世界每日 Canon Snapshot 失敗。`importWorld` 寫入的 `initial` 快照（`lastSequenceNumber: -1`）無法由 accepted events 推導，`assertSnapshotMatchesHistory` 以 `SNAPSHOT_CORRUPT` 拒絕。FR-N007 公開快照建立在此基礎上 | 已提升為 Critical；ART-138 Release Gate 依賴它 |
| **SCENE_OUTPUT_INVALID** | **未歸屬缺陷** | 真實 LLM provider 的 `simulateWholeScene()` 以「unsupported schema version」失敗；ART-106 期間發現，已知 `relationshipChanges` 欄位名與 parser 預期不符。**目前沒有任何 Task 擁有此缺陷** | 需建立 Task；不在 PRD 2.0 範圍內但影響真實內容產出 |
| **RISK2-008 / RISK2-009** | 產品風險 | Ambient 被誤認為劇情、Replay 被誤認為即時 | 由 ART-120／ART-121 的驗收條件緩解，需上線後觀察 |
| **RISK2-004** | 技術風險 | 12+ 角色動畫 + ambient + 環境動畫在中階行動裝置的效能 | ART-136 量測；若不達標需品質分級策略 |
| **地圖工作量未知** | 排程風險 | `data/mistwood.ts` 需以既有 tileset 手工重排八個地點，工作量取決於 tileset 表現力，ART-107 稽核後才能確認 | ART-107 完成後重估 ART-109 |
| **Palette Variant 可行性** | 技術風險 | 需確認 f1–f8 sprite 的調色盤結構是否支援只替換服裝／髮色範圍 | ART-107 稽核項目；若不可行需回頭與 PRD §24.23 決策確認替代方案 |
| **NFR2-002 實測值** | 量測 | 所有效能目標需真實部署後才能驗證 | ART-136 提供結構性證據，實測值上線後補 |
