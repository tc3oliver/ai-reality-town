---
id: ART-158
title: >-
  Free-only routing: quota, rate-limit and fallback governance for the auto
  chain
status: To Do
assignee: []
created_date: '2026-09-06 09:09'
labels:
  - prd-1.0
  - epic-o
dependencies: []
priority: high
ordinal: 158000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FREE_ONLY 部署下,`auto` 的實際路由已可觀測(ART-148),但「免費額度治理」本身尚未實作。本任務涵蓋其餘部分。

## 已知的閘道契約(對真部署實測,非推測)

`https://llm.shouri.app` 在同一個回應中同時提供:

- body `_routed_via`: `{ platform: 'xkiro', model: 'deepseek/deepseek-v4-pro' }`(物件)
- header `x-routed-via`: `xkiro/deepseek/deepseek-v4-pro`(字串,model 半段本身含斜線)
- header `x-ratelimit-limit: 120`
- header `x-ratelimit-remaining: 119`
- header `x-ratelimit-reset: 1788685622`(epoch 秒)
- header `x-request-id`, `x-freellm-cache`, `x-freellm-compress`

ART-148 已消費 `_routed_via`。**三個 `x-ratelimit-*` header 目前被完全丟棄** —— adapter 的 `request()` 只回傳 body,沒有把 headers 往上傳,所以速率與額度狀態進不了系統。

## 本任務要建立的不變量

`FREE_ONLY=true` 時:

- `auto` 鏈中只能包含 free-eligible route
- monetary cost 恆為 0,且**不建立任何金額 budget bucket**
- free quota 耗盡 → 可 fallback 到下一個 FREE route
- 429 → 可 fallback
- provider failure → 可 fallback
- 所有 free route 皆不可用 → **直接失敗**
- **絕不 fallback 到 paid route**(這是硬性失敗條件,不是偏好)

最後一條是本任務的核心:它必須是建置期或執行期會擋下來的東西,而不是註解裡的約定。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The adapter surfaces x-ratelimit-limit/remaining/reset from the gateway response instead of discarding them
- [ ] #2 Per-route free quota state (tokens, requests, RPM/TPM, daily allowance, reset time) is recorded against provider+model and is readable by an operator
- [ ] #3 A 429 or exhausted free quota falls back to the next FREE route in the chain, and the fallback is recorded
- [ ] #4 A provider failure falls back to the next FREE route
- [ ] #5 When every free route is unavailable the call FAILS rather than escalating; no paid route is ever selected
- [ ] #6 FREE_ONLY=true is enforced by a test that fails if a paid or non-free-eligible route can be reached from the auto chain
- [ ] #7 Monetary cost is not modelled anywhere in the free-only path: no currency budget bucket is created for auto or for any resolved route
- [ ] #8 Reliability statistics per route (failures, 429s, fallbacks) are recorded so a consistently failing free route is visible
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
