---
id: ART-39
title: Device-aware return recap
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-27 23:41'
labels:
  - prd-1.0
  - epic-j
milestone: m-0
dependencies:
  - ART-38
  - ART-46
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-H004; Section 13.12

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Produce a concise return recap from last-viewed progress that prioritizes followed content when available, major changes, vote effects, and a recommended continuation point, including anonymous device progress.

Scope
Produce a concise return recap from last-viewed progress that prioritizes followed content when available, major changes, vote effects, and a recommended continuation point, including anonymous device progress.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-38, ART-46

Schema Impact
Current-situation, primer, entry-point, return-recap, viewer-progress, or spoiler-compatibility contracts named by the task.

API Impact
Cached onboarding/recap read contracts; visitor reads never trigger generation.

Security Impact
Viewer progress is isolated by viewer/device and recap visibility obeys spoiler/publication rules.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every mapped PRD acceptance condition, negative case, and failure boundary.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-H004: 不逐日完整列出所有事件。
- [ ] #2 FR-H004: 優先顯示使用者追蹤內容。
- [ ] #3 FR-H004: 無登入使用者可使用裝置層級進度。
- [ ] #4 Automated tests provide evidence for every mapped FR-H004 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-H004 to doc-1 and the merged implementation evidence.
- [ ] #6 Section 13.12: Viewer Progress records an isolated viewer-or-device identity, worldId, lastViewedEpisodeId, followedCharacterIds, followedArcIds, spoilerMode, and updatedAt with runtime validation.
- [ ] #7 Anonymous device progress and authenticated progress cannot be read or modified across identities; merging or migration is explicit, authorized, and lossless.
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
## 決定:進度存在伺服器端(已與使用者確認)

新增 `viewerProgress` 表與**一個** viewer-gated mutation。這需要把 `architecture/module-boundaries.json` 的 `maxViewerMutations` 從 1 提到 2 —— 該邊界是刻意設計成「要在兩個地方各改一次」才能打開的,所以這是一次審慎的放寬,不是繞過。理由:PRD §13.12 把 Viewer Progress 定義成帶 `id` 與 `viewerId` 的持久化實體,且 ART-71 依賴 ART-39;若這裡不建,ART-71 得從零建整個儲存層。

`viewerKey` 命名空間化為 `device:<digest>`(未來為 `auth:<subject>`),讓 ART-71 的合併不需要破壞性遷移。

## AC#7 的誠實處理

AC#7 第二子句「合併或遷移須明確、經授權且無損」**現在無法滿足,且不會假裝滿足**。這個 codebase 沒有任何觀眾端登入:`convex/auth.config.ts` 在缺 `CLERK_JWT_ISSUER_DOMAIN` 時回 `providers: []`,唯二 `getUserIdentity()` 的呼叫端都是營運端函式,`src/` 裡沒有觀眾登入介面。「已登入進度」是可證明為空的集合;現在寫合併程式,其授權判斷沒有憑證可查,無損性只能對著捏造的身分證明。ART-71(FR-J003,依賴 ART-39)擁有這一半。

本任務交付第一子句,且是**結構性**的:每一次進度讀寫都以呼叫端自己的 digest 走索引,沒有呼叫端提供的 row id、沒有掃描;附反向測試證明持 digest B 的請求既看不到也改不動 digest A 的列。

另需如實記錄:以用戶端自行產生、未經驗證的 key 而言,跨身分隔離是防意外與防列舉,**不是防對手** —— 任何持有他人 key 的人就是那個人。這與 `convex/viewer/environmentVote.ts:20-22` 對投票已經寫下的「deviceKey 是一項主張,不是身分」是同一個保留,必須重述,不能讓 AC#7 讀起來像一個它不是的安全保證。

**AC#7 不勾選。** 理由寫入任務與文件。

## 步驟

1. **`viewerProgress` 表**(`convex/viewer/schema.ts`):§13.12 六個欄位 + `viewerKey`,索引 `by_world_and_viewer`。既有的 `viewerEpisodeProgress`(ART-70,已宣告但無人寫入)是 row-per-day 形狀,與 §13.12 的 record-per-viewer 不同,**不改動它**,避免動到 ART-70 的「無破壞性遷移」證據。
2. **純驗證器**:AC#6 明寫 with runtime validation。`spoilerMode` 重用 `convex/viewer/spoilerMode.ts` 的 `isSpoilerMode`,預設 `publicOnly`。
3. **viewer-gated mutation `recordViewerProgress`**,比照 `submitEnvironmentVote` 的標準:決策邏輯放純函式、handler 只做列存取;每裝置嘗試預算(**計嘗試而非只計成功寫入**);`followedCharacterIds` / `followedArcIds` 長度上限**與參照驗證**(否則變成自由字串儲存,正是 `classifyViewerInput` 存在的原因);每世界列數上限;穩定拒絕碼;拒絕順序由最便宜、資訊量最低者優先;超出預算的裝置**完全不寫入任何列**。
4. **邊界改動(兩處,缺一不可)**:`publicFunctionSurface.allowed` 加 `kind: mutation, gate: viewer`,`viewerWriteBoundary.allowed` 加同一路徑名稱,`maxViewerMutations` 1 → 2。連帶更新 `publicReadOnlyGuarantee.test.ts` 的兩處窮舉斷言(viewer mutation 清單、`src/` 的 publicFunctionRef 字串)。
5. **用戶端進度 key 模組**:比照 `voteDeviceKey.ts`(mint / 驗證 / 損毀即重置不送出 / 無 storage 回 null),但用**獨立的 localStorage key**,不共用 `art45.voteDeviceKey` —— 共用會讓投票紀錄與閱讀進度一個 join 就關聯起來,正是 §15 資料最小化要避免的。`clientRoots` 需新增一個條目。
6. **純 return-recap builder**:輸入為最後觀看位置、追蹤 id 集合、spoilerMode 與已發布的 read model,輸出有界摘要。AC#1 要求**不逐日完整列出**;AC#2 要求追蹤內容優先排序。
7. **投票後果必須誠實取用 ART-46**:`explicitCausalEdgeCount` 在真實資料上恆為 0(沒有 provider 寫 `causedByEventIds`)。把 `uncertain` 當成「投票效果」呈現會**違反 ART-46 AC#2**。誠實的做法是只呈現 trigger,或明說 Canon 沒有記錄到因果關聯。
8. **UI 放獨立路由 `#recap/<worldId>`,不掛首頁**。首頁的 `e2e/dynamicView.spec.ts:491,494-499` 有零寫入斷言與窮舉 query 白名單;掛上去會打破 ART-127/ART-137 的證據。沿用既有的 route parser + compose*ViewModel + 薄 View 模式,並確保 View 在無 Convex client 下可渲染,否則 a11y suite 會壞。
9. **E2E fixture**:`fixtureConvexClient.ts` 的 handler map 對未註冊的 query 會在 render 時拋錯並拖垮整頁(ART-146 的教訓);mutation 則被記錄並拒絕。新路由的讀取需註冊,且**不得在頁面載入時觸發寫入**。
10. **文件與追溯**:新增 `docs/` 一篇;`docs/prd-1.0-closure-matrix.md` 三列(:188 FR-H004、:65 §5.1 G10、:377 收尾段落)。

## 驗證

`npm run check`、`npm run e2e`,逐條 AC 故障注入,並特別對「跨身分不可讀寫」做反向測試。
<!-- SECTION:PLAN:END -->
