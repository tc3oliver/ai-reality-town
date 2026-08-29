---
id: ART-62
title: Server-side authorization and release security audit
status: To Do
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-29 12:43'
labels:
  - prd-1.0
  - epic-q
milestone: m-0
dependencies:
  - ART-40
  - ART-48
  - ART-49
  - ART-51
  - ART-53
  - ART-56
  - ART-57
  - ART-72
  - ART-84
  - ART-85
  - ART-95
  - ART-96
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-005, Public Test AC 20–23

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Audit every administrative/public boundary, secret/log handling, viewer input, license/attribution, Critical/High findings, and safeguards preventing production deployment.

Scope
Audit every administrative/public boundary, secret/log handling, viewer input, license/attribution, Critical/High findings, and safeguards preventing production deployment.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-40, ART-48, ART-49, ART-51, ART-53, ART-56, ART-57, ART-72, ART-84, ART-85, ART-95, ART-96

Schema Impact
No product domain schema; owns release checklist, audit findings, traceability, and verification evidence.

API Impact
Read-only audit/verification access to completed public and administrative boundaries.

Security Impact
Release remains blocked by missing evidence, unresolved Critical/High findings, or enabled production deployment.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Repeatable security checks and manual evidence cover all privileged routes and data classes.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every public API and administrative mutation route has server-side authorization evidence.
- [x] #2 Public/private data, trace/log redaction, viewer input, publication, and emergency-control boundaries are audited.
- [ ] #3 No unresolved Critical or High security finding remains before public test.
- [x] #4 License/attribution is retained and production deployment remains disabled.
- [x] #5 Audit evidence identifies tested routes, roles, data classes, findings, and remediation.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Recon: map all Convex public queries/mutations/actions, all admin/ops mutations, all trace/log write paths, and every viewer-input entry point. Build a route x role x data-class inventory.
2. Public read boundary audit: read convex/publicRead/* (sanitizeForPublic + every rebuild*Projection), independently trace whether a forbidden/private field can reach a public projection. Attack angles: unsanitized passthrough, nested objects, spread operators, arrays of records, spoiler-mode leakage, unpublished/draft content, private memory/knowledge, LLM trace/prompt text, provider metadata.
3. Admin/ops boundary audit: read convex/operations/operatorAuthorization.ts and every operations/*Functions.ts + simulation/*Operations.ts. Verify EVERY privileged mutation is actually wrapped by the role gate (viewer<operator<admin). Independently assess the shared ops-token fallback (timing safety, argument logging, replay, role escalation) rather than trusting the prior self-assessment. Check for unauthenticated internal* vs public mutation exposure.
4. Secret/log handling audit: read convex/observability/trace.ts + traces.ts + observability/model.ts and convex/safety/*. Verify API keys/base URLs/auth headers/ops token cannot reach a trace record, console log, error message, or any public read path. Check provider client code (simulation/providers/*) for key leakage into thrown errors.
5. Viewer input audit: read convex/safety/viewerInput.ts and search for real call sites. If the classifier has zero production callers, record it as an explicit finding (unenforced control), not a pass.
6. Untrusted content -> provider/publication audit: verify LLM-proposed content cannot bypass pre/post-generation safety on its way to a published episode or back into a provider prompt (prompt injection surface).
7. License/attribution audit: package.json, LICENSE, ATTRIBUTION.md, docs/upstream.md, docs/open-source.md vs upstream AI Town; verify dependency licenses.
8. Production-deployment safeguard audit: look for an ACTUAL technical block (env guard, deploy config, CI gate) not just prose in README/vercel.json/fly/Dockerfile/scripts. If only prose exists, record the finding and recommend a scoped follow-up task rather than silently building a deploy blocker.
9. Write docs/security-audit-art-62.md: route/role/data-class inventory + every finding rated Critical/High/Medium/Low/Info with what-was-checked, what-was-found, exact file:line evidence, and fix-or-defer decision.
10. Fix only small/safe in-scope defects; record everything else as an explicit unresolved finding with a recommended follow-up task.
11. npm run check green; update PRD traceability + docs; HONEST AC/DoD checkboxes -- if any Critical/High finding is unresolved, AC#3 stays unchecked and release is reported NOT clear.
12. Commit (conventional prefix, no AI co-author trailer), merge origin/main, re-run npm run check, push, gh pr create, gh pr merge --auto, flip to In Review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Audit executed (ART-62)

Adversarial source review of every client-reachable Convex route, the admin boundary, secret/log handling, viewer input, license/attribution, and deploy safeguards. Full report: docs/security-audit-art-62.md.

Method note: the primary technique was enumerating the ACTUAL client-reachable surface rather than trusting module docstrings. In Convex, query/mutation/action are anonymously reachable; internalQuery/internalMutation/internalAction are not. Several modules carried docstrings asserting a property the code did not have; those are recorded as findings rather than accepted.

### Findings: 2 Critical, 6 High, 7 Medium, 9 Low/Info

FIXED IN THIS TASK (6):
- C-1 (Critical) convex/canon/commit.ts:219 - validateAndCommitProposedEvent was a PUBLIC unauthenticated mutation appending to the append-only canonical event log. Zero auth in the file; proposedBy is caller-supplied so provenance was forgeable. Had ZERO callers repo-wide, so converting to internalMutation is regression-free.
- C-2 (Critical) CC-licensed art credits (OpenGameArt/George Bailey/hilau/ansimuz, itch.io/Mounir Tohami) were deleted by rebrand commit 7744d88 while the credited files still ship; ATTRIBUTION.md:24-28 and docs/upstream.md:127-128 then affirmatively relicensed 'all assets' as MIT, a grant a16z never held. Verified against upstream-baseline-20260802 tag. Fixed: added ASSETS-LICENSE.md restoring credits verbatim, corrected ATTRIBUTION.md/docs/upstream.md/README.md.
- H-6 (High) convex/simulation/workflow.ts:126 - runFoundationSimulation was a public unauthenticated mutation inserting rows and committing canon. Zero callers; converted to internalMutation.
- H-3 (High) convex/util/llm.ts:144,178 - console.log(body) logged the full prompt (character memories, private knowledge) and console.log(content) logged raw model output, on the LIVE agent path (agent/conversation.ts, agent/memory.ts). Replaced with bounded metadata. Note the API key was NOT leaking: AuthHeaders() is built separately from body.
- H-2 (High, partly) convex/testing.ts:85 - resume had NO guard while stop was gated on STOP_NOT_ALLOWED. Added the matching guard.

UNRESOLVED CRITICAL/HIGH - RELEASE IS NOT CLEAR:
- H-1 (High) NO convex/auth.config.ts exists, so ctx.auth.getUserIdentity() always returns null and the identity branch of resolveOperatorPrincipal (operatorAuthorization.ts:259-264) is DEAD CODE. The shared ops token passed as a mutation argument is therefore the SOLE working admin credential, not a fallback. Convex logs function arguments, so the live admin secret is likely written to the function log on every privileged call - defeating NFR-005 despite the audit-row builder and ART-57 both being careful about secrets. This is MORE severe than ART-48's own self-assessment. (constantTimeEquals itself is correct; the weakness is architectural.)
- H-4 (High) convex/safety/preGeneration.ts - evaluatePreGenerationSafety/callWithPreGenerationSafety have ZERO production callers (only mistwoodSeed.test.ts). No preGenerationFunctions.ts exists. Nothing screens content before it reaches a provider. postGeneration IS properly wired, which makes the gap easy to miss.
- H-5 (High) FR-K006 emergency stop does not halt the upstream AI Town engine. assertWorldAdmitsSimulation is enforced at only 2 sites (worldDayLiveFunctions.ts:237, opsConsoleFunctions.ts:174); the upstream engine keeps generating via agent/conversation.ts, and crons.ts:16 restarts dead worlds every 60s regardless of emergency-stop state.
- D-1 (High pending maintainer verification) vercel.json is tracked and unguarded. Whether a Vercel project link exists is NOT determinable from the repo (configured server-side). If linked, every merge to main auto-deploys a public site with no server-side authz.

### Controls independently VERIFIED SOUND (tried to break, could not)
- All 17 privileged ops/review routes call requireOperator/requireReviewer as their FIRST statement before any ctx.db read - checked line by line, not inferred. Uniform OPS_UNAUTHORIZED denial is real across all 6 branches of authorizeOperator.
- ART-57 trace pipeline: strict key allowlist + isSensitiveTraceKey screening + internalMutation write boundary + publicLlmTrace is a 5-field Pick. Could not find a route to get raw content or a credential into a trace.
- publicRead: no raw Doc<> is spread into any public payload anywhere in convex/publicRead/ (checked every spread operator); projection builders filter on canon visibility === public|canon and use explicit field maps. The defence-in-depth pattern DOES hold. Caveat recorded as M-2: sanitizeForPublic is a key-name DENYLIST but is documented as an 'allowlist' in 3 places.
- No secrets committed; .gitignore covers .env variants.
- No deploy pipeline exists: both CI workflows terminate at npm run build with read-only tokens; package.json has zero 'convex deploy'.

### Scope judgements
- Did NOT add a hard production-deploy technical block. ART-62's Out of Scope excludes production deployment, and the safeguard would mean editing .claude/ control-plane files. Recommended as a separate task instead (see report section 6).
- Did NOT wire preGeneration/viewerInput to call sites - those are functional changes with behavioural consequences (rejection handling, retry/trace interaction) that belong in feature tasks, not an audit.
- Per task-finalization guidance, follow-up tasks are RECOMMENDED in the report, not created without approval.

### Limitations (stated so evidence is not over-read)
No live deployment exercised - all findings are source review. The H-1 'token reaches the log' claim follows from Convex's documented argument-logging behaviour and was NOT observed in a real log. No network access, so asset license versions were inferred from source URLs. node_modules not installed, so dependency scan was lockfile-only (~88% of entries declare no license). The authorize->act->audit wrapper bodies remain typecheck-only with no end-to-end unauthorized-caller test.

Reconciled to Done: implementation merged via PR #131/#134 (verified on origin/main). Status hygiene sync.

## 重新稽核 2026-08-29(對 origin/main @ b9fa935)

完整重跑,非重讀。每一條原始發現都從今日程式碼重新推導,詳見 `docs/security-audit-art-62.md` §0。

**status 由 Done 改為 To Do。** 理由:AC#3(公開測試前不得有未解決的 Critical/High)實測**不成立**,且原稽核自己的結論就寫著「RELEASE IS NOT CLEAR」—— 任務中繼資料與稽核結論當時互相矛盾。剩餘阻塞以**程式碼**為主而非僅環境,故不標 Blocked。

### 原始 2 Critical / 6 High 的現況

Critical **兩條全部 RESOLVED**。六條 High:兩條 RESOLVED、兩條 SUPERSEDED、兩條 STILL OPEN。

- C-1 RESOLVED —— `commit.ts:241` 為 internalMutation;全樹唯一寫入 `canonEvents` 之處為 `:200`,所有呼叫端皆伺服器端;四個符號列於 `viewerWriteBoundary.forbiddenSymbols` 並由 CI 強制。
- C-2 RESOLVED 且更強 —— `ASSETS-LICENSE.md` 登錄 53 項素材;ART-108/144 加上 `check-asset-licenses.mjs` 進入 `npm run check` 與兩個 CI workflow,並刪除十六個無法釐清授權的檔案。
- H-2、H-5 **SUPERSEDED** —— ART-112(`893961f`)退役了整個 a16z 引擎,`convex/testing.ts` 已不存在。**值得明說:退役刪碼比任何一個修復任務關閉了更多本稽核的發現。** 另注意 H-5 **不是** ART-102 關閉的:ART-102 新增的 `assertPublicWorldAdmitsSimulation`/`isPublicWorldEmergencyStopped` 今日**零 production 呼叫者**,其 docstring 仍描述已被刪除的檔案 —— 是殘留死碼,不是活的控制。緊急停止今日有效是靠另一條路徑(`worldDayLiveFunctions.ts:343`、`opsConsoleFunctions.ts:183` 加上排程暫停)。
- H-3、H-6 RESOLVED —— 全樹十處 `console.*` 皆不記錄 prompt 或 completion 內容;今日的活路徑 `convex/simulation/providers/` 零 `console.*`。
- D-1 RESOLVED,**今日重新對 GitHub 實測**:`hooks` → `[]`,`deployments` → `[]`,無部署 job,兩個 workflow 皆 `permissions: contents: read`。

### 仍然開啟(三條 High)

**H-1 STILL OPEN(部分 ENVIRONMENT BLOCKED)** —— `auth.config.ts` 已存在但未設 `CLERK_JWT_ISSUER_DOMAIN` 時輸出 `providers: []`,identity 分支仍是死碼,共享 token 仍是唯一憑證且仍以函式參數傳遞。**且修復不完整**:`requireOperator` 會計算並傳入 `allowTokenFallback`,`requireReviewer`(`proposalReviewFunctions.ts:64-75`)**沒有傳**,而 `operatorAuthorization.ts:419` 預設 `?? true`。因此 Clerk 切換後,公開查詢 `listProposedEventReviews` 與 `reviewProposedEvent` **仍永久接受共享 token**,而該介面回傳原始模型輸出、trace 與安全標籤。該檔 docstring 宣稱其授權「與 ART-48 相同,未變」—— 此宣稱為**假**,正是本稽核設立目的所要抓的缺陷類型。

**H-4 STILL OPEN(部分修復)** —— 字面發現(零呼叫者)已不成立,但覆蓋不完整,且**政策對本專案的內容語言是失效的**:`RULES`(`preGeneration.ts:61-83`)是十六條英文片語 regex 且 `normalizeForSafety` 以 `en-US` 轉小寫,而 `openAICompatible.ts:110` 指示模型「以繁體中文書寫每個敘事欄位」。CJK 之間不會觸發 `\b`。**這使得「已覆蓋」的兩條路徑只是名義上覆蓋。** 另有三處:`embed()` 完全未設閘門(送出角色記憶與私有知識)、閘門位於 adapter 而非 port(`LanguageModelProvider` 不課予安全義務,第二個 adapter 會無聲失去覆蓋)、以及 `jsonSchema.description` / `tools[].function.description` / `body.user` 等未經篩檢的旁通道。且**覆蓋測試不測覆蓋**:`preGeneration.test.ts:109-118` 用 `readFileSync` + `toContain` 檢查原始碼字串,對死碼一樣會過。

**N-1 STILL OPEN(HIGH,新發現)** —— 風險已移至本稽核之後才寫的投票介面。`environmentVoteFunctions.ts:108-111`(公開票匭讀取)與 `:244-247`(收盤 cron)對整輪票列做無界 `.collect()`。Convex 單次查詢上限 16,384(本 repo 自己在 `tokenBudgetFunctions.ts:71` 引用此數)。超過後公開查詢對每位訪客拋錯,且 cron 再也無法收盤 —— 永久卡住。`MAX_SUBMISSIONS_PER_ROUND = 100_000` 是**真正會咬的那條線的六倍**,等於毫無保護。匿名、無速率限制、遠端可觸發。

### AC 對帳

- AC#2 / #4 / #5 已勾,證據見 §0 各節。
- **AC#1 未勾** —— `requireReviewer` 的憑證政策缺陷屬於授權證據的範圍。
- **AC#3 未勾** —— 三條 High 未解決。

DoD#1(所有 AC 滿足)、#3-#7 等未勾者維持未勾,因本輪不含程式碼變更故無對應證據。

### 本輪未做(依指示)

未修復任何發現、未實作功能、未處理 ART-74/86/152/153、未為了關閉發現而降低安全標準。
<!-- SECTION:NOTES:END -->
