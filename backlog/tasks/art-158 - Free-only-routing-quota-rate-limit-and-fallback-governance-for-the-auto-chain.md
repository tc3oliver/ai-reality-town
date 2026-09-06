---
id: ART-158
title: >-
  Free-only routing: quota, rate-limit and fallback governance for the auto
  chain
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-06 09:09'
updated_date: '2026-09-06 15:41'
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
- [x] #1 The adapter surfaces x-ratelimit-limit/remaining/reset from the gateway response instead of discarding them
- [x] #2 Per-route free quota state (tokens, requests, RPM/TPM, daily allowance, reset time) is recorded against provider+model and is readable by an operator
- [x] #3 A 429 or exhausted free quota falls back to the next FREE route in the chain, and the fallback is recorded
- [x] #4 A provider failure falls back to the next FREE route
- [x] #5 When every free route is unavailable the call FAILS rather than escalating; no paid route is ever selected
- [x] #6 FREE_ONLY=true is enforced by a test that fails if a paid or non-free-eligible route can be reached from the auto chain
- [x] #7 Monetary cost is not modelled anywhere in the free-only path: no currency budget bucket is created for auto or for any resolved route
- [x] #8 Reliability statistics per route (failures, 429s, fallbacks) are recorded so a consistently failing free route is visible
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
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## 先探勘,再設計(對 `GET /v1/models` 實測,254 個 route)

三個發現直接改變了本任務原本的設計假設:

### 1. 這個閘道**沒有** free/paid 之分 —— 整個端點就是免費層

所有 254 個 entry 的 `owned_by` 都是 `freellmapi`。全部 entry 的欄位聯集是:

```
available, context_length, context_window, created, execution_status,
id, name, object, owned_by, supported_parameters, unavailable_reason
```

**沒有任何價格、成本或方案欄位。** 所以:

- 「不可 fallback 到 paid route」在此閘道上**不是靠過濾模型達成的,而是靠指向哪個端點**。要守的不變量是:沒有任何程式路徑能把請求導向 FreeLLMAPI 以外的供應商,或在設定缺漏時退回付費預設值。
- 「monetary cost 為 0」不需要建模,因為根本沒有可建模的價格。要釘住的是**不存在**:任何金額 bucket 都不該被建立。

### 2. `available: false` 是真實且動態的 —— 254 中有 59 個不可用

不可用原因目前一律是 `no_key`。這正是 fallback chain 應該讀的訊號,而且它是**每個 route 各自**的狀態,不是全域的。

### 3. 「具體模型 id」也可能是 router —— 我的 alias 清單注定不完整

`claude-opus-4-5` 的 `name` 是 **「Opus slot (auto-routed to a free model)」**。它長得像具體模型,實際上是槽位。同類還有 `fusion`、`orcarouter-auto`、`bazaarlink-auto`、`free-router`、`kilo-auto`。

**後果:ART-148 的 `MODEL_ALIASES = {auto}` 會把這些 route 的正常行為誤判為 drift。** 請求 `claude-opus-4-5` 得到 `deepseek-...` 不是漂移,是它被記載的行為。

修正方向不是把清單補長(那永遠追不完),而是改變判準:**在一個 router 閘道上,`_routed_via` 存在本身就代表「這是路由,不是漂移」**。mismatch 只應在閘道**沒有**回報路由、而我們又請求了具體模型時才有意義。

## 實作切片

**A — 額度可觀測**:`request()` 目前不回傳 headers,所以 `x-ratelimit-limit / -remaining / -reset` 被整個丟掉。改為向上傳遞並進入 trace 與 counters(AC#1、#2、#8 的基礎)。

**B — free route fallback chain**:429 / `available:false` / provider failure → 換下一個 free route,並記錄該次 fallback。全部耗盡 → **直接失敗**(AC#3、#4、#5)。

**C — 不變量與否定性釘樁**:FREE_ONLY 下不可達 paid route 的測試;以及「沒有任何金額 bucket 被建立」的測試(AC#6、#7)。

**D — 修正 ART-148 的 alias 判準**,依上述發現 3。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 對真部署量到的關鍵事實(決定了 chain 的設計)

用三次連續呼叫、故意換 model id 測 allowance 範圍:

| # | asked | status | routed | remaining |
| --- | --- | --- | --- | --- |
| 1 | `auto` | 200 | xkiro / deepseek-v4-pro | 119 |
| 2 | `gemini-2.5-flash` | **429** | null | 118 |
| 3 | `auto` | 200 | xkiro / deepseek-v4-pro | 117 |

兩個結論,方向相反,都很重要:

1. **額度是 per-API-key,不是 per-route。** 換 model id 仍從同一個 120 的池子扣。所以「換一條 route 來繞過額度」**行不通**,而且每次 fallback 嘗試**都會再扣一次 key 額度**(429 那次也扣了)。chain 必須有上限,不能無限試。

2. **但 429 是 per-route 的。** 第 2 次在 remaining=118(還很充足)時就 429,而緊接著第 3 次 `auto` 成功。所以某條 route 被限流**不代表** key 用完 —— 換一條確實可能成功。

因此 fallback chain **值得做**,但它的用途是繞過「單一 route 不可用/被限流」,不是繞過帳號額度。把它寫成後者會是一個結構上不可能成立的功能。

## AC#2 — real time-bucketed RPM/TPM

Deriving rates from `tokenBudgetCounters` was rejected outright: a world day is a simulation cursor an operator can accelerate, pause or hand-advance, so a per-minute figure computed from it has no relationship to the last sixty seconds and resets at a moment unrelated to request rate.

**Window.** Epoch-aligned one-second buckets; `bucketStartMs = floor(atMs/1000)*1000` covering `[start, start+1000)`. The window at `now` is `bucketStartMs > now - 60_000` — trailing 60s quantised to the second, at most 60 buckets per route. Expiry is applied as a COMPARISON in `summarizeProviderRates`, not delegated to the vacuum, so a stale row cannot inflate a rate; the range read is separately bounded by the same window so read cost does not grow with world age.

**Counted at the fetch seam.** Every seam above it counts something coarser than a request: per scene misses semantic retries, per reservation misses route hops, per structuredChat misses hops, per hop misses the transport ladder. One fetch is one request the gateway received.

**Honest counting.** A 429 is a request AND separately `rateLimited`. Tokens stay null when the gateway reported none (`callsWithoutUsage` carries the blind spot) — zero and 'did not say' are indistinguishable once written. Buckets key on the REQUESTED route (the only identity a refused call has); resolutions are recorded alongside and sum to the request count including null entries. No price/tier/paid metadata anywhere.

**Operator surface.** `inspectTokenBudget` returns `providerRates`: requests, tokens, served/rateLimited/failed, callsWithoutUsage, resolutions, last allowance with reset, window bounds, and `truncated`.

**Evidence.** `providerRateWindow.test.ts` (24) specifies the window; `providerRateWiring.test.ts` (14) drives a REAL authoring call through the recorder the live action installs into the real registered mutations, only `fetch` stubbed. npm run check: 214 suites / 3538 passed, boundaries valid, build clean.

**Injections.** 12 (cumulative RPM) reddened 3 tests immediately. 13 (cumulative TPM) and 14 (window bound dropped from the read) both SURVIVED and exposed two real test holes — TPM was never pinned against the window independently of RPM, and the read bound was masked by the in-memory filter so its loss showed only as spurious truncation on an aged world. Both closed with new tests; re-injection then reddened each by name. No injection produced 'Tests: 0 total'.
<!-- SECTION:NOTES:END -->
