---
id: ART-129
title: Add the dynamic homepage entry point
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 15:59'
updated_date: '2026-08-24 15:41'
labels:
  - prd-2.0
  - v2-h
  - epic-p
dependencies:
  - ART-118
  - ART-111
priority: high
type: feature
ordinal: 129000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-P001 (PRD 2.0 §12 Epic P)

**Problem / Context:** The homepage currently presents text headings and lists, which PRD 2.0 §4.1 identifies as the core product gap. UX2-001 requires viewers to see the world before reading about it.

**Goal:** A homepage first screen that leads with the living world and routes viewers into it.

**Scope:**
- Live Town entry point or dynamic preview above the fold.
- Current situation, primary active story arc, up to four core characters, latest major event, recommended Episode.
- Core characters rendered with their existing sprite / visual identity.
- Clicking a character, scene or arc navigates to the corresponding page.

**Out of Scope:** Live page itself (FR-O001); design system (FR-P003).

**Dependencies:** FR-O001 live map; FR-N004 character visual bindings.

**Schema Impact:** None.

**API Impact:** Consumes existing public read projections.

**Security Impact:** Public homepage must trigger no LLM call.

**Test Requirements:** Tests asserting the first screen is not text-only, that character visuals match bindings, and that the homepage triggers no generation.

**Validation Commands:**
- `npm run check`
- Browser E2E of the homepage first screen.

**Documentation Impact:** Homepage composition notes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The homepage first screen provides a Live Town entry point or dynamic preview
- [x] #2 The first screen shows current situation, primary story arc, up to four core characters, the latest major event and a recommended Episode
- [x] #3 The first screen is not only text headings and lists
- [x] #4 Core characters use their existing sprite and visual identity
- [x] #5 Clicking a character, scene or arc navigates to the corresponding page
- [x] #6 The public homepage triggers no LLM call
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
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
驗證(ART-129 最終): `npm run check` 綠燈 — 150 test suites / 2285 passed / 5 skipped,typecheck、lint、architecture boundaries、asset licences、`vite build` 全過。`npm run e2e` 綠燈 — Playwright Chromium,desktop(1440x900)與 mobile(Pixel 5)兩個 project 共 56 passed。

非空轉證據(fault injection):在 disclosure 區塊注入指向同一集的第二個 Episode 連結,`the recommended Episode is linked once` 立即紅燈(Expected 1, Received 2),還原後恢復綠燈。備份走 `mktemp -d` + `cp`,未使用 `git checkout`。

收尾時修掉兩件本次改動連帶造成的問題:
1. 推薦 Episode 在第一畫面與 認識這個世界 區塊各出現一次,指向同一個 href — 對依連結導覽者是同一目的地兩次。移除 disclosure 的那一個,並把「尚未推薦」空狀態一併搬上第一畫面(否則觀看者無法分辨「沒有推薦」與「這一段壞了」)。新增測試以整頁計數釘住恰一個且位於第一畫面。
2. `docs/prd-2.0-requirement-matrix.md` 的 Epic P 與 Epic Q 兩張表頭只有 6 欄,但 ART-130/131/135/137 寫入的 Done 列是 7 欄 — GFM 會**丟棄**超出表頭的儲存格,那些任務的重用證據在算繪後根本不顯示。已補上 `重用證據` 欄並把兩表所有列正規化為 7 欄(無證據者填 `—`)。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
首頁第一畫面改為以活著的世界帶頭(FR-P001)。新增單一 `<section class="home-first-screen">`,內含 AC#2 全部欄位:實況地圖為首要動作(旁邊恆常並列文字實況等價入口,NFR-009 AC#3)、至多四位居民**畫出來**、現況、主線 arc、最新大事、至多兩個進行中場景、推薦 Episode;拆成五個 section 會在設計系統的 `main > section` 規則下變成五張卡,那正是 UX2-001 要停止的目錄。

零新增查詢:`activeArcs`／`activeScenes` 是首頁早已為實況區塊抓取的同一份 `live:` 已發布模型的另外兩個欄位,故「公開首頁不觸發 LLM」依構造成立。畫居民**不重用地圖的頭像管線**(`useSpriteAssets()` 在 `clientLive`,反向依賴會成環);`CharacterSprite` 直接讀無模組歸屬的 `data/spritesheets/catalogue`,從同一張材質切同一格,**無須任何邊界變更**。差異明說:畫的是 base cell 而非調色盤變體,四位變體居民因此與其本體同形,但 binding 仍是自己的。

過程中抓到兩個真實缺陷:(a) `mistwoodCharacterSpriteKeys` 回傳的是**資產** key(帶變體後綴),`isSpriteKey` 全部拒收,四位居民會靜默退化成 `data-sprite="none"` — 改走 `MISTWOOD_CHARACTER_VISUALS` 並以逐一比對共享表的測試釘住;(b) onboarding fixture 沒有 `characters`,第一畫面無人可畫 — 補齊並由 `fixtureWorld.test.ts` 釘住。收尾另修掉推薦 Episode 的重複連結,以及需求矩陣兩張表頭少一欄導致先前四個任務的重用證據在 GFM 下被丟棄不顯示。

驗證:`npm run check` 綠燈(150 suites / 2285 passed,含 typecheck、lint、architecture、build);`npm run e2e` 綠燈(Playwright desktop + Pixel 5 共 56 passed,AC#3/#4 以 `new Image()` 實際載入材質而非只斷言 URL,AC#6 同時讀 `window.__ART137__` 與瀏覽器網路層);重複連結斷言以注入證明非空轉。未機器化者:第一畫面對人是否讀起來像活著的世界,列為人工覆核並歸於 ART-138 發布關卡。文件:`docs/homepage-composition.md`。
<!-- SECTION:FINAL_SUMMARY:END -->
