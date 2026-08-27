---
id: ART-46
title: Causal viewer-intervention consequence tracking
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-27 16:58'
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
- [ ] #1 FR-J002: Consequence view identifies the winning viewer-triggered event, direct effects, downstream events, and uncertain indirect effects.
- [ ] #2 The system never labels all downstream outcomes as directly caused by the vote.
- [ ] #3 Every displayed causal link traces to accepted-event provenance.
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
