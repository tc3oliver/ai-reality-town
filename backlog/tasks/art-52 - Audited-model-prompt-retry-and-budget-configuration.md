---
id: ART-52
title: 'Audited model, prompt, retry, and budget configuration'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-27 19:36'
labels:
  - prd-1.0
  - epic-m
milestone: m-0
dependencies:
  - ART-57
  - ART-48
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-K005

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Version per-module model, prompt, temperature, token, timeout, retry, fallback, and daily-budget settings behind authorized operations.

Scope
Version per-module model, prompt, temperature, token, timeout, retry, fallback, and daily-budget settings behind authorized operations.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-57, ART-48

Schema Impact
Simulation control, review, correction, publication, model-config, kill-switch, operator audit, and queue/run records named by the task.

API Impact
Authenticated administrative commands and queries with explicit roles and audit trails.

Security Impact
Every mutation is server-authorized, reasoned, auditable, secret-safe, and non-destructive to accepted history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Authorization, versioning, redaction, and configuration-selection tests pass.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-K005: Operators can configure Model, Prompt Version, Temperature, Token Limit, Timeout, Retry, Fallback, and Daily Budget per module.
- [x] #2 Every setting change is versioned, authorized, and auditable.
- [x] #3 Secrets and complete prompts never enter public APIs or unsafe logs.
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
## 調查結論:今天沒有任何一項是可設定的

八項設定的現況(全部硬編碼常數或環境變數,無設定表):
- Model:env `LLM_MODEL` → providers/config.ts:48,全域,非 per-module
- Prompt Version:**不存在**。prompt 是程式碼字面值(sceneSimulation.ts:240-253);`promptVersion` 只是 llmTrace.ts:23 一個沒人寫入的欄位
- Temperature:呼叫點硬編碼 0.4 / 0.2 / 0(sceneSimulation.ts:340、openAICompatible.ts:97、probes.ts:17)
- Token Limit:同上,4000 / 2000 / 32
- Timeout:env `LLM_TIMEOUT_MS`,預設 30000,全域
- Retry:兩層獨立機制 —— transport(env `LLM_MAX_ATTEMPTS`,預設 3)與語意層(sceneSimulation.ts:329 的預設參數 2,夾在 1-3)
- Fallback:**不存在**
- Daily Budget:**不存在**,repo 內無任何成本或 token 計帳

另外兩個結構事實:`OpenAICompatibleProvider` 在生產路徑只在部署探測用(providers/actions.ts:13),**從未注入 live 模擬路徑**;`runQueuedWorldDaySlot` 是 internalMutation,Convex mutation 不能 fetch。今天真正呼叫 LLM 的模組只有 scene simulation 一個。

## 範圍邊界(從任務圖推導,非自行縮減)

- **ART-52(FR-K005)= 設定**:定義、版本化、授權、稽核、以及讓呼叫路徑真的讀到設定。
- **ART-59(FR-M003)= 強制執行**:AC#1 明寫 “Enforce daily token, per-module, per-model, concurrency, and retry-budget limits”,AC#2 是 over-budget 策略。依賴 ART-52。
- **ART-91 = 降級順序**:AC#1 的 same-model retry → 相容模型 → … 的排序行為。依賴 ART-52 與 ART-59。

因此本任務把 fallback model id 與 daily budget 當作**設定值**儲存與版本化,執行與降級行為留給 59/91。這是任務圖既有的切分,不是把工作推掉。

## 步驟

1. **模組列舉**:定義 per-module key。今天只有 `scene_simulation` 有真實消費者,director/character_intent/editorial 目前是決定性演算法。對齊 operations/schema.ts:4-8 既有的 `postCommitStage` 命名,並在文件明講哪些是 placeholder —— 不假裝它們已在讀設定。
2. **設定表 + 純模組**:`moduleModelConfigs`,欄位含八項設定 + `schemaVersion`/`worldId`/`module`/`version`/`contentHash`/`actor`/`reason`/`createdAt`/`isCurrent`。**必須放在 `simulation` 可依賴的模組**(`shared`),不能放 `operations` —— module-boundaries 禁止 simulation 依賴 operations。加入驗證:temperature 範圍、正整數、字串長度上限,以及拒絕任何看起來像金鑰的欄位。
3. **版本化**:移植 `commitReadModelVersion`(publicRead/readModel.ts:309-370)的模式 —— 單調遞增 version、content-hash 去重(重送相同設定不產生新版本)、先插入後降級舊 current。
4. **Prompt 版本化**:建立 `PROMPT_VERSIONS` 登錄表,把版本 id 映射到 builder 函式。**只存版本 id,prompt 本體留在程式碼** —— 存本體會直接撞上 AC#3,且 `sanitizeForPublic` 的 `/prompt/i` 規則會把它靜默丟掉。
5. **操作端點**:在 `convex/operations/` 新增 operator-gated mutation 與 query,沿用 `requireOperator` + `recordAudit`(opsConsoleFunctions.ts:86,119)。新增 capability 到 `OPS_CAPABILITIES` 與 `CAPABILITY_MINIMUM_ROLE`。讀取端點的投影比照 `describeOpenAICompatibleConfig`(config.ts:56-59)——只回安全欄位,永不回 apiKey 或 prompt 本體。
6. **讀取接縫**:`resolveModuleConfig(db, worldId, module)`,並把 `{temperature, maxTokens, maxAttempts, promptVersion}` 串進 `StructuredChatRequest`(provider.ts:35-41)→ sceneSimulation.ts:329-341 → worldDayLive.ts:720-722。model 與 timeout 目前掛在 provider 實例上,改為可由 request 覆寫,這比每模組建一個 provider 乾淨。
7. **公開介面宣告**:`architecture/module-boundaries.json` 的 `publicFunctionSurface.allowed` 加入 `gate: "operator"` 條目。
8. **測試**:授權(未授權者被拒、角色下限)、版本化(單調遞增、content-hash 去重)、redaction(金鑰欄位被拒、公開投影不含敏感欄位)、設定選取(呼叫路徑真的讀到設定值而非硬編碼常數 —— 這條是 AC#1 的關鍵,必須是行為測試而非存在性測試)。
9. **文件**:`docs/model-configuration.md`;更新 `docs/simulation-operations-console.md` §1 capability 表與 §6;`docs/prd-1.0-closure-matrix.md:220` 的 FR-K005 列;`.env.example` 標註哪些環境變數改由設定表接手。明確記錄「哪些模組尚無真實消費者」與「真實 provider 尚未接入 live 路徑」這兩個既有事實,不掩蓋。

## 驗證

`npm run check`、`npm run e2e`,加上逐條 AC 的故障注入。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 調查結論:八項設定今天沒有一項可設定

- Model:env `LLM_MODEL` → providers/config.ts:48,全域
- Prompt Version:**不存在**,prompt 是 sceneSimulation.ts:240 的程式碼字面值;`promptVersion` 只是 llmTrace.ts:23 沒人寫入的欄位
- Temperature / Token Limit:呼叫點硬編碼(0.4 / 4000、0.2 / 2000、0 / 32)
- Timeout:env `LLM_TIMEOUT_MS`,預設 30000,全域
- Retry:兩層獨立機制,transport(env,預設 3)與語意層(sceneSimulation.ts:329 預設參數 2)
- Fallback、Daily Budget:**完全不存在**

## 三個設計決定

1. **設定表放在 `shared` 而非 `operations`** —— `simulation` 要讀它,而 module boundaries 禁止 simulation 依賴 operations。操作端 mutation 仍留在 operations。
2. **prompt 只存 ID,本體留在原始碼**。存本體會讓 operations console 取得它刻意不該有的內容撰寫權,且 `sanitizeForPublic` 的 `/prompt/i` 規則會把它靜默丟掉而不是擋下。id 清單改為 per-module,才能用非 `Partial` 的 `satisfies` 讓「註冊了 id 卻沒有 builder」變成編譯錯誤。
3. **三項設定可為 null,代表沿用**。model、timeout、transport attempts 背後各有一個部署層的值(env),所以沒設定過的世界不得覆蓋它們;其餘三項原本是程式碼字面值、背後沒有東西,用具體預設值才誠實地重現舊行為。

## 審查與修正

獨立審查通道首輪 REQUEST CHANGES,1 HIGH + 2 MEDIUM,全部修正並經複查確認關閉(複查用了兩個編譯層隔離重現與一次直接的 content-hash 計算驗證):

- HIGH:設定層無條件送出 `timeoutMs` 與 `transportMaxAttempts`,導致**連沒設定過的世界都會覆蓋** `LLM_TIMEOUT_MS` / `LLM_MAX_ATTEMPTS`,而同一個改動新增的 `.env.example` 與文件卻寫著相反的話。原本那個叫「未設定的世界維持今天的行為」的測試沒有斷言這兩個欄位,所以沒擋住。已改為可 null 表示沿用,並改用「斷言請求的完整 key 集合」而非逐一斷言 undefined。
- MEDIUM:`satisfies Partial<Record<…>>` 實際上不檢查任何東西,三處 docblock 宣稱的漂移防護並不存在。已改為 per-module id 清單 + 非 Partial 的 satisfies,以刻意缺 builder 產生 TS1360 驗證成立。
- MEDIUM:文件宣稱的 fail-closed 路徑不可達,resolver 實際行為相反。確認 resolve-to-defaults 才是正確行為(退役的 prompt 不該讓世界停擺),矛盾文件已調和,標題誤導的測試改為透過真實 stage handler 的行為測試。

## 驗證證據

在**與 main 合併後**的結果上驗證,而非只驗分支:

- `npm run check` — exit 0,**2808 passed / 2813**(5 skipped),181 suites
- `npm run e2e` — **68 passed**
- 本任務新增 56 條測試

AC#1 的關鍵測試跑的是真實 `simulate_scenes` stage handler 搭配 recording provider,斷言 `structuredChat` **實際收到什麼**(含否定斷言),而不是斷言設定列存在。授權先於讀取以「db 為會拋例外的 Proxy」的 ctx 證明。

## 已知缺口(記錄於 docs/model-configuration.md §5)

`assertModuleModelSettings` 只檢查 prompt id 有註冊,不檢查它屬於該模組。今天不可達(所有 id 都衍生自 scene simulation 清單),但第二個模組註冊 prompt 的那一刻就會變成可達,且失敗形狀與上述 MEDIUM 相同。已寫入文件而非留在程式碼註解,因為需要它的人會在改 promptVersions.ts,不會去讀 validator。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
把 model、prompt version、temperature、token limit、timeout、retry(拆成 transport 與語意兩層)、fallback、daily budget 八項設定從硬編碼常數與環境變數,改為 per-module、可版本化、需授權、有稽核的設定。設定表放在 `shared` 而非 `operations`,因為 `simulation` 要讀它而 module boundaries 禁止該方向依賴;版本化沿用 `commitReadModelVersion` 的模式(單調遞增、content-hash 去重、先插入後降級);prompt 只存 ID,本體留在原始碼,並以 per-module id 清單搭配非 Partial 的 satisfies 讓漏掉 builder 變成編譯錯誤。

三項設定可為 null 代表沿用:model、timeout、transport attempts 背後各有部署層的 env 值,沒設定過的世界不得覆蓋;其餘三項原本只是程式碼字面值,用具體預設值重現舊行為。未設定的世界送出的請求 key 集合與改動前完全相同,以斷言完整 key 集合的方式釘住。

範圍邊界(依任務圖,非自行縮減):儲存並版本化 fallbackModel 與 dailyTokenBudget,但**不實作任何強制執行** —— ART-59 擁有 enforcement(FR-M003 AC#1 明寫 enforce),ART-91 擁有降級順序,兩者都依賴本任務。有測試釘住這兩個欄位不會被轉發,避免日後被無聲啟用。

驗證(在與 main 合併後的結果上,而非只驗分支):`npm run check` exit 0,2808 passed / 2813,181 suites;`npm run e2e` 68 passed;本任務新增 56 條測試。AC#1 由真實 stage handler 搭配 recording provider 斷言 `structuredChat` 實際收到的值來證明,授權先於讀取以會拋例外的 db Proxy 證明,AC#3 的讀取投影是逐鍵斷言的 allowlist。

獨立審查首輪擋下 1 HIGH + 2 MEDIUM(設定層無條件覆蓋兩個環境變數且文件寫著相反的話、satisfies Partial 實際不檢查任何東西、文件宣稱的 fail-closed 路徑不可達),全部依機制修正,複查確認關閉。

兩項如實記錄而未掩蓋的事實:四個模組 key 中有三個尚無 provider 消費者(今天只有 scene simulation 呼叫 LLM,並以 MODULES_WITH_PROVIDER_CONSUMERS 釘成不變式);真實 provider adapter 仍未注入 live 路徑,故 model/timeout/transport-retry 已正確串接但在該接線落地前為 inert。

PR #209,已啟用 auto-merge。
<!-- SECTION:FINAL_SUMMARY:END -->
