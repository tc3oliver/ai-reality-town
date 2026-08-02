---
id: doc-1
title: AI Reality Town PRD 1.0
type: specification
created_date: '2026-08-02 15:27'
updated_date: '2026-08-02 15:27'
tags:
  - prd
  - '1.0'
  - mistwood
---
# AI Reality Town 產品需求文件

**文件版本：** PRD 1.0
**產品名稱：** AI Reality Town
**初始世界代號：** Mistwood
**產品階段：** MVP／公開測試準備
**文件用途：** 產品需求來源、Backlog 拆解依據、驗收與需求追蹤基準
**目標讀者：** Product、Engineering、Design、QA、Operations、Content Safety

---

# 1. 產品摘要

AI Reality Town 是一個持續運作的虛構社會與互動式實境節目。

世界中存在固定的居民、家庭、地點、組織、資產、關係、秘密與歷史。居民會依據自己的個性、目標、記憶、認知與當前環境採取行動，逐步形成合作、戀愛、背叛、競爭、失蹤、犯罪、選舉、創業、謠言與其他社會事件。

觀眾不是直接操控角色，也不是與聊天機器人進行一次性對話。觀眾的主要行為是：

* 觀看目前正在發生的事件。
* 追蹤角色與 Story Arc。
* 閱讀每日集數與前情提要。
* 探索角色關係與世界歷史。
* 透過有限投票向世界注入環境事件。
* 觀察這些事件如何產生非預寫的後續影響。

產品必須同時解決三個核心問題：

1. **世界必須長期一致。**
   角色不能無故取得資訊、瞬間移動、死而復生或忘記重要歷史。

2. **故事必須值得持續觀看。**
   世界不能只產生大量寒暄與隨機事件，必須形成可理解、有推進、有收束的 Story Arc。

3. **新觀眾必須隨時能加入。**
   即使世界已運行數月，新觀眾仍應在 30 秒內理解現在發生什麼，並在 3 分鐘內開始觀看。

---

# 2. 產品願景

建立一個會自行累積歷史、角色會記得過去、決策具有長期後果，且觀眾可持續追蹤的 AI 虛構世界。

理想體驗：

> 我昨天看到記者公開一份文件，今天鎮長失蹤了。

> 我一週沒看，回來後三分鐘就知道哪些人物決裂、哪條主線進入高潮。

> 觀眾投票選擇的停電沒有直接指定結果，卻在數日後間接造成一場失蹤案。

> 角色不是依劇本演出，但他們的行動仍符合自己的經歷、目標與已知資訊。

---

# 3. 產品定位

## 3.1 對外定位

AI Reality Town 是：

* 持續運作的 AI 虛構社會。
* 可觀看的互動式實境節目。
* 具有角色、集數、主線與前情提要的連續內容。
* 可以探索歷史與關係的活世界。

AI Reality Town 不是：

* 一般聊天機器人。
* 單次 AI 角色扮演。
* 純技術 Agent Demo。
* 讓觀眾直接控制 NPC 的遊戲。
* 真實人物或真實社會的預測模擬器。
* 完全自由、沒有世界規則的生成內容平台。

## 3.2 核心產品承諾

對觀眾：

> 你不需要理解整個世界，只需要理解眼前這一集。

對世界：

> 已經發生的事情永遠算數。

對角色：

> 角色只能依據自己知道、相信與記得的事情行動。

---

# 4. 問題定義

## 4.1 現有 AI 社會模擬常見問題

現有多 Agent 或 AI Town 類型專案通常重視：

* 角色移動。
* Agent 對話。
* 即時生成。
* 技術展示。
* 模型自主性。

但缺少：

* 不可變的世界歷史。
* 嚴格的角色知識權限。
* 可驗證的因果關係。
* 劇情主線生命週期。
* 舊支線收束。
* 新觀眾導覽。
* 面向觀眾的內容編輯。
* 公開營運與內容安全能力。

結果容易出現：

* 角色反覆寒暄。
* 對話與事件高度重複。
* 角色突然知道不應知道的秘密。
* 不合理的人格轉變。
* 世界設定前後矛盾。
* Story Arc 持續增加卻不結束。
* 世界越久越難加入。
* 觀眾看見大量資訊，但不知道什麼重要。

## 4.2 觀眾端問題

觀眾不會因為「有很多 Agent」而長期回訪。

觀眾持續觀看的原因會是：

* 關心某個角色。
* 想知道某個未解問題的結果。
* 想看某段關係如何改變。
* 想知道觀眾投票造成什麼後果。
* 每次回來都有明確的新進展。

如果觀眾首次進站就看到：

* 20 位角色。
* 數百筆事件。
* 完整關係圖。
* 長篇世界背景。
* 不知道從哪裡開始的時間線。

觀眾很可能直接離開。

---

# 5. 產品目標

## 5.1 MVP 產品目標

MVP 必須提供一個可長期運作且可公開觀看的世界：

1. 一個公開世界。
2. 12–20 位主要角色。
3. 6–10 個主要地點。
4. 每位主要角色具有穩定 Persona、目標、關係、秘密與記憶。
5. 每個世界日產生可追溯的事件。
6. 同時維持 1–3 條主要 Active Story Arc。
7. 所有 Canon 變化均可重播與稽核。
8. 每個世界日產生一集觀眾可閱讀的 Episode。
9. 新觀眾可在 30 秒內理解目前主線。
10. 回訪觀眾可快速理解離開期間的變化。
11. 觀眾可每日投票選擇一項環境事件。
12. 系統可連續模擬至少 30 個世界日，不產生嚴重一致性錯誤。
13. 公開觀看流量不得直接增加 LLM 生成量。
14. 模擬引擎失敗時，既有公開內容仍可正常閱讀。

## 5.2 產品驗證目標

MVP 應驗證：

* 新觀眾能否快速理解世界。
* 角色是否能形成可持續關注。
* Story Arc 是否能自然推進與收束。
* 每日內容是否能帶來回訪。
* 觀眾是否願意投票。
* 觀眾是否願意追蹤角色或主線。
* 長期歷史是否增加世界價值，而不是增加理解負擔。

## 5.3 技術與營運目標

* LLM 只能提出事件，不得直接修改 Canon State。
* 所有世界狀態變更必須經過驗證。
* 事件必須具備 Idempotency。
* 世界狀態必須可由 Snapshot 與 Event Replay 重建。
* 摘要不得每次重新載入完整歷史。
* 公開 Read Model 與模擬寫入流程必須分離。
* 模型、Prompt 與輸出必須可追蹤。
* 管理者必須能暫停、重試、修正與回滾。
* 不適當內容不得直接公開。

---

# 6. 非目標

MVP 不包含：

* 3D 世界。
* 高品質即時動畫。
* 即時語音對話。
* 觀眾自由與所有角色聊天。
* 觀眾直接指定角色行動結果。
* 觀眾建立自己的世界。
* 多個公開世界。
* 100–200 位完整 LLM 角色。
* 真實人物模擬。
* 真實新聞預測。
* 完整經濟學模擬。
* 完整政治制度模擬。
* 原生 iOS 或 Android App。
* 使用者產生未審核角色內容。
* 區塊鏈、NFT 或虛擬資產交易。
* Production 級付費系統。
* 自動將未審核內容發布到外部社群。

---

# 7. 目標使用者

## 7.1 新觀眾

首次進站，完全不了解世界歷史。

主要需求：

* 立即知道現在發生什麼。
* 知道為什麼重要。
* 知道需要認識哪些角色。
* 不需要從第一集開始閱讀。
* 獲得一個明確的觀看入口。

成功條件：

* 30 秒內可以回答「現在發生什麼」。
* 3 分鐘內可以辨認 3–4 位核心人物。
* 可以選擇一條想繼續追蹤的主線。

## 7.2 回訪觀眾

曾觀看過，但可能離開一日或數日。

主要需求：

* 知道離開期間發生哪些重要變化。
* 知道自己追蹤角色的最新狀態。
* 知道 Story Arc 是否有重大進展。
* 知道投票事件產生哪些已知影響。

## 7.3 深度觀眾

願意探索人物、秘密、關係與歷史。

主要需求：

* 完整人物頁。
* 關係變化歷史。
* Story Arc 時間線。
* 世界重大事件。
* 公開事實與角色認知差異。
* 推薦相關 Episode。

## 7.4 營運管理者

負責模擬品質、安全與發布。

主要需求：

* 暫停與恢復模擬。
* 重試失敗場景。
* 查看 Proposed Event。
* 查看驗證失敗原因。
* 拒絕或隔離不適當內容。
* 建立修正事件。
* 回滾至指定 Snapshot。
* 查看 Token、延遲、失敗率與品質指標。
* 調整模型、Prompt 與每日預算。

---

# 8. 產品體驗原則

## UX-001 先展示現在，不先解釋歷史

首頁首先呈現目前重大事件，而不是世界設定或完整角色列表。

## UX-002 只呈現理解當前事件需要的資訊

新觀眾預設只看到：

* 一條主要 Story Arc。
* 最多四位核心角色。
* 三項必要前情。
* 一個推薦入坑點。

## UX-003 深度資訊逐層揭露

資訊層級：

```text
30 秒 Current Situation
→ 3 分鐘前情提要
→ Episode
→ Character／Story Arc
→ Relationship／Timeline
→ 完整世界歷史
```

## UX-004 世界很大，但目前重點必須清楚

即使世界中有多條支線，首頁仍只突出最重要的 1–3 條。

## UX-005 觀眾影響環境，不控制結果

觀眾可以製造壓力、資源或環境變化，但不能命令角色完成特定劇情。

## UX-006 技術不應成為主要展示內容

公開頁面不以 Token、Agent 數量、模型名稱或 Prompt 為主。

---

# 9. 核心概念

## 9.1 World

一個完整、持續運作的虛構世界。

包含：

* 世界時間。
* 地點。
* 角色。
* 組織。
* 物品與資產。
* Canon Facts。
* Character Knowledge。
* Memories。
* Relationships。
* World Events。
* Story Arcs。
* Episodes。
* Recap Snapshots。
* Viewer Interventions。

## 9.2 Character

世界中的居民。

每位主要角色包含：

* 公開身分。
* 私人背景。
* Personality Traits。
* Values。
* Public Goal。
* Private Goal。
* Fear。
* Secret。
* Behavior Rules。
* Relationships。
* Known Facts。
* Beliefs。
* Memories。
* Assets。
* Current State。

## 9.3 Canon Fact

世界中已被系統確認的客觀事實。

例如：

* 帳本位於車站置物櫃。
* 鎮長在 Day 14 晚上到過診所。
* 林映雪不知道是誰將帳本放進置物櫃。

Canon Fact 不等於：

* 公開新聞。
* 角色記憶。
* 角色推論。
* 謠言。
* 觀眾推測。

## 9.4 Character Knowledge

角色知道、相信或懷疑的資訊。

每筆 Knowledge 必須包含：

* 角色。
* 內容。
* 來源。
* 得知時間。
* 信心程度。
* 真實性。
* 是否可分享。
* 是否已被更正。

## 9.5 Memory

角色對事件的主觀記憶。

同一事件可形成不同角色的不同記憶。

## 9.6 World Event

所有已接受世界變化的不可變紀錄。

## 9.7 Story Arc

由多個事件組成、包含核心問題與發展階段的劇情主線。

## 9.8 Episode

一個世界日的觀眾版內容。

Episode 是編輯後的內容，不是完整 Event Dump。

## 9.9 Recap Snapshot

為不同觀眾情境預先生成的摘要。

## 9.10 Viewer Secret

觀眾已經知道，但相關角色尚未知道的資訊。

此資訊用來形成戲劇張力，但必須受劇透層級控制。

---

# 10. 世界運作模式

## 10.1 公開世界時間

MVP 預設：

* 1 個現實日等於 1 個世界日。
* 每個世界日分為：

  * Morning
  * Noon
  * Afternoon
  * Evening
  * Night
* 每個時段產生 0–3 個主要場景。
* 每日結束後產生 Episode 與 Recap。

## 10.2 開發與測試模式

必須支援：

* 暫停世界時間。
* 手動推進一個時段。
* 手動推進一個世界日。
* 加速模擬。
* 使用固定 Seed 重播。
* 在不公開內容的情況下暖機世界。

## 10.3 世界暖機

公開前應先模擬 30–60 個世界日。

目的：

* 建立人物歷史。
* 建立初始關係變化。
* 產生至少一條已發展中的主線。
* 避免觀眾進入一個所有人仍在互相自我介紹的世界。

公開起點不一定是 Day 1。

系統必須標記：

* 世界實際起始日。
* 公開播出起始日。
* 推薦新觀眾入坑點。

---

# 11. 功能需求

# Epic A：世界初始化

## FR-A001 世界設定匯入

**優先級：P0**

系統應支援以結構化檔案建立世界。

必要內容：

* 世界名稱。
* 世界背景。
* 時代與技術水平。
* 地理規則。
* 社會規則。
* 法律與禁忌。
* 世界起始日期。
* 初始地點。
* 初始組織。
* 不可變世界規則。
* 初始重大歷史。

驗收條件：

1. 可從結構化設定匯入世界。
2. 匯入時執行 Runtime Schema Validation。
3. 無效參照必須被拒絕。
4. 世界建立後產生 Initial Snapshot。
5. 不可變世界規則必須可被 Canon Validator 讀取。
6. 匯入失敗不得產生部分世界。

## FR-A002 角色初始化

**優先級：P0**

每位主要角色至少包含：

* 公開背景。
* 私人背景。
* 個性特質。
* 價值觀。
* 公開目標。
* 私人目標。
* 恐懼。
* 秘密。
* 行為規則。
* 初始位置。
* 初始關係。
* 初始知識。
* 初始資產。

驗收條件：

1. MVP 至少可載入 12 位主要角色。
2. 每位角色必須具備 Public Goal 與 Private Goal。
3. 所有角色與地點參照有效。
4. 所有 Secret 必須定義初始知情者。
5. 相互關係不得產生無效或重複記錄。
6. 不得使用真實個人資料或真實人物作為預設角色。

## FR-A003 初始張力驗證

**優先級：P0**

公開世界啟動前至少存在：

* 3 組利益衝突。
* 3 個私人秘密。
* 2 組資源或債務依賴。
* 2 組錯誤認知。
* 2 組情感張力。
* 1 個全鎮共同誤解的歷史事件。
* 1 條可立即推進的主要 Story Arc。

驗收條件：

1. 缺少必要張力時，世界不得進入公開暖機。
2. 系統應產生具體缺失報告。
3. 張力檢查結果必須可由管理者查看。

## FR-A004 世界暖機

**優先級：P0**

系統應支援在非公開模式下連續模擬指定天數。

驗收條件：

1. 暖機期間內容不得出現在公開 Read Model。
2. 暖機可暫停、恢復與重跑。
3. 公開前至少產生一條 Active Story Arc。
4. 公開起始 Episode 可由系統建議並由管理者確認。
5. 暖機失敗不得污染公開資料。

---

# Epic B：角色與關係

## FR-B001 角色目前狀態

**優先級：P0**

角色狀態至少包含：

* Current Location。
* Health。
* Emotional State。
* Financial State。
* Occupation。
* Organization Membership。
* Availability。
* Alive／Active Status。

驗收條件：

1. 所有狀態變化必須由 Accepted Event 產生。
2. LLM 不得直接覆寫角色目前狀態。
3. 狀態必須可從 Replay 重建。

## FR-B002 多維關係

**優先級：P0**

角色間關係至少包含：

* Trust。
* Affection。
* Resentment。
* Fear。
* Dependency。
* Familiarity。

驗收條件：

1. 關係變化必須具有原因與來源事件。
2. 關係數值不得超出定義範圍。
3. 關係歷史必須可查詢。
4. 關係的雙向數值可以不同。
5. 關係變化不得直接暴露未公開 Secret。

## FR-B003 行為一致性

**優先級：P1**

重大行動若偏離 Persona，必須具備：

* 明確情緒變化。
* 重大事件原因。
* 目標衝突。
* 角色成長或崩潰標記。

驗收條件：

1. 高重要度人格偏離必須被標記。
2. 無原因的人格反轉必須被拒絕或送審。
3. 角色轉折應更新 Character Summary。

---

# Epic C：模擬排程與場景

## FR-C001 世界排程器

**優先級：P0**

系統應依世界時間觸發模擬工作。

驗收條件：

1. 同一世界時段不得重複執行。
2. 支援暫停、恢復與手動觸發。
3. 任務失敗可以安全重試。
4. 重試不得重複提交已接受事件。
5. 管理者可查看目前排程與執行狀態。

## FR-C002 每日 Director Plan

**優先級：P0**

Director 根據以下資料規劃場景候選：

* Active Story Arcs。
* 未解問題。
* 最近重大事件。
* 角色目標。
* 角色位置。
* 角色長期未出現狀況。
* 觀眾注入事件。
* 世界環境。
* 重複度指標。
* 劇情節奏。

輸出至少包含：

* 世界時間。
* 地點。
* 參與角色。
* Trigger。
* Dramatic Pressure。
* 可能推進的 Arc。
* 不得洩漏的資訊。
* 預期狀態變更類型。

驗收條件：

1. Director 不得直接指定最終結果。
2. 同時規劃的場景不得產生明顯時間或位置衝突。
3. 場景必須可追蹤至 Director Run。
4. 每日必須限制主要場景數量。

## FR-C003 角色行動意圖

**優先級：P0**

角色應根據自己的認知產生行動意圖。

可用輸入：

* Persona Summary。
* Current Goal。
* Emotional State。
* Relevant Memories。
* Character Knowledge。
* Available Assets。
* Current Location。
* Active Arc Context。

不得輸入：

* 角色不應知道的 Canon Secret。
* 其他角色完整私人記憶。
* 管理者註解。
* 未公開的 Viewer-only Information。

驗收條件：

1. 所有輸入均可追蹤。
2. Intent 必須結構化。
3. Intent 不得直接修改世界。
4. 不合法 Intent 必須被拒絕或降級。

## FR-C004 場景合併

**優先級：P0**

系統應將相關意圖合併成多人場景。

驗收條件：

1. 相同時段、地點與角色衝突必須被處理。
2. 不得讓角色同時參與兩個主要場景。
3. 合併結果必須保留原始 Intent 參照。
4. 每個主要場景應限制參與角色數量。

## FR-C005 場景模擬

**優先級：P0**

每個主要場景應以一次整體模擬處理，不為每位角色重複獨立生成整場對話。

輸出包含：

* Scene Summary。
* Key Actions。
* Dialogue Highlights。
* Proposed Events。
* Relationship Changes。
* Knowledge Changes。
* Memories。
* Rumors。
* Continuity Warnings。
* Safety Labels。

驗收條件：

1. 輸出必須通過 Runtime Validation。
2. 無效輸出必須可重試。
3. 場景不得直接寫入 Canon State。
4. 完整原始輸出不直接公開。
5. 高風險內容必須進入安全審核。

---

# Epic D：Canon Event Store

## FR-D001 Proposed Event

**優先級：P0**

所有模型與模擬邏輯只能產生 Proposed Event。

驗收條件：

1. Proposed Event 具備版本化 Schema。
2. 必須具有 Idempotency Key。
3. 必須標示提出來源。
4. 必須標示參與角色與因果事件。
5. 核心 State Change 不得以未定義 Payload 表示。

## FR-D002 Append-only Event Store

**優先級：P0**

所有 Accepted Event 必須不可變。

驗收條件：

1. 已接受事件不得直接修改或刪除。
2. 修正必須建立新的 Correction、Compensation 或 Retcon Event。
3. Event 必須具備單調遞增 Sequence。
4. Event 必須可追蹤至模型 Trace 或系統來源。
5. Event Store 可用於完整 Replay。

## FR-D003 Structural Validation

**優先級：P0**

驗證至少包含：

* Schema Version。
* 必填欄位。
* Event Type。
* State Change Union。
* Participant 去重。
* 有限數值。
* Idempotency Key。
* World Day。
* Summary 長度。
* 參照格式。

驗收條件：

1. 錯誤使用穩定 Error Code。
2. 不得以自由文字判斷錯誤類型。
3. 驗證失敗不得產生部分寫入。

## FR-D004 Canon Validation

**優先級：P0**

至少阻止：

* 角色瞬間移動。
* 角色同時出現在兩地。
* 死者正常參與新事件。
* 角色無來源得知秘密。
* 同一物品同時由多人持有。
* 關係來源與目標相同。
* 無原因數值變化。
* 無效 Location 或 Character。
* Sequence Conflict。
* 重複 Idempotency Key。

驗收條件：

1. 所有 P0 規則具備自動化測試。
2. 驗證拒絕原因可在管理介面查看。
3. 重試不得繞過 Canon Validation。

## FR-D005 Deterministic Reducer

**優先級：P0**

世界 Projection 必須由純函式 Reducer 產生。

驗收條件：

1. Reducer 不讀取資料庫或外部 API。
2. Reducer 不讀取目前時間。
3. Reducer 不使用未固定的亂數。
4. 相同輸入必須得到相同輸出。
5. 不支援的 Event Version 必須明確失敗。
6. Sequence Gap 必須明確失敗。

## FR-D006 Snapshot 與 Replay

**優先級：P0**

驗收條件：

1. 至少每日建立 Snapshot。
2. 可從 Initial State 完整 Replay。
3. 可從 Snapshot 加後續 Event Replay。
4. 完整 Replay 與 Snapshot Replay 結果一致。
5. 30 個世界日內 Replay 一致率為 100%。
6. 回滾不得刪除歷史。

---

# Epic E：角色知識、記憶與謠言

## FR-E001 Character Knowledge

**優先級：P0**

角色只能透過以下來源取得資訊：

* 親自觀察。
* 他人告知。
* 公開內容。
* 文件或證據。
* 合理推論。
* 既有記憶。

驗收條件：

1. 每筆 Knowledge 具有來源。
2. 每筆 Knowledge 標記 Truth Status。
3. 角色不得存取未授權資訊。
4. Knowledge 更新必須由 Event 產生。

## FR-E002 主觀記憶

**優先級：P0**

同一事件應可對不同角色產生不同記憶。

記憶至少包含：

* Content。
* Source Event。
* Interpretation。
* Importance。
* Emotional Weight。
* Confidence。
* Visibility。
* Created Time。

验收條件：

1. 角色記憶與 Canon Fact 分離。
2. 記憶可包含誤解。
3. 記憶必須可追蹤至事件。
4. 私人記憶不得直接公開。

## FR-E003 記憶檢索

**優先級：P0**

角色推理只取得最相關記憶。

排序至少考慮：

* Semantic Relevance。
* Importance。
* Recency。
* Emotional Weight。
* Story Arc Relevance。

驗收條件：

1. 每次檢索有數量上限。
2. 檢索結果可追蹤。
3. 不得將完整歷史放入每次 Prompt。
4. 不得返回角色無權取得的記憶。

## FR-E004 記憶壓縮

**優先級：P1**

舊記憶應壓縮為：

* 長期印象。
* 穩定信念。
* 角色關係摘要。
* Story Arc 理解。
* 地點經驗。

驗收條件：

1. 原始 Event 仍保留。
2. 壓縮不得改變 Canon。
3. 壓縮後角色仍能回想高重要度事件。
4. 壓縮失敗不得刪除原始記憶。

## FR-E005 謠言傳播

**優先級：P1**

謠言必須記錄：

* 原始來源。
* 傳播鏈。
* 當前版本。
* 可信程度。
* 客觀真假。
* 已知更正。

驗收條件：

1. 謠言不得自動轉為 Canon Fact。
2. 不同角色可相信不同版本。
3. 謠言傳播必須由 Event 表示。

---

# Epic F：Story Arc Engine

## FR-F001 Arc 建立與歸類

**優先級：P0**

每個重要事件後，系統判斷：

* 是否屬於既有 Arc。
* 是否建立新 Arc。
* 對 Arc 的重要程度。
* Event Role。
* 核心人物是否變化。

Event Role：

* Inciting Incident。
* Development。
* Escalation。
* Turning Point。
* Climax。
* Resolution。
* Aftermath。

驗收條件：

1. Event 可屬於多條 Arc，但主要 Arc 數量有限。
2. Arc 建立必須有明確 Premise 與 Current Question。
3. 低重要度事件不得任意建立新 Arc。

## FR-F002 Arc 狀態

**優先級：P0**

狀態：

* Emerging。
* Active。
* Escalating。
* Climax。
* Resolving。
* Resolved。
* Archived。

驗收條件：

1. 狀態轉換必須符合明確規則。
2. Resolved Arc 不應持續被當作主要活躍上下文。
3. Archived Arc 仍可由歷史查詢。

## FR-F003 Arc 資料

**優先級：P0**

每條 Arc 至少維護：

* Title。
* Premise。
* Current Question。
* Status。
* Core Characters。
* Inciting Event。
* Latest Turning Point。
* Essential Facts。
* Unresolved Questions。
* Resolved Questions。
* Recommended Entry Point。
* Heat Score。
* Last Progress Time。

## FR-F004 Arc 數量控制

**優先級：P0**

MVP 限制：

* 主要 Active Arc：最多 3。
* 次要 Active Arc：最多 6。
* 每條主要 Arc 核心角色：最多 6。
* 單一 Event 直接推進主要 Arc：最多 2。

驗收條件：

1. 超過上限時必須合併、降級或拒絕。
2. 首頁預設只展示最高優先級 Arc。
3. Arc 數量控制不得刪除 Event。

## FR-F005 Arc 收束

**優先級：P0**

長期未發展或重複的 Arc 應被處理。

可採取：

* 建議結局。
* 合併。
* 降級。
* 進入 Resolving。
* Archived。
* 壓縮為背景事實。

驗收條件：

1. 14 個世界日未進展時產生提示。
2. 重大 Arc 不得無故消失。
3. Resolved Arc 必須留下 Outcome 與 Consequences。
4. 收束後更新相關角色與世界摘要。

## FR-F006 Arc Heat Score

**優先級：P1**

分數至少考慮：

* 最近事件重要性。
* 未解張力。
* 核心人物關注度。
* 觀眾互動。
* 新鮮度。
* 是否接近高潮。

驗收條件：

1. Score 計算可追蹤。
2. 首頁排序不得完全由 LLM 自由決定。
3. 管理者可查看分數構成。

---

# Epic G：Episode 與編輯層

## FR-G001 每日 Episode

**優先級：P0**

每個世界日結束後產生一個 Episode。

內容至少包含：

* Episode Number。
* Title。
* Headline。
* One-line Summary。
* 3–5 個關鍵場景。
* 關係變化。
* 新增問題。
* 已解決問題。
* 相關 Arc。
* 相關角色。
* Next Episode Tease。

驗收條件：

1. Episode 只能使用 Accepted Event。
2. 高重要度事件必須被涵蓋。
3. 不得將未公開 Canon Secret 誤放入公開內容。
4. Episode 生成失敗不影響 Canon State。

## FR-G002 摘要金字塔

**優先級：P0**

摘要層級：

```text
Raw Event
→ Scene Summary
→ Episode Summary
→ Arc Summary
→ Season Summary
→ Viewer Context
```

驗收條件：

1. 高層摘要可追蹤來源事件。
2. 更新時優先使用前一版摘要與新增事件。
3. 不得每次讀取完整世界歷史。
4. 摘要可重新生成，但不得改變 Canon。

## FR-G003 三層 Episode 摘要

**優先級：P0**

每個 Episode 產生：

* Quick Recap：80–150 中文字。
* Standard Recap：400–800 中文字。
* Deep Recap：完整因果與事件列表。
* Machine Summary：結構化資料。

Machine Summary 至少包含：

* What Changed。
* Why It Happened。
* Who Is Affected。
* New Questions。
* Resolved Questions。
* Required Prior Facts。
* Story Arc Progress。

## FR-G004 摘要覆蓋驗證

**優先級：P1**

驗收條件：

1. 所有高重要度 Event 均被摘要涵蓋或明確排除。
2. 重大關係變化必須被提及。
3. Arc Turning Point 必須被提及。
4. Spoiler Violation 必須被偵測。

## FR-G005 地方新聞與內容格式

**優先級：P1**

系統可從 Episode 產生：

* 地方新聞。
* 社群短文。
* 分享卡文案。
* 明日預告。

驗收條件：

1. 衍生內容不得產生新 Canon。
2. 必須標記來源 Episode。
3. 不適當內容不得自動外部發布。

---

# Epic H：新觀眾導覽

## FR-H001 Current Situation

**優先級：P0**

首頁應預先產生目前世界的入口摘要。

內容：

* 目前重大事件。
* 為什麼重要。
* 最多四位核心人物。
* 三項必要前情。
* 一個核心問題。
* 推薦 Episode。
* 目前最值得看的場景。

驗收條件：

1. 主要內容不超過約 300 中文字。
2. 不顯示完整世界歷史。
3. 主線重大變化後自動更新。
4. 結果必須快取。
5. 每位訪客讀取不得觸發 LLM。

## FR-H002 三分鐘前情提要

**優先級：P0**

內容應涵蓋：

* Arc 起因。
* 最近重大轉折。
* 核心人物角色。
* 當前未解問題。

驗收條件：

1. 閱讀時間約 2–4 分鐘。
2. 僅包含理解目前主線所需內容。
3. 不得要求從 Episode 1 開始。

## FR-H003 推薦入坑點

**優先級：P0**

每條 Active Arc 應維護 Recommended Entry Episode。

判斷條件：

* 核心人物已登場。
* 包含明確轉折。
* 理解成本低。
* 距離目前進度不過遠。
* 不依賴過多已封存支線。

验收條件：

1. 每條主要 Active Arc 必須有推薦入坑點。
2. 推薦原因可查詢。
3. Arc 重大變化後重新評估。

## FR-H004 回訪摘要

**優先級：P1**

系統根據最後觀看 Episode 產生：

* 離開期間重大事件。
* 追蹤角色變化。
* 追蹤 Arc 進展。
* 投票事件後果。
* 推薦繼續觀看點。

驗收條件：

1. 不逐日完整列出所有事件。
2. 優先顯示使用者追蹤內容。
3. 無登入使用者可使用裝置層級進度。

## FR-H005 劇透控制

**優先級：P2**

模式：

* Full Viewer Perspective。
* Public Information Only。
* Watched Episodes Only。

MVP 可不實作，但資料模型不得阻止後續支援。

---

# Epic I：公開觀看介面

## FR-I001 首頁

**優先級：P0**

首頁區塊：

* 世界名稱與世界日。
* Current Situation。
* Core Characters。
* Essential Backstory。
* Recommended Episode。
* Live Entry。
* Current Vote。
* Latest Major Event。

驗收條件：

1. 首屏優先展示目前重大事件。
2. 不在首屏展示完整關係圖。
3. 不以 Agent、Token 或模型資訊為主。
4. 行動裝置可正常閱讀。

## FR-I002 Live View

**優先級：P0**

Live View 顯示：

* 簡化小鎮地圖或地點列表。
* 角色目前位置。
* 活躍場景。
* 最近事件。
* 世界時間。
* Active Arc。

驗收條件：

1. 不要求高品質遊戲動畫。
2. 場景內容以摘要與精華為主。
3. 公開讀取不得觸發生成。
4. 模擬暫停時仍可瀏覽最後狀態。

## FR-I003 Episode 頁面

**優先級：P0**

支援：

* Quick／Standard／Deep Recap。
* 關鍵場景。
* 相關角色。
* 相關 Arc。
* 前一集／下一集。
* 推薦延伸閱讀。

## FR-I004 Episode 列表

**優先級：P0**

支援：

* 依日期瀏覽。
* 依 Arc 篩選。
* 依角色篩選。
* 標記 Turning Point。
* 標記 Recommended Entry。

## FR-I005 Character 頁面

**優先級：P0**

公開內容：

* 姓名與圖像。
* 年齡與職業。
* 公開背景。
* 目前狀態。
* 公開目標。
* 主要關係。
* 最近重大事件。
* 所屬 Arc。
* 觀眾已知秘密。
* 角色不知道但觀眾知道的資訊。

不得公開：

* 未揭露 Canon Secret。
* 完整私人記憶。
* Prompt。
* 原始模型輸出。
* 管理者註解。

## FR-I006 Story Arc 頁面

**優先級：P0**

顯示：

* Title。
* Premise。
* Current Question。
* Status。
* Core Characters。
* Essential Backstory。
* Inciting Event。
* Latest Turning Point。
* Recommended Entry。
* Related Episodes。
* Known Clues。
* Unresolved Questions。
* Outcome，若已解決。

## FR-I007 關係圖

**優先級：P1**

預設只顯示：

* 當前 Arc 核心人物。
* 一階關係。
* 最近七日有變化的關係。

支援：

* 日期切換。
* 關係類型篩選。
* 人物摘要。
* 關係變化原因。

不得預設渲染全部角色與全部關係。

## FR-I008 世界時間線

**優先級：P1**

顯示重大事件，不顯示所有低重要度 Event。

支援：

* Arc 篩選。
* 角色篩選。
* Event Type 篩選。
* 跳轉 Episode。

---

# Epic J：觀眾互動

## FR-J001 每日投票

**優先級：P1**

每日提供 3–4 個環境事件候選。

可接受：

* 停電。
* 暴雨。
* 道路封閉。
* 陌生人抵達。
* 報社收到匿名文件。
* 工廠停工。
* 節慶取消。

不可接受：

* 命令角色殺人。
* 指定角色愛上某人。
* 指定犯人。
* 強迫角色洩漏秘密。
* 直接改寫 Canon Fact。

驗收條件：

1. 候選事件通過安全與 Canon 檢查。
2. 每個裝置每日投票次數受限。
3. 投票截止後只有一項勝出。
4. 勝出事件作為 Proposed World Event 注入。
5. 勝出不代表指定後續結果。

## FR-J002 投票後果追蹤

**優先級：P1**

系統應標示：

* 哪個事件由觀眾投票觸發。
* 直接影響。
* 後續衍生事件。
* 尚無法確認的間接影響。

不得將所有後續結果都宣稱為投票直接造成。

## FR-J003 追蹤角色與 Arc

**優先級：P2**

登入使用者可以：

* 追蹤角色。
* 追蹤 Story Arc。
* 保存觀看進度。
* 查看個人化回訪摘要。

---

# Epic K：管理與營運

## FR-K001 模擬控制台

**優先級：P0**

管理者可：

* 暫停世界。
* 恢復世界。
* 手動推進時段。
* 重跑失敗工作。
* 取消未提交場景。
* 查看當前世界狀態。
* 建立 Snapshot。
* 查看排程與 Queue。

## FR-K002 Event 審核

**優先級：P0**

管理者可查看：

* Proposed Event。
* Validation Result。
* Rejection Reason。
* Model Trace。
* Participant。
* State Changes。
* Related Arc。
* Safety Label。

## FR-K003 Canon 修正

**優先級：P0**

支援：

* Correction Event。
* Compensation Event。
* Retcon Event。

驗收條件：

1. 不得刪除 Accepted Event。
2. Retcon 必須記錄操作者與理由。
3. 修正後 Replay 結果一致。
4. 公開內容需依修正更新。
5. 重大 Retcon 應保留稽核紀錄。

## FR-K004 發布狀態

**優先級：P0**

內容狀態：

* Generated。
* Validated。
* Safety Review。
* Ready。
* Published。
* Withheld。
* Superseded。

驗收條件：

1. Canon Event 與公開內容發布狀態分離。
2. 不適當 Episode 可被暫停公開，但 Canon 不因此刪除。
3. 管理者可重新生成公開摘要。

## FR-K005 模型與 Prompt 設定

**優先級：P1**

可依模組設定：

* Model。
* Prompt Version。
* Temperature。
* Token Limit。
* Timeout。
* Retry。
* Fallback。
* Daily Budget。

設定變更必須可稽核。

## FR-K006 世界緊急停止

**優先級：P0**

系統應具備 Kill Switch。

觸發後：

* 停止新模擬工作。
* 不影響既有公開內容。
* 保留未完成 Run 狀態。
* 不遺失已接受 Event。
* 管理者可選擇恢復或回滾。

---

# Epic L：內容安全

## FR-L001 生成前安全限制

**優先級：P0**

世界設定與 Prompt 必須限制：

* 未成年性內容。
* 露骨色情。
* 仇恨與去人性化內容。
* 極端暴力細節。
* 自傷鼓勵。
* 真實人物冒用。
* 個人資料。
* 指導現實犯罪的內容。

## FR-L002 生成後安全分類

**優先級：P0**

每個場景與公開內容必須產生 Safety Label。

處理結果：

* Allow。
* Allow with Warning。
* Withhold。
* Human Review Required。

验收條件：

1. 高風險內容不得直接公開。
2. Safety Failure 不得改變 Canon。
3. 公開摘要可移除過度細節，但不得改變核心事實。
4. 所有阻擋具備可查詢原因。

## FR-L003 觀眾輸入安全

**優先級：P0**

投票與其他觀眾輸入必須防止：

* Prompt Injection。
* 指定現實人物。
* 私人資料。
* 不適當暴力或性內容。
* 操作系統指令。
* 直接控制角色結果。

---

# Epic M：可觀測性與品質

## FR-M001 LLM Trace

**優先級：P0**

每次模型呼叫至少記錄：

* World ID。
* World Day。
* Run ID。
* Scene ID。
* Arc ID。
* Character IDs。
* Model。
* Prompt Version。
* Input Tokens。
* Output Tokens。
* Latency。
* Retry Count。
* Validation Result。
* Final Status。

不得在公開介面暴露完整 Prompt 或 Secret。

## FR-M002 世界品質指標

**優先級：P1**

至少包含：

* Continuity Score。
* Character Consistency。
* Event Novelty。
* Dialogue Repetition。
* Arc Progress。
* Arc Stagnation。
* Recap Coverage。
* Spoiler Violation。
* Canon Rejection Rate。
* Safety Withhold Rate。

## FR-M003 Token 與 Rate Limit 控制

**優先級：P1**

系統支援：

* 每日 Token 上限。
* 每模組上限。
* 每模型上限。
* 最大並行數。
* Retry 預算。
* 超額降級策略。

## FR-M004 降級模式

**優先級：P1**

當模型、配額或外部服務異常時：

1. 重試相同模型。
2. 使用相容模型。
3. 減少主要場景。
4. 僅執行規則型背景事件。
5. 延後非必要摘要。
6. 暫停新模擬。

不得跳過：

* Canon Validation。
* Safety Validation。
* Idempotency。
* Event Persistence。

---

# 12. 每個世界日的處理流程

```text
1. Load World State
2. Apply Scheduled Environment Events
3. Load Active Story Arcs
4. Generate Daily Director Plan
5. Generate Character Intents
6. Group Intents into Scenes
7. Simulate Scenes
8. Validate Structured Output
9. Run Canon Validation
10. Commit Accepted Events
11. Reduce World Projection
12. Update Character Knowledge
13. Write Character Memories
14. Update Relationships
15. Classify and Update Story Arcs
16. Generate Episode
17. Generate Recaps
18. Run Safety Review
19. Publish Public Read Model
20. Create Snapshot
21. Record Metrics
```

任何步驟失敗時：

* 已接受 Event 不得丟失。
* 未接受 Event 不得部分套用。
* 公開內容維持上一個有效版本。
* Run 必須記錄失敗階段。
* 可從安全步驟重試。

---

# 13. 資料模型

以下為產品層必要 Entity，實際資料庫 Schema 由技術設計決定。

## 13.1 World

```text
id
name
description
status
currentWorldDay
currentTimeSlot
simulationMode
publicLaunchDay
createdAt
updatedAt
```

## 13.2 Character

```text
id
worldId
name
age
occupation
publicProfile
privateProfile
personality
values
publicGoal
privateGoal
fear
behaviorRules
currentLocationId
healthState
emotionalState
financialState
alive
active
```

## 13.3 Relationship

```text
id
worldId
sourceCharacterId
targetCharacterId
trust
affection
resentment
fear
dependency
familiarity
visibility
lastUpdatedEventId
```

## 13.4 Location

```text
id
worldId
name
description
type
capacity
connectedLocationIds
active
```

## 13.5 Canonical Fact

```text
id
worldId
subjectType
subjectId
predicate
value
validFromEventId
validUntilEventId
visibility
```

## 13.6 Character Knowledge

```text
id
worldId
characterId
factReference
beliefValue
truthStatus
confidence
sourceType
sourceEventId
learnedAt
correctedAt
shareability
```

## 13.7 Memory

```text
id
worldId
characterId
eventId
content
interpretation
importance
emotionalWeight
confidence
visibility
createdAt
lastRecalledAt
embeddingReference
```

## 13.8 World Event

```text
id
worldId
sequenceNumber
schemaVersion
worldDay
timeSlot
eventType
locationId
participantIds
causedByEventIds
publicSummary
stateChanges
arcIds
importance
novelty
emotionalImpact
validationStatus
traceId
acceptedAt
```

## 13.9 Story Arc

```text
id
worldId
title
premise
currentQuestion
status
priority
heatScore
coreCharacterIds
incitingEventId
latestTurningPointId
recommendedEntryEventId
essentialFactIds
unresolvedQuestions
resolvedQuestions
resolvedOutcome
lastProgressAt
```

## 13.10 Episode

```text
id
worldId
worldDay
episodeNumber
title
headline
quickRecap
standardRecap
deepRecap
machineSummary
keyEventIds
arcIds
characterIds
publicationStatus
publishedAt
```

## 13.11 Recap Snapshot

```text
id
worldId
recapType
targetId
sourceFromEventId
sourceToEventId
content
structuredPayload
version
generatedAt
```

## 13.12 Viewer Progress

```text
id
viewerId
worldId
lastViewedEpisodeId
followedCharacterIds
followedArcIds
spoilerMode
updatedAt
```

## 13.13 Viewer Intervention

```text
id
worldId
targetWorldDay
title
description
status
voteCount
selected
injectedEventId
createdAt
```

## 13.14 Simulation Run

```text
id
worldId
runType
worldDay
timeSlot
status
startedAt
completedAt
failureStage
errorCode
traceId
```

---

# 14. 非功能需求

## NFR-001 可用性

* 公開內容目標可用性：99.5%。
* 模擬引擎中斷不得造成歷史內容不可讀。
* 發布服務與模擬服務故障隔離。

## NFR-002 效能

* 首頁主要內容 LCP 目標小於 2.5 秒。
* 一般 Read API P95 目標小於 500ms。
* Live 更新延遲目標小於 5 秒。
* 關係圖預設節點不超過 30。
* 公開頁面不得等待即時 LLM 回應。

## NFR-003 Determinism

* 相同 Snapshot 與 Event 序列必須產生相同 Projection。
* Reducer 需具備完整自動測試。
* Event Commit 必須 Idempotent。

## NFR-004 模型可替換性

* 所有供應商透過統一 Adapter。
* 業務層不得散落供應商特定格式。
* Prompt 與 Model Config 必須版本化。
* 結構化輸出必須 Runtime Validated。

## NFR-005 安全

* 管理介面必須驗證身分與權限。
* 公開 API 不得返回私人 Knowledge 或 Prompt。
* 觀眾輸入必須視為不可信。
* Secret 不得進入 Log 或公開 Trace。
* 公開部署前完成 Server-side Authorization Audit。

## NFR-006 可維護性

模組邊界至少分為：

* Canon。
* Simulation。
* Character Knowledge。
* Story。
* Editorial／Recap。
* Public Read Model。
* Viewer。
* Operations。
* Safety。
* Observability。

## NFR-007 可測試性

* Domain Logic 可在無 LLM、無網路環境測試。
* 提供 Deterministic Fake Provider。
* 提供固定世界 Fixture。
* 提供 7、30、90 世界日模擬測試。

## NFR-008 資料完整性

* 所有重大變化可追蹤至 Event。
* 公開內容可追蹤至 Accepted Event。
* 修正不得刪除稽核歷史。
* Partial Failure 不得產生不完整 Canon State。

## NFR-009 Accessibility

公開介面至少支援：

* 鍵盤導覽。
* 合理對比。
* Reduced Motion。
* 非地圖替代檢視。
* 圖像替代文字。
* 行動裝置觸控尺寸。

---

# 15. 產品分析事件

至少記錄：

```text
home_viewed
current_situation_expanded
recommended_episode_opened
episode_viewed
episode_completed
character_viewed
character_followed
story_arc_viewed
story_arc_followed
relationship_graph_opened
timeline_filtered
vote_viewed
vote_submitted
return_recap_viewed
live_scene_opened
share_action
```

事件不得包含：

* 模型 Secret。
* 私人角色資料。
* 完整 Prompt。
* 使用者敏感資訊。

---

# 16. 成功指標

## 16.1 產品指標

| 指標               | MVP 目標 |
| ---------------- | -----: |
| 首次進站後開啟 Episode  |  ≥ 40% |
| 首次進站停留超過 3 分鐘    |  ≥ 30% |
| 次日回訪率            |  ≥ 15% |
| 七日回訪率            |   ≥ 8% |
| 投票參與率            |  ≥ 10% |
| 追蹤角色或 Arc        |   ≥ 8% |
| 三分鐘前情展開率         |  ≥ 20% |
| 推薦入坑 Episode 點擊率 |  ≥ 20% |

## 16.2 世界品質指標

| 指標               | MVP 目標 |
| ---------------- | -----: |
| 嚴重 Canon 衝突      |      0 |
| Event Replay 一致率 |   100% |
| JSON 結構成功率       |  ≥ 98% |
| 高重要度摘要覆蓋率        |  ≥ 95% |
| 30 日連續模擬完成率      |   100% |
| 重複場景比例           |  < 15% |
| Active 主要 Arc    |    1–3 |
| 無來源秘密洩漏          |      0 |
| 死者不合理出場          |      0 |
| 角色位置衝突           |      0 |

## 16.3 資源指標

* Retry Token 不超過總量 10%。
* 低重要度工作使用快速模型比例高於 80%。
* 公開訪客流量不增加 LLM 呼叫。
* 模型中斷後公開內容可用。
* 每日 Token 用量可預測並可限制。

---

# 17. MVP 優先級

## P0：公開展示前必須完成

* 世界初始化。
* 角色初始化。
* 初始張力檢查。
* 世界暖機。
* 排程器。
* Director Plan。
* Character Intent。
* Scene Grouping。
* Scene Simulation。
* Proposed Event。
* Structural Validation。
* Canon Validation。
* Append-only Event Store。
* Reducer。
* Snapshot 與 Replay。
* Character Knowledge。
* Memory Retrieval。
* Story Arc 建立、狀態、數量控制與收束。
* Episode。
* 摘要金字塔。
* Current Situation。
* 三分鐘前情。
* 推薦入坑點。
* 首頁。
* Live View。
* Episode。
* Character。
* Story Arc 頁面。
* Admin Console。
* Canon Correction。
* Publication Status。
* Kill Switch。
* 內容安全。
* Trace。
* 30 日模擬驗證。

## P1：公開測試期間需要

* 記憶壓縮。
* 謠言傳播。
* Arc Heat Score。
* 摘要覆蓋驗證。
* 地方新聞與分享內容。
* 回訪摘要。
* 關係圖。
* 世界時間線。
* 每日投票。
* 投票後果追蹤。
* 模型與 Prompt 管理。
* Token 與 Rate Limit 控制。
* 降級模式。
* 世界品質評估器。

## P2：後續版本

* 登入。
* 跨裝置觀看進度。
* 追蹤角色。
* 追蹤 Arc。
* 無雷模式。
* 多世界。
* 使用者建立世界。
* 語音廣播。
* 自動短影片。
* 大規模背景居民。
* 多語言。
* 付費會員。
* 原生 App。

---

# 18. 實作里程碑

## Milestone 0：Project Foundation

目標：

* 專案可安裝、測試、建置。
* Domain 與上游視覺層邊界明確。
* Fake Provider 可用。
* CI 可執行。
* PRD Traceability 建立。

完成標準：

* 無外部憑證可執行核心 Domain Tests。
* 專案具備固定 Fixture。
* 所有模組有明確 Ownership。

## Milestone 1：Canon Foundation

目標：

* Proposed Event。
* Validation。
* Append-only Store。
* Reducer。
* Replay。
* Snapshot。
* Idempotency。

完成標準：

* 固定 Event 序列 Replay 一致。
* Duplicate Commit 不重複寫入。
* 所有 P0 Canon Rule 有測試。

## Milestone 2：Simulation Core

目標：

* World Scheduler。
* Director。
* Intent。
* Scene Grouping。
* Scene Simulation。
* Fake 與真實 Provider Adapter。

完成標準：

* 一個世界日可完整跑完。
* 失敗可重試。
* 所有輸出先經 Proposed Event。

## Milestone 3：Character Cognition

目標：

* Character Knowledge。
* Memory。
* Memory Retrieval。
* Relationship Projection。

完成標準：

* 角色無法取得未授權資訊。
* 同一事件產生不同主觀記憶。
* 角色決策只使用允許的 Context。

## Milestone 4：Story Engine

目標：

* Story Arc。
* Arc Lifecycle。
* Arc Count Control。
* Arc Resolution。
* Heat Score。

完成標準：

* 30 日內至少一條 Arc 合理轉折。
* 無限增加 Arc 的情況被阻止。
* 長期停滯 Arc 可收束。

## Milestone 5：Editorial and Onboarding

目標：

* Episode。
* Recap Pyramid。
* Current Situation。
* Recommended Entry。
* Return Recap。

完成標準：

* 新觀眾 30 秒測試通過。
* 高重要度事件摘要覆蓋率達標。
* 每位訪客不觸發生成。

## Milestone 6：Public Experience

目標：

* 首頁。
* Live。
* Episode。
* Character。
* Arc。
* Relationship。
* Timeline。

完成標準：

* 公開頁面可在模擬停止時正常使用。
* 行動裝置基本體驗完整。
* 不公開私人角色資訊。

## Milestone 7：Audience Interaction

目標：

* 投票。
* 安全候選事件。
* 事件注入。
* 投票後果追蹤。

完成標準：

* 投票不能直接指定角色結果。
* 重複投票受到限制。
* 投票 Event 仍經 Canon Validation。

## Milestone 8：Operations and Public Test Readiness

目標：

* Admin。
* Safety。
* Observability。
* Budget。
* Degradation。
* 30／90 日測試。
* Security Audit。

完成標準：

* 公開測試驗收條件全部通過。
* Kill Switch 可用。
* Critical／High 缺陷已處理。
* Production 尚未被意外啟用。

---

# 19. 測試策略

## 19.1 單元測試

必須涵蓋：

* Structural Validation。
* Canon Validation。
* Reducer。
* Replay。
* Idempotency。
* Arc State Transition。
* Knowledge Permission。
* Memory Retrieval。
* Recap Event Selection。
* Voting Rules。
* Safety Rules。

## 19.2 整合測試

至少涵蓋：

1. 角色取得秘密並告知另一角色。
2. 謠言經多人傳播。
3. 死亡角色不再參與正常場景。
4. 物品經多次轉移仍保持唯一所有權。
5. 投票事件安全注入。
6. Provider 暫時失敗後重試。
7. 重試不重複提交 Event。
8. Episode 只使用 Accepted Event。
9. Canon Correction 後 Read Model 更新。
10. 模擬失敗時公開內容仍可讀取。

## 19.3 長期模擬測試

固定 Seed 執行：

* 7 日。
* 30 日。
* 90 日。

檢查：

* Canon Conflict。
* Arc 數量膨脹。
* 角色長期未出現。
* 對話重複。
* 場景重複。
* 摘要遺漏。
* Token 異常。
* Safety Withhold。
* Story Arc 停滯。
* Replay 一致性。

## 19.4 新觀眾可理解性測試

測試者首次進站後：

30 秒內應可回答：

* 現在發生什麼？
* 為什麼重要？

3 分鐘內應可回答：

* 三位核心角色是誰？
* 當前核心問題是什麼？
* 應該從哪一集開始？

## 19.5 人工內容評估

定期抽樣：

* 角色是否保持一致。
* 行動是否符合已知資訊。
* 事件是否具備因果。
* Arc 是否有推進。
* Arc 是否拖延。
* 對話是否重複。
* 摘要是否誤導。
* 不適當內容是否被攔截。

---

# 20. 公開測試驗收標準

只有全部符合才可進入公開測試：

1. 可連續模擬 30 個世界日。
2. Replay 一致率 100%。
3. 無角色位置衝突。
4. 無死者不合理出場。
5. 無來源 Secret 洩漏。
6. Duplicate Event 不會重複提交。
7. 所有高重要度 Event 被摘要涵蓋。
8. 同時主要 Active Arc 不超過 3。
9. 至少一條 Arc 完成合理 Turning Point。
10. 至少一條 Arc 進入 Resolving 或 Resolved。
11. 新觀眾 30 秒理解測試通過。
12. 三分鐘前情可理解目前主線。
13. 公開讀取不觸發 LLM。
14. 模擬停止時歷史內容仍可讀取。
15. Kill Switch 驗證通過。
16. Correction Event 與 Replay 驗證通過。
17. 高風險內容不會直接公開。
18. 管理者可暫停、恢復、重試與查看失敗。
19. Typecheck、Lint、Tests、Build 與 CI 全部通過。
20. Server-side Authorization Audit 完成。
21. 無已知 Critical／High 安全缺陷。
22. License 與 Attribution 保留。
23. Production Deployment 未被自動啟用。
24. PRD P0 Requirement 全部具備驗證證據。
25. P1 未完成項目不影響公開測試安全與核心體驗。

---

# 21. 主要風險

## RISK-001 世界一致性崩壞

緩解：

* Append-only Event Store。
* Canon Validation。
* Character Knowledge Permission。
* Snapshot。
* Replay。
* Kill Switch。
* Correction Event。

## RISK-002 世界內容無聊

緩解：

* 初始張力驗證。
* 世界暖機。
* Director 壓力規劃。
* 重複度監控。
* Arc Heat Score。
* 長期未發展角色偵測。
* 環境事件注入。

## RISK-003 Story Arc 無限增加

緩解：

* Active Arc 上限。
* Arc Lifecycle。
* 自動收束。
* 合併與封存。
* 舊歷史壓縮。

## RISK-004 新觀眾看不懂

緩解：

* Current Situation。
* 三項必要前情。
* 最多四位核心角色。
* Recommended Entry。
* 三分鐘前情。
* 首頁不顯示完整世界。

## RISK-005 模型配額高但 Rate Limit 不足

緩解：

* Queue。
* Concurrency Control。
* 場景合併。
* 模型路由。
* 降級模式。
* 背景事件規則化。

## RISK-006 生成不適當內容

緩解：

* 生成前限制。
* 生成後分類。
* Publication Status。
* Withhold。
* 管理者審核。
* 不自動發布外部平台。

## RISK-007 過度依賴上游專案

緩解：

* Canon Domain 獨立。
* 公開 Read Model 獨立。
* 視覺執行層可替換。
* 上游更新不直接控制產品資料模型。

## RISK-008 摘要逐漸偏離事實

緩解：

* 摘要引用 Event ID。
* Machine Summary。
* Coverage Validation。
* 定期從 Canon 重新校準。
* 摘要不得產生新 Canon。

## RISK-009 公開流量拖垮模擬

緩解：

* 公開 Read Model。
* Cache。
* Simulation／Presentation 隔離。
* 公開讀取不觸發生成。

---

# 22. 已確定產品決策

以下內容視為目前已確定，不需要在 Task 拆解時重新詢問：

1. 產品是可觀看的持續世界，不是聊天產品。
2. MVP 只有一個公開世界。
3. MVP 主要角色為 12–20 位。
4. 世界需要先暖機再公開。
5. 觀眾不能直接控制角色結果。
6. 觀眾以環境事件影響世界。
7. Canon Event 為 Append-only。
8. LLM 只能提出 Proposed Event。
9. Reducer 必須 Deterministic。
10. 公開讀取不得即時觸發 LLM。
11. 同時主要 Active Arc 最多三條。
12. 新觀眾不需要從第一集開始。
13. 公開頁面以劇情與角色為主，不以技術為主。
14. MVP 不追求 100–200 位完整 Agent。
15. Public Production Security Audit 是發布前置條件。

---

# 23. 後續 Task 拆解規則

Backlog 第一層 Epic 建議：

```text
A. Project Foundation
B. World Initialization
C. Character Domain
D. Canon Event Store
E. Validation and Replay
F. Simulation Workflow
G. Character Knowledge and Memory
H. Story Arc Engine
I. Episode and Recap
J. Viewer Onboarding
K. Public Experience
L. Viewer Interaction
M. Admin and Operations
N. Content Safety
O. Observability and Budget
P. Test Harness
Q. Public Test Readiness
```

每個 Task 必須包含：

* Requirement ID。
* Problem／Context。
* Goal。
* Scope。
* Out of Scope。
* Dependencies。
* Schema Impact。
* API Impact。
* Security Impact。
* Acceptance Criteria。
* Validation Commands。
* Test Requirements。
* Documentation Impact。
* Definition of Done。

Task 不得大於一個可審查 PR。

優先拆解順序：

```text
Canon Foundation
→ Simulation Core
→ Character Cognition
→ Story Arc
→ Editorial and Onboarding
→ Public Experience
→ Interaction
→ Operations and Public Test Readiness
```

不得先以地圖、動畫或完整關係圖作為主要開發起點。
