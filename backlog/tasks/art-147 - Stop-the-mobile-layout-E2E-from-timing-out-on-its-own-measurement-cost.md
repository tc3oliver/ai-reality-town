---
id: ART-147
title: Stop the mobile layout E2E from timing out on its own measurement cost
status: Done
assignee:
  - '@claude'
created_date: '2026-08-25 15:15'
updated_date: '2026-08-25 15:34'
labels: []
dependencies: []
ordinal: 147000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Problem / Context:** `[mobile] AC#8 — the layout is map-first when stacked and side-by-side when wide` has failed on `main` since PR #200, exceeding Playwright's 60s test timeout on CI runners. The same test passes locally in 19s, so it is not a code defect — the test had grown too expensive for the budget it runs in.

The cost is in its final loop, which called `boundingBox()` on every `main .public-tap` control in turn. There are 44 on the live map today and the count only grows as features add controls (ART-131 chips, ART-127 ladder, ART-135 accessibility affordances). Each call is a round trip that also waits for actionability, and over a continuously animating canvas that waiting is not free. Because the growth is cumulative, the failure appeared suddenly and consistently rather than as an intermittent flake, and `retries: 0` means one slow run is a red gate.

Raising the timeout would fit the gate to the noise. Measuring all controls in a single `page.evaluate` removes the cost instead.

**Scope:** Batch the touch-target measurement; keep the skip-invisible semantics and add a non-vacuity floor.

**Security Impact:** None — test-only.

**Validation Commands:** `npm run e2e`, `npm run check`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The mobile AC#8 spec completes well within the Playwright timeout
- [x] #2 It still fails when a touch target drops below the WCAG 2.5.5 floor, and names the offending controls
- [x] #3 Controls that are not rendered are still skipped rather than asserted against
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 量測到的成本

| | 本地耗時 | CI |
|---|---|---|
| 修正前 | 19.0s | 逾時(>60s) |
| 修正後 | **4.2s** | — |

同一個測試在本地 19 秒通過、在 CI 逾時,差距不是缺陷而是**測試自身的成本**太貼近預算。`main .public-tap` 目前有 **44 個**控制項,舊迴圈對每一個各發一次 `boundingBox()`,每趟都是往返且附帶 actionability 等待,而底下的畫布持續動畫,等待並不便宜。由於控制項數量是**累積**成長的(ART-131 的 chips、ART-127 的降級階梯、ART-135 的無障礙控制項),失敗才會表現為突然且穩定,而非間歇性 flake;`retries: 0` 讓慢一次就是紅。

調高逾時是把閘門遷就雜訊,所以改為單次 `page.evaluate` 一併量測,直接移除成本而非容忍它。

## 兩個必須保留的語意

1. **未渲染的控制項仍然跳過。** `getClientRects().length === 0` 對應舊寫法的 `boundingBox() === null`:沒有被繪出的元素沒有框可量,對一個根本不存在的控制項斷言 44px 會是假失敗。
2. **加上非空洞性下限。** 新增 `expect(targets.length).toBeGreaterThan(0)` — 空清單會讓底下每一條斷言都成立卻什麼都沒證明,而批次量測正好讓「一個都沒抓到」變成一種可能的失敗模式。

順帶改善:斷言改為比對**過小控制項的清單**而非布林值,失敗時會直接指名是哪些控制項縮掉了。

## 非空洞性

把 `src/index.css` 的 `.public-tap` `min-height`／`min-width` 由 44px 注入為 20px,重建 e2e bundle 後測試失敗,並列出違規控制項(「重播今日事件」、「聚焦此場景」、「查看 方悅 的完整角色頁」等)。還原後 4.1s 通過。備份用 `mktemp -d` + `cp`。

## 驗證

- `npm run e2e`:EXIT=0,**66 passed**(desktop + mobile)。
- `npm run check`:EXIT=0,175 suites / 2693 passed。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
把 mobile AC#8 的觸控目標量測由 44 次瀏覽器往返改為單次 `page.evaluate`。

該測試自 PR #200 起在 CI 上逾時(60s),本地卻 19 秒通過 — 不是程式缺陷,而是測試成本隨著控制項數量累積成長後超出預算。調高逾時等於把閘門遷就雜訊,因此改為移除成本本身:19.0s → 4.2s。

保留兩個語意:未渲染的控制項仍跳過(`getClientRects().length === 0` 對應原本的 `boundingBox() === null`),並新增非空洞性下限,因為批次量測讓「一個都沒抓到」成為新的可能失敗模式。斷言改列出過小的控制項而非布林值,失敗時會指名對象。

驗證:`npm run e2e` EXIT=0(66 passed)、`npm run check` EXIT=0(175 suites / 2693 passed)。非空洞性:將 `.public-tap` 的 min-height/width 注入為 20px 後測試失敗並列出違規控制項,還原後通過。
<!-- SECTION:FINAL_SUMMARY:END -->
