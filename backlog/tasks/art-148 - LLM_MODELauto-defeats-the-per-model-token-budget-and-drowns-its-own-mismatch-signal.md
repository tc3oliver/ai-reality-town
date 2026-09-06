---
id: ART-148
title: >-
  LLM_MODEL=auto defeats the per-model token budget and drowns its own mismatch
  signal
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-29 05:40'
updated_date: '2026-09-06 08:49'
labels:
  - prd-1.0
  - epic-o
dependencies: []
priority: high
type: bug
ordinal: 148000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The deployment sets LLM_MODEL to the alias `auto` rather than a concrete model id. ART-59 keys its daily cap and its counters on the model id (`tokensByModel`, keyed via `addModelTokens`), and settlement books tokens under the *metered* model returned by the provider. With `auto`, the reservation is keyed on a string that is never a real model, so (a) the per-model daily cap never binds to any actual model and is effectively unenforced, and (b) the requested-vs-settled metering mismatch counter trips on every single call, so the counter that exists to detect real drift is saturated by design and its signal is unusable. This was surfaced while delivering ART-59 and is a live production-configuration hazard, not a theoretical one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The per-model daily cap binds to the concrete model actually used when the configured model is an alias
- [x] #2 The requested-vs-settled metering mismatch counter does not increment for the expected alias-resolution case, and still increments for genuine drift
- [x] #3 A test pins the alias case so a regression turns it red
- [x] #4 The operator-facing budget surface shows the resolved concrete model, not the alias
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 根因

`auto` 不是模型,是別名 —— 由 gateway 逐次呼叫決定實際模型。把它當成一般模型 id 處理,同時往**兩個相反方向**破壞了這個子系統:

- 每模型日上限計在一個叫 `auto` 的 bucket,而真實模型永遠不會往那裡花費 → 上限**實質上未生效**
- `modelMeteringMismatches` 每一次呼叫都遞增,因為計量鍵(`auto`)永遠不等於回報鍵 → 用來偵測靜默漂移的計數器**依設計即飽和**,與從不觸發無異

## 改動

- `MODEL_ALIASES` / `isModelAlias`:**常數而非 policy 欄位** —— 哪些 id 是別名是 gateway 的性質,不是某個世界預算的性質;開放設定等於邀請世界對一個它不擁有的問題給出錯誤答案
- `settlementBookingModel`:別名記在**回報的實際模型**下;具體 id 維持記在計量鍵下(真正的漂移若跟著 provider 跑掉,反而會離開上限正在監看的 bucket)
- `isModelMeteringMismatch`:別名解析**不算**漂移;具體對具體的漂移照常計數
- `BudgetCounters.aliasResolutions`(schema 為 `v.optional`,舊列免遷移):記錄別名今日解析到的具體模型
- `evaluateReservation`:每模型上限透過 `resolveModelForCounters` 綁定到解析後的模型

## 誠實的限制(已寫成測試,不是註解)

**當日第一次別名呼叫無法綁定上限** —— 具體 id 在 gateway 回應前並不存在。上限自第二次呼叫起生效。這比計在一個沒人花費的 bucket 嚴格更好,但它是真實的缺口,因此有一條具名測試釘住它,以免後人誤以為是疏漏。

## 證據

`npm run check` 全綠:**208 suites / 3391 passed**(+9)。

三次故障注入,每次都只紅在該紅的地方:

| 注入 | 轉紅 |
| --- | --- |
| 移除別名的 mismatch 抑制 | 僅「不算漂移」那條 |
| 記帳鍵改回別名 | 「記在實際模型下」+「上限綁定」兩條 |
| 上限不再解析別名 | 僅「上限綁定」那條 |

「仍計數具體對具體的真實漂移」在注入 1 期間維持綠色,所以它確實隔離的是別名路徑,而不是跟著一起壞。第二次注入紅兩條是正確的:上限綁定本就依賴記帳落在具體模型上,而該測試以 `expect(tokensForModel(counters, CONCRETE)).toBe(950)` 明確守住這個前提。

## 尚未在真部署上驗證 —— 原因說明

**目前這個缺陷在本部署是潛伏的,不是活躍的。** `worldDayLiveFunctions.ts:267` 把 `deploymentModelId` 綁成 `FAKE_SCENE_MODEL`,因為 world-day 路徑用的是確定性 `FakeWholeSceneProvider`。因此 `auto` 今天根本不會抵達預算閘門,跑一個 slot 也不會經過本次修正的程式碼。

危害會在 ART-72 把真實 adapter 接上時變成活躍 —— 屆時 `deploymentModelId` 會回傳 `auto`。本修正讓那一刻不再帶著一個未生效的上限與一個飽和的計數器上線。我沒有為了取得「真部署證據」而去改動 provider 綁定:那會是為了讓驗證好看而變更生產設定。

## AC 對照

- **#1** 已達成(附上述第一次呼叫的限制)
- **#2** 已達成:別名解析不遞增,具體漂移照常遞增
- **#3** 已達成:9 條具名測試 + 3 次故障注入
- **#4** 已達成:`inspectTokenBudget` 原樣回傳 counters,而 `tokensByModel` 現在鍵在具體模型上,另有 `aliasResolutions` 顯示 `auto` 解析到什麼;ledger 的 `settledModel` 早已記錄具體模型
<!-- SECTION:NOTES:END -->
