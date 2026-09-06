---
id: ART-148
title: >-
  LLM_MODEL=auto defeats the per-model token budget and drowns its own mismatch
  signal
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 05:40'
updated_date: '2026-09-06 12:01'
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

## 更正:本任務原本的描述說錯了根因

任務描述宣稱 `modelMeteringMismatches`「每一次呼叫都遞增」。**追到程式碼後,事實相反:它一次都不可能遞增。**

鏈路是閉環的:

```
sceneBudget: input.run(granted.model)
  → adapter:  trace.model = request.model ?? config.chatModel   // 就是 granted.model
  → sceneBudget: reportedModel = result.trace.model             // 又是 granted.model
  → settleReservation: settlement.model === settlement.reportedModel  // 恆等
```

`reportedModel` 的 docblock 寫著「the model the provider itself REPORTED running」,但它的來源是**我們送出去的請求**。這正是 CLAUDE.md §9 那條規則:**驗證器不得被餵入它自己的輸入,否則檢查就是恆真式**。整段漂移偵測是死的,而且它的註解主張了與程式碼相反的事。

我第一版的修正(對 alias 抑制 mismatch)因此是**在治一個不存在的症狀**,還讓一個本來就死的檢查更死。已推翻。

## 真正的缺陷:adapter 丟掉了閘道的答案

`openAICompatible.ts` 解析出回應 body 後,只用 `chatModel`(請求值)填 trace,`root.model` 從未被讀取。所以系統從來不知道 `auto` 實際跑了什麼。

## 對真部署實測到的閘道契約

`https://llm.shouri.app` 同一個回應同時給出:

- body `_routed_via`: `{ platform: 'xkiro', model: 'deepseek/deepseek-v4-pro' }` —— **物件**
- header `x-routed-via`: `xkiro/deepseek/deepseek-v4-pro` —— 字串,model 半段本身含斜線
- header `x-ratelimit-limit / -remaining / -reset`

兩種形狀都實作了,因為各自是其所在位置唯一可得的形式。字串形只在**第一個**斜線切分 —— 切最後一個會把 provider 讀成 `xkiro/deepseek`,一個 off-by-one 造成兩個錯誤歸屬。

我第一次的實作只處理字串形,`text(root._routed_via)` 對物件回傳 null,於是靜默退回 `root.model`:model 對了、provider 是 null。是實測才抓到,不是推理。

## 語意重寫(依你的定義)

- **usage 記在解析後的 `provider + model`,不是 alias。** `auto` 只是 routing alias,不擁有任何額度、速率或可靠度歷史。
- **mismatch = 預期的具體模型 vs 閘道回報的實際模型。** alias→具體**不是** mismatch(閘道正在做它的工作);具體→不同的具體**才是**。
- **`resolvedModel: null`(閘道沒說)既不是 mismatch 也不是可歸屬用量**,單獨計入 `unattributedCalls`。把「沒說」和「說了非預期的」併成一桶會讓兩者都不可讀。
- 新增 `usageByRoute`(provider / model / tokens / **requests**),因為免費層通常同時以 token 與 request 設限,只算 token 會讓 request 耗盡完全隱形。
- 同一個 model id 經兩個 upstream 各自消耗**各自的**免費額度,所以 route key 必須帶 provider。

## 兩處刻意的行為反轉(已在測試中明寫)

先前有兩條測試主張「mismatch 時 token 仍記在 metered key,讓評估過的上限就是被扣的上限」。那是**金額**語意下的正確答案,在這個部署下是錯的:所有 route 都是免費層,這些計數器是**免費額度歸屬**。實際跑的模型才是消耗了自己額度的那個,把 token 記在沒跑的模型上會同時謊報兩邊。分歧沒有遺失 —— 由 `modelMeteringMismatches` 與 ledger 的 `settledModel` 保存。

## 不再宣稱是「成本預算」問題

本任務原本的敘述帶有金額控制框架。此部署為 **free-only**,不需要金額預算,也不會為 `auto` 或任何 route 建立金額 bucket。相關描述已重寫為免費額度與速率歸屬。

## 證據

`npm run check` 全綠:**208 suites / 3401 passed**。

故障注入四次,每次只紅該紅的:

| 注入 | 轉紅 |
| --- | --- |
| adapter 不讀閘道答案(原始缺陷) | 「回報解析後的 route」 |
| route key 拿掉 provider | 三條 route 歸屬測試 |
| mismatch 不區分 null 解析 | 「具體請求 + 閘道沒回答不算 mismatch」 |
| 上限不解析 alias | 「上限綁定」 |

第三次注入**第一輪沒有轉紅** —— 我漏了「具體請求 + null 解析」這個組合的測試,補上後才紅。這正是「不可能失敗的斷言」,靠注入才發現。

**真部署驗證**(`probeConfiguredOpenAICompatibleProvider`):

```
model: "auto"  →  upstreamProvider: "xkiro"
                  resolvedModel:    "deepseek/deepseek-v4-pro"
```

修正前這個回應的路由資訊會被整個丟棄。

## 不屬於本任務的部分 → ART-158

`x-ratelimit-*` 三個 header 目前仍被丟棄(adapter 的 `request()` 不上傳 headers)。免費額度治理、429/耗盡時的 free-route fallback、每 route 可靠度統計,以及 `FREE_ONLY=true` 下「絕不 fallback 到 paid route」的強制不變量,都在 **ART-158**。本任務只做到讓實際 route **可被觀測與正確歸屬** —— 那是上述每一項的前提,但不是它們本身。
<!-- SECTION:NOTES:END -->
