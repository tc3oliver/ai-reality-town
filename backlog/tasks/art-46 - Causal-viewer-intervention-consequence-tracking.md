---
id: ART-46
title: Causal viewer-intervention consequence tracking
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-27 18:18'
labels:
  - prd-1.0
  - epic-l
milestone: m-0
dependencies:
  - ART-45
  - ART-13
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-J002

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Trace the winning intervention, direct effects, descendants, and uncertain indirect effects without overstating causality.

Scope
Trace the winning intervention, direct effects, descendants, and uncertain indirect effects without overstating causality.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-45, ART-13

Schema Impact
Viewer Intervention, vote, consequence, analytics, or authenticated progress schemas explicitly named by the task.

API Impact
Untrusted viewer command/ingestion interfaces and privacy-safe read/aggregate queries.

Security Impact
Rate limits, authorization, injection defenses, data minimization, and no direct character control are mandatory.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Causal-chain tests cover direct, multi-hop, unrelated, and uncertain effects.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-J002: Consequence view identifies the winning viewer-triggered event, direct effects, downstream events, and uncertain indirect effects.
- [x] #2 The system never labels all downstream outcomes as directly caused by the vote.
- [x] #3 Every displayed causal link traces to accepted-event provenance.
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
## 設計前提:Canon 今天到底有什麼因果證據

調查結論(決定整個設計):`canonEvents.causedByEventIds` 欄位存在(convex/canon/schema.ts:130)、有完整驗證(validators.ts:370-382 形狀、:458-463 referential integrity),但**系統實際產生的每一筆事件都是空陣列** —— 投票注入事件自己硬寫 `causedByEventIds: []`(worldDayLive.ts:205),預設 fake provider 一律回 `[]`。Canon 目前是一組孤立節點。

因此 FR-J002 不能靠「推論」補上因果。設計原則:**只呈現 Canon 真的有的證據,並把推不出來的東西明確標成推不出來** —— 這正是 AC#2 的要求。

## 實作範圍

Canon 不動(append-only、reducer 決定性不變),新增一個 derived read model,把後果分成四層,每層各自有不同的 provenance 基礎:

1. **trigger(投票觸發事件)** — 基礎:`environmentVoteInterventions.appliedEventId` + `vote:` idempotencyKey 前綴(shared/environmentVoteCatalog.ts:143)。
2. **direct(直接影響)** — 基礎:accepted event 的 `causedByEventIds` **明確包含** trigger eventId。今天的 provider 不寫這個欄位,所以真實資料下會是空的;view 必須誠實顯示「無」,不得補洞。
3. **downstream(後續衍生事件)** — 基礎:從 direct 集合沿 `causedByEventIds` 的遞移閉包,每條邊記錄實際路徑與深度。
4. **uncertain(尚無法確認的間接影響)** — 基礎:該事件所屬 scene 的 director plan context 的 `viewerInterventionEventIds` 含 trigger(simulation/schema.ts:91-102 → director.ts:29-32),但**沒有**明確因果邊。這是 context-membership,不是因果宣稱,標籤必須如實。

## 步驟

1. `convex/publicRead/voteConsequenceProjection.ts` — 純模組(無 Convex/clock/random import),`VOTE_CONSEQUENCE_MODEL_KIND` / `_SCHEMA_VERSION`、payload 型別、`buildVoteConsequenceProjection()`、`VoteConsequenceError`。每個 link 帶 `provenance: { basis: canon_caused_by | vote_idempotency_key | director_plan_context, sourceEventIds }`。
2. 驗證器 `validateVoteConsequenceLinks()`,比照 story/consequenceSummary.ts:173-206,任何 link 的 event id 不在 accepted events 內即拒絕(AC#3)。
3. `convex/publicRead/voteConsequenceProjectionFunctions.ts` — `rebuildVoteConsequenceProjection` internalMutation:indexed `Promise.all` 讀取 → ART-132 安全閘(`readWithheldSceneLabels` + `sceneEventRows` + `withheldEventIds`,沿用 liveStateFunctions 既有函式,不重寫)→ builder → `commitReadModelVersion(..., status: published)`。
4. 新 modelKind 三處註冊:readModel.ts `READ_MODEL_KINDS`、publicRead/schema.ts union、readModelFunctions.ts `modelKindValidator`。
5. 接上 post-commit:`PostCommitPort` 介面 + stage 19 + `postCommitLiveFunctions.ts` 的 internalFunctionRef。
6. 讀取沿用既有 `getPublishedReadModel`,**不新增 public query**(公開介面不擴張,避免動 publicReadOnlyGuarantee 的窮舉清單)。
7. 前端:純 view-model 模組 + `.test.ts`,薄元件顯示四個標籤區塊與「不得宣稱全部後果由投票直接造成」的免責說明,掛在投票面板旁。
8. E2E fixture:`src/e2e/fixtureWorld.ts` 加 modelRef 分支(ART-146 的教訓);必要時更新 e2e/dynamicView.spec.ts 首頁 query allowlist。
9. 測試:純 builder 測 direct / multi-hop / 無關 / uncertain 四種鏈路;`*Functions.test.ts` 用 memoryCtx 驗發布 payload;**專測 AC#2** —— 沒有明確因果邊時,所有事件必須落在 uncertain,direct 必須為空。
10. 文件:`docs/vote-consequence-tracking.md`;`docs/prd-1.0-closure-matrix.md:207` 的 FR-J002 列從 Deferred 改為已交付;`docs/daily-environment-vote.md` §6 移除 FR-J002 non-goal 敘述。

## 驗證

`npm run check`(architecture → asset-licenses → typecheck → lint → jest → build)、`npm run e2e`。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 設計決策:為什麼不補上缺的因果邊

調查發現 `canonEvents.causedByEventIds` 欄位存在且驗證完整(convex/canon/validators.ts:370-382 形狀、:458-463 referential integrity、KNOWLEDGE_SOURCE_MISSING 是今天唯一真正強制的因果邊),但**系統實際產生的每一筆事件都是空陣列**:`buildViewerVoteProposal` 硬寫 `[]`(worldDayLive.ts:205),預設 provider 一律回 `[]`(fakeProvider.ts:38,63,95)。

從鄰接關係推論補邊會產生的正是 AC#2 禁止的東西 —— 一個把所有後續事件都標成投票後果的畫面。因此本任務不動 Canon,改為只呈現 provenance 支撐得起的內容,並誠實呈現「沒有」。

四個 bucket 各有不同基礎:trigger 來自 Canon 自己的 `vote:` idempotency key 並與 `environmentVoteInterventions.appliedEventId` 交叉查核;direct/downstream 只認明確的 `causedByEventIds` 邊;uncertain 來自 director plan context membership —— 那是「規劃器被告知了什麼」的紀錄,不是因果宣稱,所以掛 尚無法確認的間接影響 標籤,且永不併入前三者。今天的真實資料下前三者為空,畫面直接說明,不填洞。

## 審查與修正

兩條獨立審查通道(code-reviewer + verifier)在提交前跑過。reviewer 首輪 REQUEST CHANGES,1 HIGH + 3 MEDIUM,全部修正並經複查確認關閉(10 closed / 0 partial / 0 reopened):

- HIGH:rebuild 對三張存 LLM 原始產物(`v.any()`)的表做整個世界的 `.collect()`,且跑在每一筆 accepted event 上、排在 stage 19 的安全性 rebuild **之前**。已改為 run-scoped 走訪 `directorPlans.by_world_day_and_slot` → `groupedSceneRuns.by_director_run` → `sceneSimulationRuns.by_grouping_run`,並移到 `rebuildLiveProjection` / `rebuildOnboardingSummary` 之後。新增測試斷言「用了哪個索引」,退回 `.collect()` 會轉紅。
- MEDIUM:營運者撤下場景後,本介面會永久繼續提供該文字。已收斂為單一 `refreshPublicTextModels` helper,並以窮舉式斷言防止未來新增介面被遺漏。
- MEDIUM:過去日期的投影在世界前進後凍結。已改為在有界視窗內重建,且讀取視窗與重建視窗的對稱性經驗證。
- MEDIUM:AC#3 的 validator 在發佈路徑上是恆真式。`acceptedEventIds` 改為獨立參數,由 canonEvents rows 經 `deriveEventId` 推導,與 builder 自己組的 events 陣列無關,並在 wiring 層再驗一次。

## 驗證證據

- `npm run check` — exit 0,**2748 passed / 2753**(5 skipped)。獨立跑兩次(修正前 2740 passed,修正後 2748,+8 為新增測試)。
- `npm run e2e` — **68 passed**(main 為 66,+2 為新增的 FR-J002 spec,桌機與行動各一)。
- 故障注入(逐條 AC,本 repo 慣例):破壞 AC#1 的 trigger 辨識 → 23 個斷言轉紅;把 context-linked 事件偷渡進 direct 以違反 AC#2 → 4 個轉紅;移除 AC#3 的 accepted-set 檢查 → 恰好 2 個轉紅。AC#2 的 pin 經專門檢查確認**非空測**。
- 焦點套件:3 個 vote-consequence 套件共 55 passed。

## 已知邊界(明講而非留給日後發現)

日期視窗是一個 bound,不是證明:`causedByEventIds` 鏈若跨越超過 lookahead 的天數即不會被呈現(第 7 天 → 第 10 天)。已寫入 docs/vote-consequence-tracking.md §5.2 並附具體例子。

`convex/_generated/api.d.ts` 未重新產生 —— 這是既有的 repo 狀態而非本分支的迴歸(ART-123 的 `publicRead/conversationState` 在 main 上同樣缺席),gate 不讀它,`internalFunctionRef` 以字串路徑解析。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
在 convex/publicRead/ 新增衍生式的投票後果投影,把一次投票的結果拆成四個各有獨立 provenance 基礎的 bucket:投票觸發事件(Canon 的 `vote:` idempotency key,並與投票 ledger 的 appliedEventId 交叉查核)、直接影響與後續衍生事件(只認明確的 `causedByEventIds` 邊)、以及尚無法確認的間接影響(director plan context membership,是「規劃器被告知了什麼」的紀錄而非因果宣稱)。

關鍵發現決定了整個設計:`causedByEventIds` 欄位存在且驗證完整,但系統實際產生的每一筆事件都是空的。因此不補推論邊、不動 Canon(無新因果邊、無 reducer 變更),前三個 bucket 在今天的真實資料下為空,畫面誠實說明而不填洞 —— 這正是 AC#2 要求的。不新增 public query,沿用 getPublishedReadModel,公開介面與其窮舉稽核清單維持不變;ART-132 安全閘在 rebuild 時套用、以 event ID 為鍵、保留列僅去除文字。

驗證:`npm run check` exit 0,2748 passed / 2753(獨立跑兩次);`npm run e2e` 68 passed(main 為 66)。逐條 AC 做故障注入:AC#1 破壞 trigger 辨識轉紅 23 個斷言,AC#2 把 context-linked 事件偷渡進 direct 轉紅 4 個,AC#3 移除 accepted-set 檢查恰好轉紅 2 個;AC#2 的 pin 經專門檢查確認非空測。

兩條獨立審查通道在提交前跑過,reviewer 首輪擋下 1 HIGH + 3 MEDIUM(整個世界範圍的 collect 跑在每筆事件上且排在安全性 rebuild 之前、營運者撤下後本介面永久續供該文字、過去日期投影凍結、AC#3 validator 為恆真式),全部依機制修正而非表面繞過,複查 10 項全數關閉、0 項重開。已知邊界:日期視窗是 bound 而非證明,跨越超過 lookahead 天數的因果鏈不會被呈現,已寫入 docs/vote-consequence-tracking.md §5.2。

PR #208,已啟用 auto-merge。
<!-- SECTION:FINAL_SUMMARY:END -->
