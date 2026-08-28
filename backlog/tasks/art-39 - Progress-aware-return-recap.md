---
id: ART-39
title: Device-aware return recap
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-28 01:13'
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
- [x] #1 FR-H004: 不逐日完整列出所有事件。
- [x] #2 FR-H004: 優先顯示使用者追蹤內容。
- [x] #3 FR-H004: 無登入使用者可使用裝置層級進度。
- [x] #4 Automated tests provide evidence for every mapped FR-H004 acceptance criterion, including rejection and failure paths.
- [x] #5 PRD traceability links FR-H004 to doc-1 and the merged implementation evidence.
- [x] #6 Section 13.12: Viewer Progress records an isolated viewer-or-device identity, worldId, lastViewedEpisodeId, followedCharacterIds, followedArcIds, spoilerMode, and updatedAt with runtime validation.
- [ ] #7 Anonymous device progress and authenticated progress cannot be read or modified across identities; merging or migration is explicit, authorized, and lossless.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification

- `npm run check` on the branch merged with `origin/main`: exit 0, **185 suites, 2905 passed, 5 skipped**.
- `npm run e2e` run alone (it is not part of `check`): **72 passed**.
- Focused suites: `npx jest convex/viewer/viewerProgress.test.ts convex/viewer/viewerProgressFunctions.test.ts src/components/recap/returnRecap.test.ts src/components/recap/viewerProgressKey.test.ts`; boundary policy via `npm run check:architecture` (19 modules) and `npm run test:architecture` (37 pass).

Five fault injections were run and reverted, each failing for the right reason:
narrowing the non-writing early return to a single code fails exactly the three
allocation tests; misclassifying a content-examining code fails the set pin plus two
metering tests; re-conflating "unpublished world" with "published but empty" accepts a
submission that must be refused; deleting the device-key guard in `getViewerProgress`
trips a `db` Proxy that throws on any property access; restoring the `recapFormats`
import fails `check:architecture` with `clientViewerProgress may not depend on editorial`.

## AC#7 is left unchecked, deliberately

Its second clause requires that merging anonymous and authenticated progress be
"explicit, authorized, and lossless". There is no viewer authentication in this
deployment, so authenticated progress is a provably empty set: any test of isolation
or merge would assert over nothing and pass for the wrong reason. ART-71 (FR-J003)
owns authenticated viewer identity and depends on this task.

The first clause IS delivered, structurally rather than by assertion. `viewerKey` is
namespaced in the stored value (`device:<digest>` now, `auth:<subject>` later) instead
of split across a second column, so ART-71 can write authenticated rows alongside
anonymous ones and merge them explicitly without rewriting any existing row. Every read
and write is keyed on the caller's own digest through `by_world_and_viewer` — no
caller-supplied row id, no scan — which is what makes cross-identity access impossible
by accident and by enumeration. It is not a defence against an adversary presenting
someone else's token, and the docblocks say so rather than implying more.

## AC#2, honestly scoped

Follow prioritisation is exercised over the device-level follow sets added here, which
did not previously exist anywhere in the product. Cross-device follows arrive with
ART-71. AC#2 is satisfied at device scope, not at account scope.

## Decisions worth carrying forward

Progress is stored server-side rather than composed client-side. That required raising
`maxViewerMutations` from 1 to 2 — the first widening of the viewer write surface since
the ballot — with the exhaustive pins updated in `publicReadOnlyGuarantee.test.ts` and
`check-boundaries.test.mjs`. The cap test now anchors the live policy to zero slack
before checking that cap+1 is rejected, so raising it again still needs two deliberate
edits. The homepage's zero-write and query-allowlist assertions are untouched
(`e2e/dynamicView.spec.ts` is +55/-0).

The ballot's device token and the progress token are different random values under
different `localStorage` keys. Sharing one would make "what this device voted" and "how
far this device has read" joinable on a single column.

Refusal policy: a refusal writes nothing when it was decided before the submission's
content was examined; the four that did examine content still spend an attempt, because
metering those is what the budget exists for. The partition is exported
(`NON_WRITING_REJECTION_CODES`) and the handler derives from it via
`refusalWritesNothing`, so it cannot drift into a second copy.

`viewerProgressCounters` is the repo's first standalone derived counter, argued on its
own merits (no per-world owning row; `.take(CEILING+1)` exceeds Convex's transaction
read cap at this ceiling; hanging it off `worldSchedules` would make an abuse control
contend with the slot scheduler). It is increment-only, which is safe only while
`viewerProgress` is never vacuumed. A test fails if the table is added to
`TablesToVacuum`: enabling retention without a reconcile path would drift the count
upward until a world locked itself out of recording progress, with no bug visible
anywhere except a `PROGRESS_WORLD_FULL` on an almost-empty world.

Vote consequences are reported for the latest world day only; the UI copy states that
limit rather than implying wider coverage.

## DoD#1 is left unchecked

"All acceptance criteria are satisfied" is not true while AC#7 stands unsatisfiable.
Every other DoD item is checked.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the §13.12 Viewer Progress record and the FR-H004 return recap built on it, so a viewer who never logs in gets a bounded account of what changed while they were away. Progress is stored server-side under a digest of a token the browser minted for itself, kept in a different localStorage key from the ballot's so the two cannot be joined on one column; every read and write is keyed on the caller's own digest, which makes cross-identity access impossible by accident and by enumeration but is not a defence against a presented token, and the docblocks say so. This is the second viewer-reachable mutation the deployment exposes, so maxViewerMutations moves 1 to 2 with the exhaustive pins updated and the homepage's zero-write assertions untouched. Verified on the branch merged with origin/main: npm run check exit 0 with 185 suites and 2905 tests passing, npm run e2e 72 passed run alone, plus five fault injections each failing for the right reason. AC#7 is left unchecked and DoD#1 with it: its merge clause needs authenticated progress, which is a provably empty set here, so ART-71 owns it; the isolation clause is delivered structurally via a namespaced viewerKey that lets authenticated rows be added later without rewriting any existing row. PR #210.
<!-- SECTION:FINAL_SUMMARY:END -->
