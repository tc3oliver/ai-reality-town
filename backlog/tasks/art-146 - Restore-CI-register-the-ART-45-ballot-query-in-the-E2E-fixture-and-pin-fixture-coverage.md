---
id: ART-146
title: >-
  Restore CI: register the ART-45 ballot query in the E2E fixture and pin
  fixture coverage
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-25 14:47'
updated_date: '2026-08-25 14:50'
labels: []
dependencies: []
ordinal: 146000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Problem / Context:** CI's Browser E2E job has been failing on `main` since PR #204 (ART-45) merged.

ART-45 mounted `EnvironmentVotePanel` on the homepage, which queries `getEnvironmentVoteBallot`, but did not register that query in `src/e2e/fixtureConvexClient.ts`. The fixture transport THROWS on an unregistered query by design — a good choice, because a silently-undefined query renders as an ordinary loading state and a spec waits forever for data that is never coming. But the throw happens during render, so ONE unregistered query takes down the WHOLE page.

The result was not 'the vote section is missing'. It was an empty `<body>`, and the three specs that turned red belonged to **ART-129** — a task with nothing to do with voting, whose code was untouched. CI pointed at the wrong feature.

`npm run check` could not catch it either: the defect exists only in a browser, because no unit suite mounts the app through the fixture transport. It took a full E2E run to surface and the diagnosis started at the wrong end of the codebase.

Note also that PR #204 merged while this job was red — the Browser E2E check is evidently not a required status check on the branch protection rule.

**Scope:** Register the ballot query; widen ART-129's AC#6 query assertion to cover the legitimate new read; add a unit-level pin so this class of omission fails at `npm run check` instead of in CI.

**Security Impact:** None — the fixture serves `null` (a real return value of the query) and no handler is added for any mutation.

**Validation Commands:** `npm run check`, `npm run e2e`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The E2E fixture serves every public query the client bundle references
- [x] #2 ART-129 AC#6 still proves the homepage triggers no generation, and names each query it permits
- [x] #3 A missing fixture for a referenced public query fails npm run check, not only the browser E2E
- [x] #4 No fixture handler exists for any mutation, so the zero-write evidence still holds
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
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 根因,以及為何三道閘門都沒攔住它

fixture transport 對未註冊的 query **拋例外**(`fixtureConvexClient.ts`)。這個設計是對的 — 靜默回傳 undefined 會渲染成普通的載入中狀態,spec 便會永遠等一份不會到來的資料。但拋出的時機在 render 之中,所以**一個**未註冊的 query 會帶走**整個頁面**。

實測到的症狀不是「投票區塊不見了」,而是 `<body>` 全空。轉紅的三個 spec 屬於 **ART-129**,一個與投票毫無關係、程式碼完全沒被動過的任務。CI 指向了錯誤的功能。

`npm run check` 也攔不住,因為這個缺陷**只存在於瀏覽器中**:沒有任何單元測試會透過 fixture transport 掛載整個 app。於是它只能靠一次完整 E2E 才浮現,而診斷的起點還是錯的那一端。

另外值得記錄:PR #204 是在這個 job 已經紅的情況下合併的 — 顯示 Browser E2E 並不是 branch protection 的必要檢查項。

## 三處修正

1. **註冊 handler,回傳 `null`。** 這不是 stub:`null` 是 `getEnvironmentVoteBallot` 實際會回傳的兩個值之一,也正是「沒有進行中輪次」時的回傳值,而那是新種下的世界的預設狀態。首頁投票區塊據此渲染其關閉狀態,與 ART-45 出現之前完全一致。

2. **ART-129 AC#6 的斷言由前綴 regex 改為明確白名單。** 原本的 `^publicRead/\w+:get` 同時在做兩件事,而且只做好一件:它settle了「不觸發生成」,卻也**默許任何未來新增於 `publicRead/` 之下的查詢** — 首頁多長出第五個讀取也不會有人被告知;同時它又對 ART-45 那個合法的 `viewer/` 讀取報錯,理由是錯的(該查詢同樣是已發布讀取、同樣不觸發生成)。改為逐一具名後,每一次新增都成為一個被審視過的決定。這比原本**更強**而非更寬鬆。白名單不可能被用來夾帶寫入:投票的寫入是 mutation,會落在 `recorded.writes`,而上一行仍然要求它是空的。

3. **新增 `src/e2e/fixtureCoverage.test.ts`,把這一類疏漏往前挪到 `npm run check`。** 兩邊都由既有的宣告推導而非手工清單:客戶端呼叫了什麼,取自 `src/` 底下所有 `publicFunctionRef('path:name')` 字面值(那是客戶端模組指名公開函式的唯一途徑);其中哪些是 query,取自 `architecture/module-boundaries.json` 的 `publicFunctionSurface.allowed`(已由 `check:architecture` 強制)。mutation 被排除,因為 fixture **本來就該**拒絕它們 — ART-137 的零寫入證據正建立在那個拒絕之上,所以另外加了一條測試,斷言**沒有任何 mutation 被註冊 handler**。

## 非空洞性

移除本次新增的 fixture handler(即精確重現 ART-45 當初的疏漏)→ `fixtureCoverage.test.ts` **2 failed / 2 passed**,且失敗訊息直接指名缺少的 key `viewer/environmentVoteFunctions:getEnvironmentVoteBallot`。還原後 4 passed。

實作過程中這支測試還抓到自己:它原先掃描包含測試檔,於是把自己註解裡用來說明模式的 `publicFunctionRef('path:name')` 也算成一個參照。已排除測試檔並記錄理由 — 讀取原始碼文字的測試必須把自己排除在語料之外,否則關於規則的散文會變成規則的實例。

## 驗證

- `npm run check`:EXIT=0,**175 suites / 2693 passed / 5 skipped**(既有長時模擬測試)。
- `npm run e2e`:EXIT=0,**66 passed**(desktop + mobile 全數)。修復前為 3 failed(desktop)+ 3 failed(mobile)。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
修復自 PR #204 起 main 上持續失敗的 CI。

ART-45 把 `EnvironmentVotePanel` 掛上首頁,卻沒有在 E2E fixture 註冊它的 `getEnvironmentVoteBallot` 查詢。fixture transport 對未註冊 query 的設計是拋例外,而拋出時機在 render 之中,因此一個缺漏的 handler 帶走了整個首頁 — 轉紅的是 ART-129 的三個 spec,一個程式碼未被動過的無關任務。

三處修正:(1) 註冊 handler 回傳 `null`,那是該查詢在沒有進行中輪次時的真實回傳值;(2) 把 ART-129 AC#6 的前綴 regex 改為明確白名單,這比原本更強 — 原 regex 會默許任何未來新增的 publicRead 查詢,又對合法的 viewer 讀取報錯;(3) 新增 `fixtureCoverage.test.ts`,由既有宣告推導兩邊清單,把這類疏漏從 CI 的 E2E 往前挪到 `npm run check`,並額外斷言沒有任何 mutation 被註冊 handler(ART-137 的零寫入證據正建立在該拒絕之上)。

驗證:`npm run check` EXIT=0(175 suites / 2693 passed);`npm run e2e` EXIT=0(66 passed,修復前 6 failed)。非空洞性:移除新增的 handler 重現原疏漏,新測試 2 failed 並指名缺失的 key。
<!-- SECTION:FINAL_SUMMARY:END -->
