---
id: ART-145
title: 'Scope the Jest test run to the working checkout, not to linked worktrees'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-25 12:18'
updated_date: '2026-08-25 12:28'
labels: []
dependencies: []
ordinal: 145000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Problem / Context:** Jest walks `rootDir` on disk and cannot distinguish a linked git worktree from a source directory. `.claude/worktrees/` holds full checkouts of other branches, each with its own copy of every spec, so a run in the main checkout collected 958 test files instead of 164 — 794 of them belonging to branches that were not checked out.

This is a correctness defect, not only a performance one. The gate reported on code outside the working tree: an unrelated branch mid-refactor turns `npm run check` red for reasons the developer cannot see, and a stale copy of a spec can report green for a file that no longer exists. Measured impact: over fifteen minutes against forty-one seconds on a clean checkout.

CI never caught it because `.claude/worktrees/` is gitignored, so no worktree exists there and the collection scope is accidentally correct on a clean clone. The defect appeared only for whoever was using worktrees — which, in an agent-driven workflow, is everyone.

Discovered while verifying ART-134.

**Scope:** Add the worktree exclusion to all three Jest projects; pin it with a regression test.

**Security Impact:** None.

**Validation Commands:** `npm run check`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Jest collects no test file from .claude/worktrees/ in any of the three projects
- [x] #2 The node_modules exclusion the a11y and dom projects relied on by default is preserved when testPathIgnorePatterns is set
- [x] #3 A regression test fails if any project loses the exclusion
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
- [ ] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Hoist a shared `IGNORED_PATHS` constant in `jest.config.ts` holding `/node_modules/` and `<rootDir>/\.claude/worktrees/`.
2. Apply it to all three projects. The `unit` project spreads it alongside its existing `e2e`/`.a11y`/`.dom` exclusions; `a11y` and `dom` had NO `testPathIgnorePatterns` at all, so they must list `/node_modules/` explicitly — Jest's default is `['/node_modules/']` and setting the option REPLACES the default rather than extending it, so adding a worktree pattern naively would silently drop the node_modules exclusion those two projects had been relying on.
3. Anchor the pattern at `<rootDir>/` and escape the dot in `.claude`: these are regular expressions, not globs, so a bare `.claude/worktrees/` would match more broadly than it reads.
4. Pin all of it in `jest.config.test.ts`, including the project count, so a fourth project added later fails this file rather than slipping past the guarantee.
5. Prove non-vacuity by fault injection rather than by assertion count.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 量測到的實際影響

修正前後皆以 `npx jest --listTests` 計數(同一個 working tree,五個 linked worktree 存在):

| | 收集到的測試檔 | 其中來自 .claude/worktrees/ |
|---|---|---|
| 修正前 | 958 | 794 |
| 修正後 | 164 | 0 |

亦即有 **83% 的收集量屬於未被 checkout 的分支**。時間上,乾淨 worktree 中同一道 `npm run check` 為 41 秒,主 checkout 則超過十五分鐘——但慢只是症狀,真正的缺陷是**閘門在報告不屬於當前工作區的程式碼**。

## 兩個實作上的意外,都不是原本預期的部分

1. **設定 `testPathIgnorePatterns` 會取代而非擴充預設值。** Jest 的預設是 `['/node_modules/']`,而 `a11y` 與 `dom` 兩個 project 原本**完全沒有**這個選項,因此是靠預設值排除 node_modules 的。若只是天真地加上 worktree pattern,就會靜默地把它們原本仰賴的 node_modules 排除弄丟——同一個 bug 的第二個、更安靜的版本。兩半都已釘住。

2. **這支測試不能放在 repo 根目錄,也不能 import 設定檔本身。** 先後撞到兩個獨立的 ESM 問題:(a) 從 spec 直接 `import './jest.config'` 在 `default-esm` preset 下會拋 `ReferenceError: exports is not defined`——設定檔正是決定 transform 的那個檔案,本身並不照一般 source module 的方式被轉譯;(b) 改讀原始碼文字後,根目錄檔案在 `--experimental-vm-modules` 下仍失敗,因為真 ESM 沒有 `__dirname`。最終落腳 `scripts/architecture/`,以 `process.cwd()` 解析路徑,與 `readOnlyWorldSurface.test.ts` 同一慣例。

讀原始碼文字而非 import,最後反而是**比較對的**做法而不只是變通:它斷言的是設定檔**寫了什麼**,而不是某一個特定 loader 對它的詮釋,並且與本 repo 既有的跨模組防漂移釘法一致(`homeRoute.test.ts` 對 `storyOverlayModel.ts` 就是這樣做的)。

## 非空洞性(fault injection,兩次)

- 拿掉 `dom` project 的 `IGNORED_PATHS` → 1 failed / 6 passed。
- 把 `\\.claude` 的跳脫拿掉(改成會匹配 `xclaude` 的 `.claude`)→ 3 failed / 4 passed。
- 兩次還原後皆 7 passed。

備份一律用 `mktemp -d` + `cp`,不用 `git checkout <file>`。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
把 Jest 的收集範圍限縮回當前 checkout。

`.claude/worktrees/` 底下是其他分支的完整 linked worktree,每個都帶著整個 repo 的 spec 副本;Jest 走訪 `rootDir` 時無法分辨 worktree 與原始碼目錄,於是主 checkout 的一次執行會收集 958 個測試檔而非 164 個,其中 794 個屬於根本沒被 checkout 的分支。這不只是慢(十五分鐘 vs 四十一秒),而是**閘門在報告工作區以外的程式碼**:一個正在重構中的無關分支會讓 `npm run check` 轉紅,而執行的人看不出原因;反過來,一份過期的 spec 副本也可能為一個已不存在的檔案報綠。CI 從未觸發此問題,因為 `.claude/worktrees/` 被 gitignore,乾淨 clone 上的收集範圍是**碰巧**正確的——這正是它得以存活的原因。

作法:在 `jest.config.ts` 提出共用的 `IGNORED_PATHS`,三個 project 全部套用。`node_modules` 明列而非沿用預設,因為設定該選項會**取代**而非擴充 Jest 的預設值,而 `a11y`／`dom` 原本正是靠預設值排除它的。pattern 以 `<rootDir>/` 錨定且跳脫 `.claude` 的點號(這些是正規表達式而非 glob)。

驗證:`npm run check` 全綠——165 suites、2566 passed、5 skipped(既有的長時模擬測試)、build OK、architecture boundaries valid。`npx jest --listTests` 由 958 降為 164,來自 worktree 者為 0。非空洞性以兩次 fault injection 證明(移除 dom 的排除 → 1 failed;移除點號跳脫 → 3 failed),還原後皆 7 passed。
<!-- SECTION:FINAL_SUMMARY:END -->
