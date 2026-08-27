---
id: ART-52
title: 'Audited model, prompt, retry, and budget configuration'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-27 18:26'
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
- [ ] #1 FR-K005: Operators can configure Model, Prompt Version, Temperature, Token Limit, Timeout, Retry, Fallback, and Daily Budget per module.
- [ ] #2 Every setting change is versioned, authorized, and auditable.
- [ ] #3 Secrets and complete prompts never enter public APIs or unsafe logs.
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
