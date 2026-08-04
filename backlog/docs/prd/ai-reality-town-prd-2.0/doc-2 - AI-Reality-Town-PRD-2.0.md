---
id: doc-2
title: AI Reality Town PRD 2.0
type: specification
created_date: '2026-08-04 16:06'
updated_date: '2026-08-04 16:51'
---
# AI Reality Town 產品需求文件

**文件版本：** PRD 2.0
**產品名稱：** AI Reality Town
**初始世界代號：** Mistwood
**產品階段：** Dynamic Viewing MVP／公開測試準備
**文件用途：** 產品需求唯一來源、Backlog 重新盤點與拆解依據、驗收與需求追蹤基準
**適用 Repository：** tc3oliver/ai-reality-town
**目標讀者：** Product、Engineering、Design、QA、Operations、Content Safety

---

## 0. 文件地位與版本關係

### 0.1 PRD 2.0 的目的

PRD 1.0 已完成世界模擬、Canon、角色知識與記憶、Story Arc、Episode、公開 Read Model、管理、安全與稽核等核心能力，但公開產品體驗被實作成以文字頁面為主，未達到「觀看一個持續運作、角色會移動與互動的 AI 世界」的產品期待。

PRD 2.0 不推翻 PRD 1.0 的核心架構，而是：

- 將 PRD 1.0 已完成的 P0 能力列為 **Core Platform Baseline**。
- 將「不可操控、持續會動的 2D 世界觀看體驗」新增為產品 MVP 的必要條件。
- 明確定義 Canon 與 Visual Runtime 的責任邊界。
- 保留現有 23 個 To Do Task，不重複建立相同 Task。
- 將已知快照失敗 Bug ART-99 提升為公開上線阻斷項目。
- 重新定義「MVP 完成」：核心模擬完成不等於整體產品完成。

### 0.2 既有完成狀態

依 PRD 1.0 Closure Matrix：

| 類別 | 狀態 |
|---|---|
| PRD 1.0 P0 核心需求 | 96 條已完成並具驗證證據 |
| 延後需求 | Closure Matrix 記錄 24 條 P1/P2 |
| 現有 Backlog To Do | 23 個 Task |
| 非目標 | 17 條已確認未誤做 |
| PRD 1.0 未歸屬缺口 | 0 |
| PRD 1.0 未完成 P0 | 0 |

Closure Matrix 的 24 條延後需求與 Backlog 的 23 個 To Do Task **不視為一對一**。重新拆解前必須建立 Requirement-to-Task Mapping，確認是否存在一個 Task 覆蓋多條需求、需求已合併或 Task 已被其他工作取代。

實際盤點結果記錄於 `docs/prd-2.0-requirement-matrix.md`。

### 0.3 不得重做的基線能力

除非 PRD 2.0 新需求明確要求修改，以下能力不得重新設計或重建：

- 世界初始化與暖機
- 角色 Persona、目標、關係、知識與記憶
- 世界排程、Director、Intent、Scene Simulation
- Proposed Event、Canon Validation、Append-only Event Store
- Deterministic Reducer、Snapshot、Replay、Idempotency
- Story Arc Lifecycle、Episode、Recap、Current Situation
- Public Read Model
- Admin Console、Correction、Kill Switch
- Content Safety、Authorization Audit、LLM Trace

任何新 Task 若與既有完成 Task 重疊，必須引用既有 Task 與驗證證據，不得重新建立同義工作。

---

## 1. 產品摘要

AI Reality Town 是一個持續運作、不可由觀眾直接控制的 2D AI 虛構社會與互動式實境節目。

世界中的角色依據自己的個性、目標、記憶、認知、關係與環境採取行動，形成合作、戀愛、背叛、競爭、失蹤、犯罪、選舉、創業、謠言與其他長期事件。

觀眾主要透過兩種互補模式觀看世界：

**Live Town** — 觀看角色在 2D 小鎮地圖中移動、停留、碰面、交談、思考及參與場景。觀眾可以拖曳、縮放、切換焦點、點擊角色與場景，但不能控制角色。

**Episode／Story** — 閱讀已完成事件的每日 Episode、前情提要、Story Arc、角色資料、關係與時間線，理解正在發生什麼、為什麼重要以及接下來值得關注什麼。

AI Reality Town 不是純文字事件列表，也不是玩家可操控 NPC 的遊戲。產品核心是「世界自行運作，觀眾持續觀看」。

## 2. 產品願景

建立一個會自行累積歷史、角色會記得過去、決策具有長期後果，且觀眾能像觀看實境節目或連續劇一樣持續追蹤的 AI 世界。

理想體驗：

- 我打開 Live Town，看見記者從報社走向診所；右側顯示她正在追查失蹤帳本。
- 兩名角色碰面後開始交談，畫面顯示公開對話摘要；稍後這段互動成為今日 Episode 的重大轉折。
- 我一週沒看，回來後先看到三分鐘前情，再進入地圖追蹤目前最重要的場景。
- 觀眾投票選擇停電，但沒有指定角色行動；停電只改變環境，後續結果仍由角色與 Canon 規則決定。

## 3. 產品定位

### 3.1 對外定位

AI Reality Town **是**：

- 持續運作的 AI 虛構社會
- 可觀看但不可直接操控的 2D 動態世界
- 結合 Live Town、Episode、Story Arc 與角色追蹤的連續內容產品
- 具有不可變歷史、角色認知限制與長期因果的活世界
- 可由觀眾透過有限環境投票間接影響的實境節目

AI Reality Town **不是**：

- 純文字新聞網站
- 一般聊天機器人
- 單次 AI 角色扮演
- 讓玩家控制角色移動或結果的遊戲
- 高品質 3D 或電影級動畫產品
- 真實人物或真實社會預測系統
- 公開訪客每次瀏覽都觸發生成的即時 LLM Demo

### 3.2 核心產品承諾

- **對觀眾：** 你可以看見世界正在發生什麼，也能立即理解它為什麼重要。
- **對世界：** 已經發生的事情永遠算數；畫面不得與 Canon 相互矛盾。
- **對角色：** 角色自行行動，觀眾只能觀看、追蹤與有限地改變環境。
- **對公開系統：** 觀看不會觸發新的 LLM 工作，也不會改變世界狀態。

## 4. 問題定義

### 4.1 PRD 1.0 的產品缺口

PRD 1.0 已要求首頁、Live View、Episode、Character 與 Story Arc 頁面，但對 Live View 的要求可被「簡化地圖或地點列表」滿足，也未將角色移動、Sprite 動畫、只讀 Renderer 與 Canon／Runtime 同步列為必要驗收條件。

結果是：

- 核心模擬與後端已完成
- 公開頁面可閱讀且通過原有驗收
- 產品仍可能只呈現文字、清單與卡片
- AI Town 原有動態視覺能力沒有成為公開體驗的必要部分
- Closure Matrix 可以顯示 100%，但觀眾仍無法「看見世界活著」

### 4.2 觀眾端問題

純文字頁面無法充分傳達：

- 角色目前在哪裡
- 角色正在移動、等待、交談或參與什麼場景
- 哪個地點正在發生重大事件
- 不同角色與事件在同一個世界中的空間關係
- 世界正在持續運作，而不是每天產生一篇文字報告

### 4.3 技術問題

若直接將既有 AI Town Game 元件公開，可能產生：

- 觀眾 heartbeat 意外啟動或維持模擬
- 公開使用者送出 move、join、chat 或其他 write input
- 私人對話、記憶或 Runtime 資料被公開
- Canon 語意位置與 Runtime Sprite 座標不一致
- 每次瀏覽增加模型或模擬成本

因此需要獨立的 **Read-only Dynamic Viewing Layer**，而不是直接公開完整 Game Client。

### 4.4 世界節奏問題（PRD 2.0 新增）

Canon 的時間模型為 **1 世界日 = 1 真實日，每日 5 個時段**（`convex/simulation/scheduler.ts`：`REAL_DAY_MS = 86_400_000`、`PUBLIC_SLOT_START_MS = [0, 6, 11, 15, 19] 小時`）。

因此角色的語意位置一天最多變動 5 次。若畫面只呈現 Canon 驅動的移動，觀眾在多數時間會看到完全靜止的世界。

PRD 2.0 的解法是 **混合動態模型**（§9.1），在不加快 Canon 世界時鐘、不增加 LLM 成本的前提下讓畫面持續有生命感。

---

## 5. PRD 2.0 產品目標

### 5.1 P0 目標

PRD 2.0 Dynamic Viewing MVP 必須：

1. 保留 PRD 1.0 已完成的核心模擬與 Canon 能力。
2. 以 AI Town 既有 PixiJS、Tilemap、Sprite 與動畫能力作為主要視覺基礎。
3. 提供公開、不可操控的 2D Live Town。
4. 顯示全部 12 位 Mistwood 角色的目前位置與動態狀態。
5. 支援 Idle、Walking、Speaking、Thinking 或等價可辨識狀態。
6. 顯示世界日期、時段、Active Story Arc、Active Scene 與最新重大事件。
7. 點擊角色後顯示公開角色卡，不暴露私人資料。
8. 點擊活躍場景後顯示公開場景摘要與相關角色。
9. 公開觀看不得呼叫 LLM、送出模擬 input 或修改 Canon。
10. 模擬或 Runtime 暫停時仍顯示最後有效狀態。
11. Canon 與畫面位置不一致時不得顯示互相矛盾的事實。
12. 動態畫面無法載入時提供可理解的降級版本。
13. 修復 ART-99 種子世界每日 Canon Snapshot 失敗。
14. 完成桌面與行動裝置的基本觀看體驗。
15. 以瀏覽器 E2E、截圖、效能與安全測試作為完成證據。
16. **（新增）** 在不加快 Canon 世界時鐘的前提下，透過 Ambient Movement、Environmental Animation 與 Visual Replay 維持持續動態感。
17. **（新增）** 建立 Mistwood 專屬地圖，八個正式地點在地圖上具有語意相符的建築與區域。

### 5.2 驗證目標

PRD 2.0 應驗證：

- 動態世界是否比純文字頁面更容易建立角色與場景認知
- 觀眾是否會主動點擊角色、場景或 Story Arc
- Live Town 是否能引導觀眾閱讀 Episode
- 角色與地點的動態呈現是否能增加回訪
- 只讀模式是否能完全隔離模擬寫入與生成成本

### 5.3 不以 PRD 2.0 重驗的目標

除非新改動造成影響，不重新驗證 PRD 1.0 所有 96 條 P0；只執行：

- 受影響範圍回歸測試
- Canon／Runtime 整合測試
- Public Read、安全與權限回歸測試
- 新增 Dynamic Viewing 驗收測試

---

## 6. 非目標

PRD 2.0 不包含：

- 3D 世界
- 寫實角色或 AI 生成劇照
- 導入圖片生成模型
- 電影級即時動畫或動態運鏡系統
- 玩家控制角色移動
- 觀眾與角色即時自由聊天
- 觀眾指定角色行動或劇情結果
- 為每位公開觀眾建立獨立模擬
- 因公開觀看人數增加而增加 LLM 呼叫
- 重寫既有 PixiJS Renderer 或重新製作全部 Sprite
- **加快 Canon 世界時鐘以製造動態感**
- 多公開世界
- 原生 iOS／Android App
- 未審核 UGC
- Production 級付費系統
- 第一版導入外部免費素材庫或圖片生成模型補足 Sprite

> 「不做高品質即時動畫」不代表不做動態畫面。MVP 仍必須提供既有像素角色的移動與狀態動畫。

---

## 7. 目標使用者

### 7.1 新觀眾

- 進站後立即看見世界與角色，而不是先閱讀大量背景
- 知道目前最重要的場景在哪裡
- 知道需要關注哪幾位角色
- 在 30 秒內理解當前事件
- 在 3 分鐘內進入推薦 Episode 或 Story Arc

### 7.2 回訪觀眾

- 看見追蹤角色目前的位置與狀態
- 知道離開期間的重大事件
- 從回訪摘要直接跳到地圖上的相關角色或場景
- 知道 Story Arc 是否進入轉折、高潮或收束

### 7.3 深度觀眾

- 觀察角色日常移動與非主要場景
- 探索角色、關係、地點、Arc 與歷史事件
- 在 Live Town 與 Episode／Timeline 間來回切換

### 7.4 營運管理者

- 確認公開 Renderer 與 Canon 一致
- 查看 Runtime 同步失敗與角色位置漂移
- 暫停公開動態更新但保留最後有效畫面
- 隔離不適當公開對話或場景摘要
- 查看公開觀看是否造成非預期 write 或模型呼叫

---

## 8. 產品體驗原則

**UX2-001 世界先於文字**
公開入口應先讓觀眾看見小鎮與角色，再用文字解釋目前主線。

**UX2-002 動態分層與 Canon 權威（PRD 2.0 修訂）**

> 動態觀看由 **Canon-driven Movement、Ambient Movement、Environmental Animation 與 Visual Replay** 組成。只有 Canon-driven Movement 能表達正式語意位置變化；其他動態不得產生或暗示新的 Canon 事實。

四種動態的完整定義見 §9.1。畫面必須讓觀眾能區分「正在發生的正式事件」與「環境活動」與「重播」。

**UX2-003 觀眾只能觀看與導航**

允許：拖曳與縮放地圖、點擊角色／地點／場景、追蹤角色或切換鏡頭焦點、開啟 Episode／Arc／Recap、手動選擇重播今日事件。

禁止：指定角色目的地、送出角色對話、接受或拒絕角色邀請、啟動／恢復／加速模擬、修改任何 Canon 或 Runtime State。

**UX2-004 劇情脈絡永遠可見**
Live Town 必須同時提供：現在發生什麼、為什麼重要、涉及哪些角色、屬於哪條 Story Arc、可從哪個 Episode 補前情。

**UX2-005 Canon 優先於畫面流暢**
若畫面狀態無法確認，應顯示同步中、最後已知狀態或暫停更新，不得為了保持動畫而呈現錯誤位置或事件。

**UX2-006 公開流量零生成副作用**
觀看、縮放、點擊角色與切換場景不得觸發 LLM、Director、Scene Simulation 或 Canon Commit。

**UX2-007 優先重用上游能力**
只要既有 AI Town PixiJS、Tilemap、Sprite、動畫與路徑能力可用，就不得重新實作同等 Renderer。

**UX2-008 動態失敗仍可理解**
WebGL、Runtime Stream 或動畫失敗時，觀眾仍可透過最後有效地圖、位置、場景卡與文字摘要理解目前世界。

**UX2-009 時間狀態必須誠實（PRD 2.0 新增）**
畫面必須明確區分「重播」「稍早」「現在」。系統不得將舊事件偽裝成正在即時發生。

---

## 9. 產品模式

### 9.1 動態模型（PRD 2.0 核心新增）

Canon 時間模型維持不變：

```text
1 世界日 = 1 真實日
每天 5 個 Canon 時段（真實時間 0/6/11/15/19 點）
```

**不得為了讓畫面持續移動而加快 Canon 世界時鐘。**

畫面動態分為四種，責任互不重疊：

#### 9.1.1 Canon-driven Movement

由 Accepted Event 或正式 World Projection 驅動，**可以跨地點**。

例如：`紀事報 → 杜松診所`

角色移動期間顯示：`林映雪｜前往杜松診所`
角色抵達後才顯示：`林映雪｜位於杜松診所`

這是**唯一**能表達正式語意位置變化的動態類型。

#### 9.1.2 Ambient Movement

角色可以在目前 Canon 地點的視覺 Zone 內進行無敘事含義的活動：走動、待機、坐下、閱讀、工作、面向環境物件、短距離來回移動。

Ambient Movement **不得**：

- 離開角色目前的 Canon 地點 Zone
- 進入其他語意地點
- 自動開始新的角色對話
- 暗示拜訪、調查、跟蹤或其他事件
- 改變 Canon、Memory、Knowledge、Relationship 或 Story Arc
- 建立新的 Accepted Event

Ambient Movement 使用固定 Seed，至少包含：

```text
characterId
locationId
worldDay
timeBucket
```

同一時間觀看的使用者應看到可重現且基本一致的活動，不得由每個瀏覽器隨機產生完全不同的角色行為。

#### 9.1.3 Environmental Animation

可包含：水面、樹木、煙霧、燈光、天氣、日夜變化、建築物環境動畫。

Environmental Animation 不得修改世界狀態。

#### 9.1.4 Visual Replay

使用者進入 `/live` 時，先播放最近已完成的重要 Canon 場景，再回到目前世界狀態。

建議流程：

```text
進入 /live
→ 播放最近 1–3 個重要場景
→ 每段約 20–60 秒
→ 播放完畢後進入目前 Ambient 狀態
→ 新 Canon 時段或事件發布時播放新場景
→ 再回到 Ambient 狀態
```

Replay 只使用既有資料：Accepted Event、角色起點與終點、Scene Summary、參與角色、公開對話精華、Story Arc Progress。

Replay **不得**：呼叫 LLM、重新執行模擬、重新建立 Event、修改 Canon、將舊事件偽裝成正在即時發生、無限循環播放同一場景。

畫面必須清楚區分時間狀態：

```text
重播｜今日 11:00
稍早｜林映雪從紀事報前往杜松診所
現在｜林映雪位於杜松診所
```

同一個 Replay 每個觀看 Session 最多自動播放一次。使用者可以手動選擇「重播今日事件」，但系統不得自動反覆播放。

### 9.2 Live Town

主要動態觀看模式。畫面至少包含：2D 小鎮地圖、可見角色 Sprite、角色位置與動態狀態、活躍場景標示、世界日期與時段、當前主要 Story Arc、最新重大事件、角色／場景公開資訊卡。

### 9.3 Episode／Story

已完成內容的編輯式回顧模式。包含：每日 Episode、Quick／Standard／Deep Recap、Story Arc、Character、Relationship、Timeline、Recommended Entry。

### 9.4 Runtime 停止模式

當模擬暫停、維護或 Runtime 不可用：顯示最後有效 Runtime Snapshot、清楚標示最後更新時間、不偽裝成正在更新、Episode／角色／Arc 與歷史內容保持可讀。

---

## 10. 系統責任邊界

### 10.1 Canon Domain

**負責：** 角色語意位置（例如「診所」「報社」）、角色是否存活／可用／受傷或參與事件、Accepted Event、Story Arc／Episode 與公開事實、重大位置變更與場景參與。

**不負責：** 每一幀的 x／y 座標、Sprite 動畫 Frame、客戶端相機位置、移動插值與渲染 FPS。

### 10.2 Visual Runtime

**負責：** Tilemap 與視覺圖層、Sprite／方向與動畫狀態、x／y 座標、路徑／速度與移動插值、Speaking／Thinking／Activity 的視覺提示、Ambient Movement 的決定性產生、依 Visual Binding 幾何判定是否抵達 Zone。

**不得**自行建立 Canon 事實。

**不擁有 Binding。** `locationId → 幾何` 與 `characterId → 外觀` 屬於獨立的 Visual Binding 層（§14.1／§14.2），Visual Runtime 只是消費者。三方責任見 §10.6。

### 10.3 a16z AI Town 引擎處置（PRD 2.0 決策）

**停用**（伺服器端模擬生命週期）：

```text
convex/aiTown/ 的世界執行生命週期
convex/agent/ 的 Agent 推理
aiTown/main:runStep
heartbeat 啟動或維持模擬
Human Player
joinWorld / moveTo / sendWorldInput
chat / interact
restart dead worlds cron
stop inactive worlds cron
```

**保留或抽取**（純視覺能力）：

```text
PixiGame / PixiJS Renderer
PixiViewport
Tilemap Renderer
Character Sprite Renderer
Idle / Walking / Speaking / Thinking Animation
Sprite Sheet
碰撞資料
可獨立使用的 Pathfinding 工具
地圖與環境資產
```

**新增**一個不含 LLM、不能修改 Canon 的輕量 Visual Runtime：

```text
Canon / Public Read Model
→ Visual Sync Planner
→ Movement Trajectory
→ Public Dynamic Projection
→ PixiJS Renderer
```

**不得每幀將角色座標寫回後端。**

### 10.4 Public Dynamic Projection

公開客戶端不得直接讀取完整 Runtime State。系統必須提供經白名單處理的 Public Dynamic Projection，只包含渲染與公開敘事必要欄位。

發布的角色動態單元：

```ts
type PublicCharacterMotion = {
  characterId: string;
  semanticLocationId: string;

  motionType: "canon" | "ambient" | "idle" | "replay";
  motionSequence: number;

  from: { x: number; y: number };
  to: { x: number; y: number };

  startedAt: number;
  arriveAt: number;

  animationState:
    | "idle"
    | "walking"
    | "speaking"
    | "thinking"
    | "activity";

  direction: "up" | "down" | "left" | "right";

  sourceEventIds?: string[];
};
```

前端依 `startedAt`、`arriveAt` 與 `motionSequence` 進行插值及動畫播放。

Visual Replay 至少應具備：

```ts
type VisualReplay = {
  replayId: string;
  sourceEventIds: string[];
  worldDay: number;
  timeSlot: string;

  participants: Array<{
    characterId: string;
    startPosition: { x: number; y: number };
    endPosition: { x: number; y: number };
  }>;

  steps: Array<
    | { type: "move"; characterId: string; to: { x: number; y: number }; durationMs: number }
    | { type: "wait"; durationMs: number }
    | {
        type: "dialogue";
        characterId: string;
        publicExcerptId: string;
        publicationVersion: number;
      }
    | {
        type: "eventCard";
        publicSummaryId: string;
        publicationVersion: number;
      }
  >;
};
```

**Replay 不得保存自由文字。** `dialogue` 與 `eventCard` 只能以識別碼引用既有的已發布、已通過 Safety 的公開內容，並記錄該內容的 `publicationVersion`。理由：僅有 `sourceEventIds` 不足以證明畫面上顯示的是安全版本——同一個 Accepted Event 的公開摘要可能被 Withhold 或 Supersede，若 Replay 內嵌文字副本，撤下的內容仍會透過重播外洩。

當被引用的公開內容遭 Withhold 或 Supersede 時，Replay 必須同步失效或重新建構，不得繼續播放舊版本文字。

### 10.5 一致性規則

- Canon 是語意事實的唯一權威。
- Visual Runtime 是畫面座標與動畫的暫時投影。
- Canon 顯示角色在某地點前，Runtime 必須已到達該地點區域，或 UI 明確顯示「前往中」。
- 發生不可恢復漂移時，角色應暫停公開、回到最後有效 Snapshot 或進入同步中狀態。
- 不得為修正畫面而直接修改 Canon。
- Ambient Movement 永遠受限於角色目前 `locationId` 所對應的視覺 Zone。**該 `locationId` 由 Canon 決定；該 Zone 的幾何邊界由 Visual Binding 決定；Zone 內的實際位置由 Visual Runtime 決定。**

### 10.6 Canon／Visual Binding／Visual Runtime 三方責任

Canon **不得**持有地圖幾何。`zonePolygon`、`anchors`、`mapId` 屬於 Visual Binding，不屬於 Canon Domain——否則語意與視覺的分離就被破壞，Canon 會開始依賴地圖版本。

| 資料 | Owner |
|---|---|
| 角色目前的 `locationId` | **Canon** |
| 角色是否存活／參與事件 | **Canon** |
| Accepted Event、Arc、Episode | **Canon** |
| `locationId → zonePolygon／anchors／mapId` | **Visual Binding** |
| `characterId → spriteKey／paletteVariant／nameplate` | **Visual Binding** |
| 角色 x／y、路徑、速度、插值 | **Visual Runtime** |
| 動畫狀態與方向 | **Visual Runtime** |
| Zone 內的 Ambient 位置 | **Visual Runtime** |
| 是否抵達 Polygon | **Visual Runtime** 依 Visual Binding 的幾何判定 |
| 相機位置 | **客戶端** View State |

**抵達判定不產生 Canon 事實。** Canon Event 不因抵達動畫而新增或修改；抵達只推進 Runtime 的 Movement Phase 與公開投影的顯示狀態。

---

## 11. PRD 1.0 基線需求

原 PRD 1.0 Epic A–M 全部保留，已完成 P0 不重新建立 Task。

| Epic | 能力 | PRD 2.0 狀態 |
|---|---|---|
| A | 世界初始化 | Core Platform Baseline |
| B | 角色與關係 | Core Platform Baseline；未完成 P1 沿用原 Task |
| C | 模擬排程與場景 | Core Platform Baseline |
| D | Canon Event Store | Core Platform Baseline |
| E | 知識、記憶與謠言 | Core Platform Baseline；未完成 P1 沿用原 Task |
| F | Story Arc Engine | Core Platform Baseline；未完成 P1 沿用原 Task |
| G | Episode 與編輯層 | Core Platform Baseline；未完成 P1 沿用原 Task |
| H | 新觀眾導覽 | Core Platform Baseline；未完成 P1/P2 沿用原 Task |
| I | 公開觀看介面 | 被 PRD 2.0 新 Dynamic Viewing Requirements 擴充 |
| J | 觀眾互動 | 未完成 P1/P2 沿用原 Task |
| K | 管理與營運 | Core Platform Baseline；未完成 P1 沿用原 Task |
| L | 內容安全 | Core Platform Baseline |
| M | 可觀測性與品質 | Core Platform Baseline；未完成 P1 沿用原 Task |

---

## 12. 新功能需求

### Epic N：Visual Foundation

#### FR-N001 上游視覺能力稽核 — P0

系統必須稽核目前 Repository 中可重用的 AI Town 視覺能力，包括：PixiJS Renderer、Tilemap 與圖層、Character Sprite Sheet、Idle／Walking／Speaking／Thinking 動畫、路徑與座標更新、Viewport 拖曳與縮放、地圖／角色／字型／音效與其他第三方素材授權。

**驗收條件：**

1. 產出程式碼與資產清單。
2. 每項標示可直接重用、需修改、已失效或不得公開。
3. 實際啟動既有畫面，不得只依文件推測。
4. 說明目前公開頁面未使用動態 Renderer 的原因。
5. 說明最小恢復路徑。
6. 可重用時不得建立新的同等 Renderer。
7. 明確標示哪些 a16z 伺服器端能力屬於 §10.3 停用範圍。

#### FR-N002 Read-only Pixi World — P0

建立公開只讀 Renderer，重用既有地圖與角色渲染能力，但移除所有世界寫入與玩家控制能力。

**驗收條件：**

1. 可以渲染既有地圖與角色 Sprite。
2. 不掛載 world heartbeat。
3. 不呼叫 join、move、chat、interact、accept、reject、leave 或其他 write action。
4. 不顯示玩家控制按鈕。
5. 不允許地圖點擊改變角色目的地。
6. 只讀元件與可互動 Game 元件具有清楚程式邊界。
7. 測試證明公開觀看不會產生資料庫 mutation。

#### FR-N003 Public Dynamic Projection — P0

建立公開、只讀、欄位白名單的 Runtime Projection，發布 §10.4 定義的 `PublicCharacterMotion`。

投影根層至少包含：`worldId`、`runtimeVersion`、`snapshotSequence`、`updatedAt`、`worldStatus`、`characters[]`、`activeScenes[]`。

**驗收條件：**

1. 不返回私人記憶、秘密、Prompt、完整對話或管理資訊。
2. 不返回公開渲染不需要的 Runtime 欄位。
3. 所有欄位有 Runtime Schema Validation。
4. 查詢不得造成 write side effect。
5. Projection 可獨立進行授權與資料洩漏測試。
6. 更新失敗保留最後有效版本。
7. `motionType` 能讓客戶端區分 canon／ambient／idle／replay。

#### FR-N004 Character Visual Binding — P0

建立穩定映射：`Canon characterId ↔ runtimeId ↔ spriteKey ↔ paletteVariant ↔ nameplate ↔ portraitFrame`。

現況只有 f1–f8 共 8 款 Sprite，12 位角色採：**既有 Sprite ＋ 服裝／髮色 Palette Variant ＋ 固定角色名牌**。八款原始 Sprite 可直接分配給八位角色，另外四位使用服裝或髮色 Palette Variant。

**不得對整個 Sprite 套單一 Tint**，避免皮膚、頭髮及衣服全部變成同一色調。

```ts
type CharacterVisualBinding = {
  characterId: string;
  runtimeId: string;
  spriteKey: string;
  paletteVariant: string;
  nameplate: string;
  portraitFrame: number;
};
```

**驗收條件：**

1. 十二位角色都具備穩定且可辨識的視覺綁定。
2. 重新部署後不得隨機更換外觀。
3. 同一角色在地圖、角色卡與 Episode 中使用相同視覺識別。
4. 所有綁定必須版本化與可稽核。
5. 第一版不導入外部免費素材或圖片生成模型。
6. 不存在的角色或 Sprite 會被匯入驗證拒絕。
7. 角色停用或死亡時可切換公開視覺狀態。

#### FR-N005 Location Visual Binding — P0

建立穩定映射：`Canon locationId ↔ map zone／polygon／anchor points ↔ public label`。

```ts
type LocationVisualBinding = {
  locationId: string;
  zonePolygon: Array<{ x: number; y: number }>;
  entryAnchors: Array<{ x: number; y: number }>;
  ambientAnchors: Array<{ x: number; y: number }>;
  sceneFocusPoint: { x: number; y: number };
  publicLabel: string;
};
```

**驗收條件：**

1. **全部八個 Mistwood 正式地點**（車站、燈籠廣場、鎮公所、紀事報、杜松診所、北水磨坊、貝爾威瑟果園、狐手套旅店）完成 Binding。
2. 區域不得彼此產生不合理重疊。
3. 角色到達判斷使用區域而不是單一像素完全相等。
4. 無 Binding 的 Canon 地點不得直接公開為可視位置。
5. `ambientAnchors` 足以支撐 §9.1.2 的 Zone 內活動。
6. `connectedLocationIds` 用於地點間路網語意，實際路線由地圖碰撞及 Pathfinding 決定。

#### FR-N006 Canon／Runtime 同步 — P0

當 Accepted Event 改變角色位置或場景參與時，系統應將語意變化同步為 Runtime 的移動或視覺狀態。

**驗收條件：**

1. 角色位置變更可轉換為有效 Runtime 目的地。
2. 移動期間 UI 顯示「前往中」或等價狀態。
3. 角色抵達目標區域後才顯示已位於該地點。
4. Runtime 失敗不得回寫錯誤 Canon。
5. 重試不得重複建立 Canon Event。
6. 同一角色不得同時出現在兩個公開位置。
7. 同步錯誤具備穩定 Error Code 與可觀測指標。

#### FR-N007 Runtime Snapshot — P0

建立公開 Runtime Snapshot，使 Renderer 在模擬停止或 Stream 中斷後仍能顯示最後有效狀態。

**驗收條件：**

1. Snapshot 具有 Sequence 與時間戳。
2. Snapshot 可在無模擬執行時讀取。
3. 客戶端知道資料是否為 Live、Delayed、Paused 或 Stale。
4. 不得將 Stale Snapshot 假裝成持續更新。
5. Snapshot 失敗不影響 Canon Event Store。

#### FR-N008 視覺素材授權與 Attribution — P0

**驗收條件：**

1. 所有重用素材均確認授權來源。
2. 必要 Attribution 保留於產品或文件。
3. 不明來源素材不得進入公開版本。
4. CI 或發布檢查可驗證必要 License 文件存在。

#### FR-N009 Mistwood 專屬地圖 — P0（新增）

使用既有 Tileset 重排 Mistwood 專屬地圖，建立 `data/mistwood.ts`。

**不得**直接使用 a16z 通用地圖並用標籤掩蓋語意不符的場景；不得讓診所、報社、磨坊、果園等地點實際對應到草地或無關建築。

**驗收條件：**

1. 八個正式地點在地圖上具有語意相符的建築或區域。
2. 只使用既有 tileset 資產，不導入新美術素材。
3. 具備 bgtiles／objmap／碰撞圖層。
4. 地點間依 `connectedLocationIds` 具有可通行路線。
5. 地圖資料可被 Tilemap Renderer 直接載入。
6. 地圖尺寸與 tile 規格與既有 Renderer 相容。

#### FR-N010 輕量 Visual Runtime — P0（新增）

建立不含 LLM、不能修改 Canon 的 Visual Runtime，取代 a16z 伺服器端引擎的移動職責。

**驗收條件：**

1. 由 Canon／Public Read Model 推導 Movement Trajectory。
2. 不含任何 LLM 呼叫路徑。
3. 不寫入 Canon Event Store。
4. 不得每幀將角色座標寫回後端。
5. Ambient Movement 由 §9.1.2 的固定 Seed 決定性產生。
6. 可在無外部 API 的情況下以 Deterministic Fixture 測試。

### Epic O：Dynamic Live Town

#### FR-O001 動態 2D 地圖 — P0

`/live` 必須顯示可拖曳、縮放的 2D 小鎮地圖，不得以純文字地點列表或靜態截圖替代。

**驗收條件：** 桌面與行動裝置可載入地圖；主要圖層／碰撞區與角色圖層正確顯示；觀眾可平移與縮放但不能改變世界；WebGL 不可用時提供 Canvas 或資訊式降級；地圖暫停時仍能檢視最後狀態。

#### FR-O002 Canon-driven 角色移動與動畫 — P0

**驗收條件：**

1. 全部 12 位角色可在地圖中顯示。
2. Canon 位置變化時角色平滑跨地點移動。
3. 未移動角色具有 Idle 動畫或清楚的靜態待機狀態。
4. 移動角色具有 Walking 動畫與正確方向。
5. 交談、思考或特殊活動具有可辨識提示。
6. 角色不得瞬間跳躍，除非 Canon Event 明確允許特殊移動。
7. 低效能裝置可降低更新率但不得破壞語意狀態。

#### FR-O003 活躍場景視覺化 — P0

**驗收條件：** 場景位置可在地圖上辨識；顯示場景標題／公開摘要／參與角色與 Story Arc；點擊場景可將鏡頭聚焦至相關位置；私人或未發布場景不得公開；場景結束後轉為最近事件或 Episode 入口。

#### FR-O004 公開交談與活動提示 — P0

**驗收條件：** 角色交談時可顯示公開對話摘要／狀態或簡短泡泡；不直接公開完整私人對話；不公開尚未通過 Safety／Publication Status 的內容；內容過長時使用摘要不遮蔽主要畫面；沒有可公開文字時仍可顯示「交談中」等安全狀態。

#### FR-O005 鏡頭與導航 — P0

觀眾可以：拖曳地圖、縮放、點擊角色並聚焦、點擊活躍場景並聚焦、返回全鎮視角、選擇自動追蹤目前主要場景。

**驗收條件：** 所有操作只改變客戶端 View State；不送出任何角色控制指令；自動追蹤可關閉；相機切換不得造成暈動或失控縮放；支援 Reduced Motion。

#### FR-O006 公開角色卡 — P0

**顯示：** 角色名稱與 Sprite／頭像、職業與公開背景、目前公開位置或移動狀態、公開情緒／活動狀態、Public Goal、所屬 Active Story Arc、最近重大事件、前往 Character 頁面的入口。

**不得顯示：** Private Goal、未揭露 Secret、私人記憶、Prompt 或模型輸出、管理者註解。

#### FR-O007 Live Story Overlay — P0

Live Town 必須提供不遮蔽地圖的故事資訊區，至少包含：世界日與時段、Current Situation、當前主要 Story Arc、活躍場景、最新重大事件、推薦 Episode／前情入口。

**驗收條件：** 使用 Public Read Model 不直接讀取 Canon Write Store；內容變更與地圖狀態可在合理時間內同步；Overlay 可收合；行動版不要求同時顯示全部資訊；公開觀看不得觸發摘要生成。

#### FR-O008 響應式觀看體驗 — P0

**驗收條件：** 桌面版可同時顯示地圖與 Story Overlay；行動版以地圖為主、卡片使用 Bottom Sheet 或等價模式；主要控制具有足夠觸控尺寸；橫向與直向不出現阻斷式溢位；小螢幕仍可打開角色與場景卡。

#### FR-O009 公開只讀保證 — P0

**驗收條件：** `/live` 未登入也只能執行 read query；觀看期間不建立 Human Player、不送出 heartbeat、不啟動或恢復世界、不增加 LLM Trace；安全測試攔截所有未授權 mutation；公開 API 不接受角色控制 payload。

#### FR-O010 動態畫面降級 — P0

降級順序：正常 Runtime Stream → 最後有效 Runtime Snapshot → 靜態地圖＋角色最後位置 → 地點／角色／場景資訊式檢視。

**驗收條件：** 降級不影響 Episode／Arc 與歷史內容；清楚標示最後更新時間與狀態；不因 Renderer Failure 重試 LLM；恢復後可自動回到較高層級。

#### FR-O011 Ambient Movement — P0（新增）

依 §9.1.2 實作 Zone 內的無敘事含義活動。

**驗收條件：**

1. Ambient Movement 永不離開角色目前 Canon 地點的 Zone。
2. 不建立 Accepted Event，不改變 Canon／Memory／Knowledge／Relationship／Story Arc。
3. 不自動開始新的角色對話。
4. 使用固定 Seed（`characterId` + `locationId` + `worldDay` + `timeBucket`）決定性產生。
5. 同一時間不同瀏覽器看到可重現且基本一致的活動。
6. 視覺上可與 Canon-driven Movement 區分。
7. 具備自動化測試證明 Zone 邊界與零 Canon 副作用。

#### FR-O012 Environmental Animation — P0（新增）

**驗收條件：** 可包含水面／樹木／煙霧／燈光／天氣／日夜變化／建築環境動畫；不修改世界狀態；支援 Reduced Motion 關閉；不影響角色語意狀態判讀。

#### FR-O013 Visual Replay — P0（新增）

依 §9.1.4 實作，資料結構見 §10.4 `VisualReplay`。

**驗收條件：**

1. 進入 `/live` 播放最近 1–3 個重要場景，每段約 20–60 秒。
2. 播放完畢後進入目前 Ambient 狀態。
3. 只使用既有 Accepted Event 與已發布摘要資料。
4. 不呼叫 LLM、不重新執行模擬、不重新建立 Event、不修改 Canon。
5. 同一 Replay 每個觀看 Session 最多自動播放一次。
6. 使用者可手動選擇「重播今日事件」。
7. 系統不得自動反覆播放或無限循環。
8. 可隨時跳過並直接進入目前狀態。
9. `dialogue` 與 `eventCard` 步驟只以 `publicExcerptId`／`publicSummaryId` 加 `publicationVersion` 引用已發布內容，不得保存自由文字副本。
10. 被引用的公開內容遭 Withhold 或 Supersede 時，Replay 同步失效或重新建構，不再播放舊版本文字。

#### FR-O014 時間狀態標示 — P0（新增）

**驗收條件：**

1. 畫面明確區分「重播」「稍早」「現在」三種時間狀態。
2. Replay 期間持續顯示重播標示與對應世界時間。
3. 不得將舊事件呈現為正在即時發生。
4. 時間狀態不只依賴顏色辨識。

### Epic P：Editorial Viewing Integration

#### FR-P001 動態首頁入口 — P0

首頁首屏必須提供：Live Town 入口或動態預覽、Current Situation、當前主要 Story Arc、最多四位核心角色、最新重大事件、推薦 Episode。

**驗收條件：** 首屏不得只呈現文字標題與列表；核心角色使用既有 Sprite／視覺識別；點擊角色／場景／Arc 可進入對應頁面；公開首頁不觸發 LLM。

#### FR-P002 Live 與 Episode 連續性 — P0

**驗收條件：** Active Scene 結束後可連結至相關 Episode 或事件；Episode 可連回相關角色與地圖位置；Story Arc 可連結至目前地圖上的核心角色或場景；Recommended Entry 可從 Live Overlay 直接開啟；導航不得遺失觀看進度或目前焦點。

#### FR-P003 統一視覺系統 — P0

定義並實作：背景／Surface／邊框與強調色、Story Arc／Character／Event／Episode 卡片、角色 Sprite／頭像容器、世界日／時段與狀態標示、Live／Paused／Delayed／Stale 狀態、字體層級與資訊密度。

**驗收條件：** 公開頁面不得呈現為管理後台或純黑白文件；Live／首頁／Episode／Character／Arc 使用一致設計語言；視覺層不得改變 Canon 語意；顏色不是唯一狀態辨識方式。

#### FR-P004 Publication 與 Safety 整合 — P0

**驗收條件：** Live Overlay 只顯示 Published／允許公開的內容；Withheld 場景只顯示安全的一般狀態或完全隱藏；Safety 更新後可從公開 Projection 移除內容；移除公開文字不影響 Canon 與角色位置；所有公開文字可追蹤至 Accepted Event 或已發布摘要。

**Replay 一致性：** 公開內容遭 Withhold 或 Supersede 時，引用該內容的 Visual Replay 必須同步失效或重新建構。Replay 不得保存文字副本繞過此機制（見 §10.4）。

### Epic Q：Dynamic Viewing Operations

#### FR-Q001 Dynamic View 可觀測性 — P0

至少記錄：Runtime Projection 更新延遲、Snapshot 年齡、Active Viewer 數量、Renderer Error Rate、Canon／Runtime Location Mismatch、Missing Character Binding、Missing Location Binding、Public Mutation Attempt、Viewer-triggered LLM Call Count、降級模式使用率、Replay 播放次數與跳過率。

**驗收條件：** Viewer-triggered LLM Call Count 必須為 0；Public Mutation Attempt 必須被拒絕並記錄；Mismatch 可定位至角色／位置與 Sequence；不記錄私人角色資料。

#### FR-Q002 管理者動態觀看控制 — P1

管理者可：暫停公開 Runtime 更新、強制使用最後有效 Snapshot、隱藏單一角色或場景的公開視覺、查看 Binding 與同步錯誤、重新建立 Public Dynamic Projection。

**不得：** 直接修改 Canon Event、以公開控制台繞過 Correction 流程。

#### FR-Q003 Incremental Public Projection — P1

此需求由現有 **ART-100** 承接，不重建新 Task。

目標：公開 Read Model 與 Dynamic Projection 可增量更新；避免每次狀態變化重建整個世界投影；保持 Idempotency 與 Sequence 一致性。

#### FR-Q004 Dynamic View 無障礙交付 — P0

實現 **NFR2-006** 於動態觀看層。詳細驗收條件見 §16 NFR2-006。此需求存在的目的，是讓非功能需求也有可追蹤的 Requirement ID 與明確擁有者，避免「所有 P0 都有 Task」的宣告出現追蹤缺口。

#### FR-Q005 動態層效能基準與品質分級 — P0

實現 **NFR2-002**。必須在公開前建立**固定 Benchmark**（裝置與瀏覽器規格、角色數、地圖縮放、量測門檻），並實際通過。詳細見 §16 NFR2-002。

#### FR-Q006 Dynamic Live 驗證套件 — P0

實現 **§21.3** 的瀏覽器 E2E 驗證，並在執行期提供零 Mutation 與零 Viewer-triggered LLM 的運行證據。

#### FR-Q007 動態觀看產品分析事件 — P1

實現 **§17** 的 17 個 `live_*` 事件，使 §18.1 的點擊率與 Replay 完成率指標可量測。

> **已知張力：** §18.1 將這些數字列為 MVP 目標，§19 將分析歸為 P1。本 PRD 的處置是：**儀器化屬 P1，不阻斷發布**；但在 FR-Q007 完成前，§18.1 相關指標一律標示為「未量測」，不得以推估值宣稱達標。

#### FR-Q008 Dynamic Viewing MVP Release Gate — P0

實現 **§22** 全部驗收標準的證據彙整與封閉紀錄，並更新 Requirement Matrix 與 Closure 紀錄。

---

## 13. 既有 To Do Task 的處理

以下 23 個 Task 必須沿用原 Task ID，不得因 PRD 2.0 再建立重複 Task。

| Task | 內容 | PRD 2.0 處理 |
|---|---|---|
| ART-11 | 人格偏移偵測與角色摘要 | Carry Forward；保留既有優先級 |
| ART-27 | 長期記憶無損壓縮 | Carry Forward；保留既有優先級 |
| ART-28 | 版本化謠言傳播鏈 | Carry Forward；保留既有優先級 |
| ART-32 | 可追溯 Arc 熱度評分 | Carry Forward；保留既有優先級 |
| ART-36 | 安全的 Episode 分享格式 | Carry Forward；保留既有優先級 |
| ART-39 | 裝置感知的回訪摘要 | Carry Forward；保留既有優先級 |
| ART-44 | 關係圖譜體驗 | Carry Forward；保留既有優先級 |
| ART-45 | 每日環境投票與防濫用 | Carry Forward；保留既有優先級 |
| ART-46 | 觀眾介入因果追蹤 | Carry Forward；保留既有優先級 |
| ART-47 | 隱私保護的產品分析 | Carry Forward；保留既有優先級 |
| ART-52 | 模型／Prompt／Retry／Budget 配置稽核 | Carry Forward；保留既有優先級 |
| ART-58 | Canon 品質指標 | Carry Forward；保留既有優先級 |
| ART-59 | Token 預算與併發控制 | Carry Forward；保留既有優先級 |
| ART-71 | 已登入觀眾追蹤與進度 | Carry Forward；保留既有優先級 |
| ART-73 | 90 天韌性與品質模擬 | Carry Forward；保留既有優先級 |
| ART-76 | P1 謠言與觀眾介入整合測試 | Carry Forward；保留既有優先級 |
| ART-88 | 敘事一致性評估器 | Carry Forward；保留既有優先級 |
| ART-89 | Recap 品質評估器 | Carry Forward；保留既有優先級 |
| ART-90 | 安全拒絕率評估器 | Carry Forward；保留既有優先級 |
| ART-91 | 模型中斷時安全降級流程 | Carry Forward；與 FR-O010 整合但不得合併刪除 |
| ART-94 | 圖表與時間軸無障礙合規 | Carry Forward；保留既有優先級 |
| ART-99 | 種子世界每日 Canon Snapshot 失敗 | **提升為 P0 Release Blocker** |
| ART-100 | 增量式公開讀模型更新 | Carry Forward；對應 FR-Q003 |

### 13.1 ART-99 完成條件

ART-99 必須在 Dynamic Viewing MVP 公開前完成：

1. 種子世界可以依預定排程建立每日 Canon Snapshot。
2. Snapshot 失敗具有穩定 Error Code。
3. 失敗不得造成已接受 Event 丟失。
4. 修復後完整 Replay 與 Snapshot Replay 結果一致。
5. 建立固定 Seed 回歸測試。
6. 管理者可查看最近成功與失敗 Snapshot。

### 13.2 Pre-existing Regression Exception（唯一獲准例外）

PRD 2.0 的 Task 建立規則是「只為 FR-N／FR-O／FR-P／FR-Q 新需求建立 Task」。**ART-139 是唯一獲准的例外**，因為它不是新需求，而是 PRD 1.0 基線上的既有 Regression Defect：

- **歸屬需求：** PRD 1.0 FR-C002 Whole-scene Simulation（原已宣告交付）
- **性質：** Existing Baseline Defect，非 New Requirement
- **阻斷關係：** 未修復則不產生 Accepted Event，`withArrivalStateChanges` 不附加 `character_location_changed`，PRD 2.0 §22.6 無法達成
- **不得**因此重新開啟 PRD 1.0 Epic C，或以此為由重建任何已 Done 的 Task

除 ART-139 外，不得再以「既有缺陷」為由在 FR-N／O／P／Q 之外建立新 Task；新發現的基線缺陷必須另行提報並更新本節。

### 13.3 目前基線狀態

PRD 1.0 的**歷史封閉**（96 條 P0，ART-63）維持有效，但**目前基線存在兩個未關閉的發布阻斷缺陷**：

| Task | 缺陷 | 影響 |
|---|---|---|
| **ART-99** | 種子世界每日 Canon Snapshot 失敗 | FR-N007 公開快照建立其上 |
| **ART-139** | 真實 provider 場景解析失敗 | 無 Accepted Event，動態層無資料可呈現 |

因此對外敘述必須使用 §26 規定的用語，不得單以「PRD 1.0 已完成」描述目前基線健康狀態。

---

## 14. 資料模型新增

### 14.1 CharacterVisualBinding

```text
id, worldId, characterId, runtimeId, spriteKey, paletteVariant,
nameplate, portraitFrame, displayName, publicVariant, status,
version, createdAt, updatedAt
```

### 14.2 LocationVisualBinding

```text
id, worldId, locationId, mapId, zoneType, zonePolygon, entryAnchors,
ambientAnchors, sceneFocusPoint, publicLabel, status, version,
createdAt, updatedAt
```

### 14.3 PublicRuntimeSnapshot

```text
id, worldId, runtimeVersion, snapshotSequence, status,
characterStates, activeSceneStates, createdAt, sourceRuntimeSequence
```

### 14.4 PublicCharacterMotion

見 §10.4 型別定義。

### 14.5 RuntimeSyncRecord

```text
id, worldId, characterId, sourceEventId, sourceLocationId,
targetLocationId, runtimeCommandId, status, startedAt, arrivedAt,
errorCode, retryCount
```

### 14.6 ActiveScenePresentation

```text
id, worldId, sceneId, locationId, participantCharacterIds,
publicTitle, publicSummary, arcIds, publicationStatus, startedAt, endedAt
```

### 14.7 VisualReplay

見 §10.4 型別定義。

---

## 15. 動態狀態處理流程

```text
1.  Commit Accepted Canon Event
2.  Update Canon Projection
3.  Detect Visual-Relevant State Change
4.  Resolve Character／Location Visual Binding
5.  Create Idempotent Runtime Sync Command
6.  Visual Runtime Plans Path and Movement Trajectory
7.  Publish Whitelisted Public Dynamic Projection
8.  Render Canon-driven Movement and Animation
9.  Confirm Arrival in Target Zone
10. Update Public Movement Phase
11. Enter Ambient Movement within the Zone
12. Publish Active Scene／Story Overlay
13. Build Visual Replay for the completed slot
14. Persist Last Valid Runtime Snapshot
15. Record Sync and Rendering Metrics
```

**失敗處理：**

- Binding 不存在：不執行移動，記錄錯誤並隱藏錯誤位置。
- Runtime Command 失敗：保留 Canon，使用最後有效視覺狀態。
- Projection 失敗：使用最後有效 Runtime Snapshot。
- Renderer 失敗：降級為靜態地圖或資訊式檢視。
- Safety 未通過：保留角色位置，但隱藏對話與場景內容。
- Replay 建構失敗：略過 Replay 直接進入目前 Ambient 狀態。

---

## 16. 非功能需求

**NFR2-001 公開零副作用** — Public Live View 不得執行 mutation；Viewer 數量增加不得增加 LLM 呼叫；Viewer 不得啟動／恢復／加速模擬；Viewer 不得建立 Human Player。

**NFR2-002 效能（FR-Q005）** — Live View Shell P95 可互動時間：桌面 <4 秒、行動 <6 秒；Public Dynamic Query P95 <500ms；Runtime 至公開畫面更新延遲一般 <5 秒；桌面平均 ≥45 FPS、中階行動裝置 ≥30 FPS；降低 FPS 不得改變角色語意位置。

效能是 P0，且 §22 要求所有 P0 具有客觀證據，因此**必須在公開前建立並通過固定 Benchmark**，內容至少包含：

```text
指定中階行動裝置型號或等價模擬規格
指定瀏覽器與版本
12 / 20 / 40 位可視角色三組場景
指定地圖縮放層級與可視角色數
正常 Stream / 延遲 Stream / Snapshot / 降級 四種模式
8 小時長時間執行的記憶體成長量測
FPS、TTI、Query P95、Projection Delay 的通過門檻
```

**正式環境實測數據可於上線後補充，但不得取代公開前的 Benchmark Gate。** 在 Benchmark 通過前，不得宣稱 Dynamic Viewing MVP 完成。

**NFR2-003 可用性** — 模擬引擎中斷不影響 Episode／Character／Arc 與歷史內容；Runtime Stream 中斷時自動使用最後有效 Snapshot；公開動態層故障不得拖垮 Canon Write Path。

**NFR2-004 一致性** — Canon／Runtime Location Mismatch 不得長時間無告警存在；同一角色不得公開顯示於兩個地點；所有 Runtime Sync Command 必須 Idempotent；重新連線後不得倒退至較舊 Sequence。

**NFR2-005 安全** — Public Projection 使用欄位白名單；Server-side Authorization 不能依賴 UI 隱藏按鈕；私人對話／記憶／Secret／Prompt／Trace 不得返回公開客戶端；所有公開文字經 Publication Status 與 Safety Filter。

**NFR2-006 Accessibility（P0 基本要求，FR-Q004）** — 地圖外提供等價角色／地點／場景清單；鍵盤可聚焦主要角色與場景；支援 Reduced Motion（包含關閉 Ambient 與 Environmental Animation、以及 Replay 自動播放）；動畫狀態不只依賴顏色；重要資訊具備可讀文字替代。完整圖表與時間軸無障礙由既有 ART-94 承接。

**NFR2-007 可測試性** — 提供 Deterministic Runtime Fixture；可在無 LLM／無外部 API 下測試 Renderer；可固定角色位置／路徑／場景與動畫狀態；Ambient Seed 可固定；Public Read-only 測試可攔截任何 mutation。

**NFR2-008 可維護性** — 至少分離：Canon Domain、Visual Runtime、Visual Binding、Public Dynamic Projection、Read-only Renderer、Editorial Overlay、Operations／Observability。

---

## 17. 產品分析事件

新增：

```text
live_view_opened
live_map_ready
live_map_failed
live_fallback_used
live_character_selected
live_scene_selected
live_arc_opened
live_episode_opened
live_camera_follow_enabled
live_camera_follow_disabled
live_zoom_used
live_runtime_stale_seen
live_return_to_town
live_replay_started
live_replay_completed
live_replay_skipped
live_replay_manual_triggered
```

**不得包含：** 私人角色資料、完整對話、Secret、Prompt、精確個人識別資訊。

ART-47 完成前，新增事件只能使用現有合規資料收集方式，不得擴大個人追蹤。

---

## 18. 成功指標

### 18.1 動態體驗指標

| 指標 | MVP 目標 |
|---|---|
| Live View 成功載入率 | ≥ 98% |
| 動態 Renderer Error Rate | < 2% |
| Public Viewer 觸發 LLM 呼叫 | 0 |
| Public Viewer 成功 Mutation | 0 |
| Runtime 至畫面更新 P95 | < 5 秒 |
| 未處理 Canon／Runtime 漂移 | 0 |
| Character Binding 覆蓋率 | 100%（12/12） |
| Location Binding 覆蓋率 | 100%（8/8） |
| Live View → Character 點擊率 | ≥ 20% |
| Live View → Episode／Arc 點擊率 | ≥ 15% |
| Replay 完成率（未跳過） | ≥ 50% |

### 18.2 既有產品指標

PRD 1.0 的首次進站、停留、回訪、投票、追蹤、前情與推薦 Episode 指標繼續保留。Dynamic Viewing 上線後須分別比較文字版與動態版的表現。

### 18.3 品質指標

| 指標 | MVP 目標 |
|---|---|
| 嚴重 Canon 衝突 | 0 |
| Event Replay 一致率 | 100% |
| Snapshot Replay 一致率 | 100% |
| 角色公開位置衝突 | 0 |
| 私人資料公開洩漏 | 0 |
| 未授權角色控制 | 0 |
| Safety 未核准文字公開 | 0 |
| Ambient 造成的 Canon 副作用 | 0 |

---

## 19. 優先級

**P0：Dynamic Viewing MVP 公開前必須完成**

- ART-99 Snapshot Bug
- **ART-139 真實 provider 場景解析缺陷**（§13.2 Regression Exception）
- FR-N001～FR-N010
- FR-O001～FR-O014
- FR-P001～FR-P004
- FR-Q001
- FR-Q004（NFR2-006 無障礙）
- FR-Q005（NFR2-002 效能 Benchmark，公開前必須通過）
- FR-Q006（§21.3 E2E 驗證套件）
- FR-Q008（§22 Release Gate）
- 受影響 PRD 1.0 P0 回歸測試

**P1：公開測試期間需要**

- FR-Q002
- FR-Q003／ART-100
- FR-Q007（§17 分析事件；未完成前 §18.1 相關指標標示為「未量測」）
- ART-11、27、28、32、36、39、44、45、46、47、52、58、59、73、76、88、89、90、91、94
- Dynamic Live 的品質優化、自動鏡頭與營運工具

**P2：後續版本**

- ART-71 登入觀眾追蹤與跨裝置進度（若原 Task 優先級較高則保留原值）
- 多世界、使用者建立世界、語音廣播、自動短影片、原生 App、進階劇透模式、大規模背景居民

> 既有 Task 的實際 Priority 不得僅因本表自動降低；重新盤點時取「原 Task Priority」與「本 PRD 要求」中較高者。

---

## 20. 實作里程碑

**Milestone V2-0：Baseline and Audit** — 確認 PRD 1.0 完成基線；建立 24 延後需求與 23 Task 的映射；完成上游視覺能力與素材授權稽核；確認不重複建立既有 Task。
*完成標準：* 產出 V2 Requirement Matrix，每個 Requirement 標示 Existing／New／Carry Forward／Blocked／Superseded；視覺元件可實際啟動。

**Milestone V2-1：Mistwood Map and Binding** — `data/mistwood.ts`；Character Visual Binding（12）；Location Visual Binding（8）。
*完成標準：* 八個地點語意相符；12 位角色具穩定視覺識別。

**Milestone V2-2：Read-only Renderer and Runtime** — 停用 a16z 伺服器端引擎；建立 Read-only Pixi World；建立輕量 Visual Runtime 與 Public Dynamic Projection。
*完成標準：* 地圖與固定 Fixture 角色可顯示；公開瀏覽期間 mutation 與 LLM 呼叫皆為 0。

**Milestone V2-3：Canon-driven Motion and Sync** — Canon／Runtime Sync；Movement Phase；Runtime Snapshot。
*完成標準：* Character Location Change 可正確呈現為跨地點移動；漂移與錯誤可觀測。

**Milestone V2-4：Ambient, Environment and Replay** — Ambient Movement；Environmental Animation；Visual Replay；時間狀態標示。
*完成標準：* 世界在無新 Canon 事件時仍具生命感；Replay 不觸發 LLM；時間狀態誠實可辨。

**Milestone V2-5：Dynamic Live Vertical Slice** — `/live` 完整切片：地圖、角色動畫、Active Scene、角色卡、Story Overlay、桌面與行動版。
*完成標準：* Browser E2E 通過；無世界寫入；可展示一個完整場景從移動、交談到事件摘要的流程。

**Milestone V2-6：Editorial Integration** — 首頁動態入口；Live／Episode／Character／Arc 導航連續；統一視覺設計；Publication／Safety 整合。

**Milestone V2-7：Release Readiness** — 修復 ART-99；完成效能／降級／安全／授權／E2E 與回歸測試；完成公開測試 Gate。
*完成標準：* 所有 V2 P0 有驗證證據；Public Mutation 為 0；Viewer-triggered LLM 為 0。

**Milestone V2-8：P1 Enhancement** — 依依賴與價值執行 22 個非 ART-99 的既有 To Do Task，不因 V2 新建重複項目。

---

## 21. 測試策略

### 21.1 單元測試

Character／Location Binding Validation、Public Projection Field Whitelist、Movement Phase Transition、Zone Arrival Detection、Sequence 與 Idempotency、Runtime Snapshot Selection、Publication／Safety Filtering、Reduced Motion 與降級決策、**Ambient Seed 決定性**、**Ambient Zone 邊界**、**Replay Step 建構**。

### 21.2 整合測試

Canon 角色位置變更後 Runtime 角色移動至正確 Zone；移動途中顯示前往中、到達後顯示正確地點；Runtime 失敗不修改 Canon；Public Viewer 不建立 Human Player／不送出 Heartbeat／不增加 LLM Trace；Active Scene 僅顯示 Published 內容；Withheld 對話不公開但角色仍可顯示交談狀態；Stream 中斷後使用最後有效 Snapshot；Snapshot 恢復後不倒退 Sequence；ART-99 修復後每日 Snapshot 穩定產生；Episode 與 Live Scene 可互相導覽；**Ambient Movement 不產生任何 Accepted Event**；**Replay 不產生任何 LLM Trace**。

### 21.3 Browser E2E

`/live` 可載入地圖；至少 4 位 Fixture 角色可見、公開驗收環境 12 位；角色可從 A 點平滑移動至 B 點；Idle／Walking／Speaking／Thinking 狀態可辨識；點擊角色顯示角色卡；點擊 Active Scene 聚焦並顯示摘要；可拖曳／縮放／返回全鎮；行動版 Bottom Sheet 可用；**Replay 自動播放一次後進入 Ambient**；**手動重播可觸發**；所有 Network Request 不包含未授權 Mutation；測試期間 LLM Call Count 不增加。

### 21.4 效能測試

12、20、40 個可視角色；桌面與中階行動裝置；正常 Stream／延遲 Stream／Snapshot／降級模式；長時間運作至少 8 小時不出現持續記憶體成長。

### 21.5 安全測試

嘗試從公開 API 送出角色控制輸入；嘗試讀取私人對話／記憶／Secret／Prompt 與 Trace；嘗試偽造 characterId／worldId／runtimeSequence；確認 Server-side Authorization 拒絕請求；確認 UI 隱藏不是唯一安全措施。

### 21.6 可理解性測試

首次進站 30 秒內可回答：哪個地點正在發生主要事件？哪些角色涉及其中？目前主要 Story Arc 是什麼？
3 分鐘內可：開啟一位核心角色、開啟一個 Active Scene、進入推薦 Episode 或前情提要。

---

## 22. Dynamic Viewing MVP 公開驗收標準

只有全部符合才可宣稱 PRD 2.0 MVP 完成：

1. PRD 1.0 已完成 P0 仍保持通過。
2. ART-99 已修復並具固定 Seed 回歸測試。
3. `/live` 顯示可操作視角但不可控制世界的 2D 地圖。
4. **全部 12 位角色**具有有效 Visual Binding。
5. **全部 8 個 Mistwood 正式地點**具有有效 Location Binding，且地圖語意相符。
6. Canon 位置變化可顯示為平滑跨地點移動。
7. Idle／Walking／Speaking／Thinking 或等價狀態可辨識。
8. Ambient Movement 在 Zone 內運作且零 Canon 副作用。
9. Visual Replay 可自動播放一次並可手動觸發，不呼叫 LLM。
10. 時間狀態「重播／稍早／現在」明確可辨。
11. Active Scene 在地圖與 Story Overlay 同步顯示。
12. 點擊角色可查看公開角色卡。
13. 點擊場景可查看公開摘要。
14. 公開觀看不送出 Heartbeat。
15. 公開觀看不建立 Human Player。
16. 公開觀看不執行任何成功 Mutation。
17. 公開觀看不增加 LLM 呼叫。
18. 公開 Projection 不包含私人資料。
19. Canon／Runtime 漂移可偵測且無未處理重大衝突。
20. Runtime 中斷時可使用最後有效 Snapshot。
21. Renderer 失敗時可降級且歷史內容仍可讀。
22. 桌面與行動版 E2E 通過。
23. Reduced Motion 與非地圖替代檢視可用。
24. 素材 License 與 Attribution 完整。
25. Public Authorization Audit 通過。
26. Typecheck、Lint、Tests、Build 與 CI 全部通過。
27. 所有 V2 P0 Requirement 具有 Task 與客觀驗證證據。
28. Closure Matrix 不得再以「核心後端完成」宣稱整體產品 MVP 完成。
29. **ART-139 已修復**，真實 provider 可產生 Accepted Event，並具回歸測試（§13.2）。
30. **動態層效能固定 Benchmark 已建立並實際通過**（FR-Q005 / NFR2-002）；未通過前不得宣稱 MVP 完成。
31. **Visual Replay 只引用已發布內容識別碼與 `publicationVersion`**，且來源被 Withhold 或 Supersede 時同步失效（FR-O013 / FR-P004）。

---

## 23. 主要風險

**RISK2-001 Canon 與 Runtime 漂移** — 緩解：Character／Location Binding、Movement Phase、Zone Arrival Confirmation、Sequence Check、Mismatch Alert、最後有效 Snapshot。

**RISK2-002 公開觀看意外啟動模擬** — 緩解：Read-only Renderer、不掛載 Heartbeat、停用 a16z 伺服器端引擎、Server-side 拒絕 Viewer Input、Viewer-triggered LLM／Mutation 指標。

**RISK2-003 私人資料從 Runtime 洩漏** — 緩解：Public Projection 欄位白名單、Publication／Safety Filter、Contract Test、Authorization Audit。

**RISK2-004 動態層效能不足** — 緩解：Sprite 重用與批次渲染、可視區更新、降低非核心角色更新率、行動裝置品質分級、Snapshot 與增量投影。

**RISK2-005 上游視覺元件與新 Domain 耦合** — 緩解：Binding Adapter、Read-only Renderer 邊界、不讓 Pixi 元件直接讀 Canon Write Store、保留可替換 Renderer Interface。

**RISK2-006 產品仍像技術 Demo** — 緩解：Mistwood 專屬地圖（語意相符建築）、Story Overlay、Current Situation、Active Scene 聚焦、Live／Episode／Character／Arc 連續導航、統一視覺系統。

**RISK2-007 Snapshot 基礎不穩** — 緩解：ART-99 提升 P0、固定 Seed Regression、Snapshot／Replay 一致性 Gate。

**RISK2-008 Ambient 稀釋敘事可信度（PRD 2.0 新增）** — 風險：觀眾把環境活動誤解為正式劇情。緩解：Ambient 限制在 Zone 內、視覺上與 Canon-driven Movement 可區分、狀態文字只由 Canon 決定、時間狀態標示（FR-O014）。

**RISK2-009 Replay 被誤認為即時（PRD 2.0 新增）** — 緩解：FR-O014 時間狀態標示、每 Session 最多自動播放一次、可隨時跳過、Replay 期間持續顯示重播標示。

---

## 24. 已確定產品決策

以下不需要在 Task 拆解時重新詢問：

1. 產品主要體驗必須會動。
2. 動態形式為既有 AI Town 風格的 2D 地圖與角色 Sprite。
3. 觀眾不能控制角色。
4. 觀眾不能與角色自由即時聊天。
5. Live Town 與 Episode／Story 同時存在，互相補充。
6. 不導入圖片生成模型。
7. 優先重用現有 PixiJS、Tilemap、Sprite 與動畫。
8. 不重寫已完成 Canon、Simulation、Story Arc 與 Episode 核心。
9. Canon 管理語意事實；Visual Runtime 管理座標與動畫。
10. 公開觀看不得觸發 LLM、Heartbeat 或 Simulation Input。
11. 公開客戶端只讀 Public Dynamic Projection。
12. 私人對話、記憶、Secret、Prompt 與管理資料不得公開。
13. Runtime 失敗時保留最後有效狀態並降級。
14. 3D、電影級動畫與玩家控制不在 MVP。
15. ART-99 是 PRD 2.0 上線阻斷項目。
16. 既有 23 個 To Do Task 沿用原 ID，不建立重複 Task。
17. PRD 1.0 Completion 保留為 Core Platform Baseline，不代表 PRD 2.0 產品完成。
18. **維持 1 世界日 = 1 真實日、每天 5 個 Canon 時段；不得加快 Canon 世界時鐘。**
19. **動態由 Canon-driven Movement、Ambient Movement、Environmental Animation、Visual Replay 四層組成；只有 Canon-driven Movement 表達語意位置變化。**
20. **停用 a16z 伺服器端模擬引擎（aiTown 生命週期、agent 推理、heartbeat、Human Player、相關 cron），只抽取視覺能力。**
21. **建立 `data/mistwood.ts` 專屬地圖；不得用標籤掩蓋語意不符的場景。**
22. **FR-N005 P0 驗收由「至少六個地點」改為「全部八個 Mistwood 正式地點」。**
23. **12 位角色採「既有 Sprite ＋ Palette Variant ＋ 固定名牌」；不得對整個 Sprite 套單一 Tint；第一版不導入外部素材或圖片生成模型。**

---

## 25. Backlog 重新建立與拆解規則

### 25.1 第一步：建立 Requirement Matrix

每個 PRD 2.0 Requirement 必須標記：

```text
requirementId
status: Existing | New | Carry Forward | Blocked | Superseded
existingTaskIds
newTaskIds
evidence
impactAreas
dependencies
```

### 25.2 第二步：去重

- 先搜尋現有 Backlog Task 標題、描述、Acceptance Criteria 與相關 Requirement ID。
- 有既有 Task 可承接時更新該 Task，不建立新 ID。
- 23 個已列出的 To Do Task 必須優先沿用。
- 已完成 PRD 1.0 Task 只有在需要修改時才建立增量 Task，不得重新開啟整個 Epic。

### 25.3 新 Task 第一層 Epic

```text
V2-A Visual Capability Audit
V2-B Mistwood Map and Visual Binding
V2-C Read-only Renderer and Engine Retirement
V2-D Visual Runtime and Public Dynamic Projection
V2-E Canon Runtime Synchronization
V2-F Dynamic Live Experience
V2-G Ambient, Environment and Replay
V2-H Editorial Integration
V2-I Dynamic Operations and Observability
V2-J Accessibility Performance and Security
V2-K Dynamic MVP Release Readiness
```

### 25.4 拆解順序

```text
ART-99
→ Requirement Matrix
→ 上游視覺層稽核
→ Mistwood 地圖與 Binding
→ Read-only Visual Runtime
→ Canon-driven Movement
→ Ambient / Environmental Animation
→ Visual Replay
→ Story / Character Overlay
→ 響應式與 E2E
→ Dynamic MVP Release Gate
→ Carry-forward P1／P2 Tasks
```

ART-99 可與 Visual Audit 並行，但必須在 Dynamic MVP Release Gate 前完成。

### 25.5 每個 Task 必須包含

Requirement ID、Problem／Context、Goal、Scope、Out of Scope、Dependencies、Schema Impact、API Impact、Security Impact、Acceptance Criteria、Test Requirements、Validation Commands、Documentation Impact、Definition of Done。

### 25.6 Task 大小

- 每個 Task 不得大於一個可審查 PR。
- Renderer、Projection、Binding、Sync、UI 與測試不得全部塞入單一 Task。
- 垂直切片可以由多個相依 Task 組成，但必須有一個整體 E2E Task。
- 不得以「完成 Live View」建立無法客觀驗證的大型 Task。

### 25.7 完成定義

Task 只有在以下全部成立時才可 Done：

- Acceptance Criteria 逐條有證據
- Typecheck、Lint、Tests、Build 通過
- 新增或修改行為具有自動化測試
- 公開觀看零 Mutation、零 Viewer-triggered LLM 已驗證
- Requirement Matrix 與 Closure Matrix 已更新
- 文件與程式實際行為一致
- 無 Critical／High 安全缺陷

---

## 26. PRD 2.0 完成狀態用語

在 Dynamic Viewing MVP 完成前，只能使用：

> PRD 1.0 historical closure complete; current baseline has open release-blocking regressions ART-99 and ART-139. PRD 2.0 Dynamic Viewing MVP In Progress.

**不得**只寫「PRD 1.0 Core Simulation and Backend Baseline Complete」——那描述的是歷史封閉，不是目前基線的健康狀態，會掩蓋兩個未關閉的發布阻斷缺陷（§13.3）。

ART-99 與 ART-139 關閉後、Dynamic Viewing MVP 尚未全部通過前：

> PRD 1.0 baseline healthy; PRD 2.0 Dynamic Viewing MVP In Progress.

Dynamic Viewing MVP 全部 P0 通過後（含 §22 全部 31 條），才可使用：

> AI Reality Town PRD 2.0 MVP Complete and Ready for Public Test.
