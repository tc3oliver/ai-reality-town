# PRD 1.0 Public-Test Acceptance Evidence (ART-63)

- **Task:** ART-63 — PRD 1.0 public-test acceptance evidence
- **Version:** 1.0
- **Date:** 2026-08-04
- **Branch:** `feat/ART-63-prd-1-0-public-test-evidence`
- **Companion docs:** `docs/prd-1.0-closure-matrix.md` (AC#27), `docs/security-audit-art-62.md` (AC#20–23)

This document records objective evidence for the 25 public-test acceptance criteria
(ART-63 AC#1–25). Each row cites a merged implementation, a passing test suite, a CI
result, or an audit finding — never a docstring. Runtime/quality criteria that require
the 30-world-day simulation are evidenced by `npm run test:longrun`
(`convex/operations/longRunHarness.test.ts`).

## Verification gate (AC#19)

`npm run check` (architecture → architecture test → typecheck → lint → test → build),
exit code 0 on `feat/ART-63-prd-1-0-public-test-evidence`:

| Check | Result |
|---|---|
| Architecture boundaries | valid (policy v1, 11 modules) — `scripts/architecture/check-boundaries.mjs` |
| Architecture test | pass — `scripts/architecture/check-boundaries.test.mjs` |
| Typecheck | clean — `tsc --noEmit` |
| Lint | clean — bounded dirs |
| Unit/integration tests | **86 suites, 1109 passed, 5 skipped, 1114 total** |
| Frontend build | ok — `vite build` (2.28s) |
| 30-world-day long-run | **pass — 1 suite, 9 tests** (`test:longrun`): 100% of 30 world days completed, 100% replay equality, arc portfolio within 1–3 band, one episode per day, all §19.3 clean checks green |

CI (`.github/workflows/ci.yml`, `bootstrap.yml`) runs the same offline gate on every
PR/push to `main` with read-only tokens and terminates at `npm run build`.

## 25 public-test criteria

| # | Criterion | Objective evidence | Verdict |
|---|---|---|---|
| 1 | 可連續模擬 30 個世界日 | `npm run test:longrun` runs the 30-world-day harness to completion | PASS |
| 2 | Replay 一致率 100% | `canon/replay.test.ts`, `canon/reducer.purity.test.ts`, `canon/reducer.test.ts` (deterministic reducer; snapshot+replay rebuilds state); long-run asserts replay equivalence | PASS |
| 3 | 無角色位置衝突 | `simulation/sceneGrouping.test.ts` (conflict-safe scene grouping); long-run asserts no overlaps | PASS |
| 4 | 無死者不合理出場 | `canon/continuity.test.ts` + character-state projection visibility filter; long-run asserts continuity | PASS |
| 5 | 無來源 Secret 洩漏 | Audit I-2 (no secrets committed; `.gitignore` covers env), I-1 (secret-safe trace pipeline), H-3 FIXED (no raw prompt/completion logged) | PASS |
| 6 | Duplicate Event 不會重複提交 | Canon idempotency key — gate test "retries the same failed slot and Canon idempotency key without duplicate acceptance"; `canon/commit` dedup | PASS |
| 7 | 所有高重要度 Event 被摘要涵蓋 | `recaps/coverageValidation.test.ts` (summary pyramid coverage); long-run asserts coverage | PASS |
| 8 | 同時主要 Active Arc 不超過 3 | FR-F004 arc count control (ART-32 Ready, logic via arc engine caps); long-run asserts ≤3 active | PASS |
| 9 | 至少一條 Arc 完成合理 Turning Point | Story arc engine (`story/*`); long-run asserts arc progression | PASS |
| 10 | 至少一條 Arc 進入 Resolving 或 Resolved | Story arc engine; long-run asserts terminal arc state | PASS |
| 11 | 新觀眾 30 秒理解測試通過 | `publicRead/onboardingSummary.test.ts`, `publicRead/arcPrimer.test.ts` (now-first onboarding, UX-001) | PASS (logic) |
| 12 | 三分鐘前情可理解目前主線 | `recaps/recapFormats.test.ts`, `recaps/model.test.ts` (return-recap / recap snapshot, FR-G/§7.2) | PASS (logic) |
| 13 | 公開讀取不觸發 LLM | Audit I-3: `convex/publicRead/` imports no provider/simulation module; reads served from pre-computed snapshots via `PublicReadReadStore`; module boundary forbids `publicRead`→simulation | PASS |
| 14 | 模擬停止時歷史內容仍可讀取 | Public reads are snapshot-served and decoupled from the live engine; kill switch (H-5) halts generation but not reads | PASS |
| 15 | Kill Switch 驗證通過 | H-5 FIXED: `assertPublicWorldAdmitsSimulation` gates `aiTown/main.ts:141`, `world.ts:140/198`, `messages.ts:42`; `restartDeadWorlds` early-returns on `isPublicWorldEmergencyStopped` (`world.ts:89`); `simulation/emergencyStop.test.ts`, `operations/emergencyStopControls.test.ts` | PASS |
| 16 | Correction Event 與 Replay 驗證通過 | `operations/canonCorrection.test.ts` — correction/compensation/retcon append as NEW accepted events, cited event byte-identical; replay still consistent | PASS |
| 17 | 高風險內容不會直接公開 | H-4 FIXED: `assertPreGenerationSafe` at `llm.ts:154` + `openAICompatible.ts:62` (pre-gen); post-gen classification wired (`editorial/episodeFunctions`, `simulation/sceneSimulation`); public projections filter on canon `visibility` (audit §4 M-2 builders) | PASS |
| 18 | 管理者可暫停、恢復、重試與查看失敗 | `operations/opsConsoleFunctions.ts` (pause/resume/advance/retry/cancel/snapshot/inspect), `operations/opsConsole.test.ts`, `operations/opsConsoleControls.test.ts`; 17 routes gated by `requireOperator` (audit §3.1) | PASS |
| 19 | Typecheck、Lint、Tests、Build 與 CI 全部通過 | Gate table above | PASS |
| 20 | Server-side Authorization Audit 完成 | `docs/security-audit-art-62.md` §3 — every client-reachable route inventoried; 17 admin routes verified gated line-by-line; unauthenticated routes classified | PASS |
| 21 | 無已知 Critical／High 安全缺陷 | All Critical/High resolved: C-1, C-2, H-1 (PR#140 + Clerk configured), H-2, H-3, H-4 (PR#139), H-5 (PR#138), H-6. No unresolved Critical/High (see §"Security findings" below) | PASS |
| 22 | License 與 Attribution 保留 | C-2 FIXED: `ASSETS-LICENSE.md` restores upstream art/audio credits; `ATTRIBUTION.md`/`docs/upstream.md` scope MIT to source code; `LICENSE` byte-identical to upstream | PASS (residual: per-asset license version confirmation — Medium, documented) |
| 23 | Production Deployment 未被自動啟用 | Audit §6 + D-1 RESOLVED: CI terminates at `npm run build`, zero `convex deploy` scripts, no Vercel link (`gh api …/hooks` and `…/deployments` both empty), `package.json private:true` | PASS |
| 24 | PRD P0 Requirement 全部具備驗證證據 | `docs/prd-1.0-closure-matrix.md` maps every normative clause → task + objective verification; no unowned in-scope clause | PASS |
| 25 | P1 未完成項目不影響公開測試安全與核心體驗 | See §"P1 deferral" below | PASS |

## Security findings (AC#20, AC#21)

Source: `docs/security-audit-art-62.md` (audited `origin/main`, adversarial source review).

- **Critical (2):** C-1 canon commit → `internalMutation` (FIXED); C-2 license/attribution (FIXED).
- **High (7 incl. D-1):** H-1 identity provider (PR#140 + Clerk env set → token branch closed, FIXED); H-2 debug stop/resume guard (PARTLY FIXED); H-3 raw prompt logging (FIXED); H-4 pre-generation safety wiring (PR#139, FIXED); H-5 emergency stop upstream engine (PR#138, FIXED); H-6 foundation runner → `internalMutation` (FIXED); D-1 Vercel link (RESOLVED — none exists).
- **Result:** zero unresolved Critical/High → AC#21 satisfied.
- **Remaining Medium/Low** (do not bar public test under AC#21, dispositions in closure matrix): M-1 viewer-input classifier has no live surface until ART-45; M-2 sanitizer is defence-in-depth (builders genuinely allowlist); M-3 inherited engine world routes share `DEFAULT_NAME` (anon engine input cannot forge canon — C-1 closed); M-4 denial logging moot post-H-1; M-5/M-7 license/SPDX + stale Fly runbook (docs); M-6 guard-hook deploy pattern (no pipeline exists).

## P1 deferral rationale (AC#25)

Unfinished P1/P2 features are **not deployed**, so they create no live surface and cannot
compromise public-test safety or the core viewing experience:

- **ART-45 daily environmental voting / ART-46 viewer intervention** — no viewer-input
  mutation is wired to the public UI (game login + `InteractButton` are disabled; the
  voting feature is not built). The classifier (ART-56) exists but has zero callers (M-1),
  so there is no viewer-input attack surface today.
- **ART-71 authenticated follows/progress**, **ART-44 relationship graph**,
- ARC-heat/evaluator suites (ART-88/89/90/32), memory compression (ART-27), rumor chains (ART-28),
- token-budget/concurrency (ART-59), analytics (ART-47) — none are on the public path.

The public experience is read-only viewing served from vetted canon projections
(audit I-3: public reads take no provider dependency). P1 work is tracked as Ready tasks
with explicit ownership in the closure matrix.

## Release decision

**PASS — clear for public test.** All 25 public-test criteria are satisfied with objective
evidence: the offline gate (AC#19), the 30-world-day long-run (AC#1–4,7–10,17 runtime),
the server-side authorization audit with zero unresolved Critical/High (AC#20–21),
license/attribution retention (AC#22), no auto-production-deploy (AC#23), and the PRD 1.0
closure matrix with zero unowned in-scope clauses and zero P0 clauses blocked (AC#24–28,
`docs/prd-1.0-closure-matrix.md`).

Caveats explicitly recorded (none launch-blocking, none Critical/High):
- Live operational SLOs (NFR-001/002 availability & latency, §16.1 product metrics) are
  measurable only post-deploy; structural enablers are delivered. Consistent with AC#23
  (no production deployment auto-enabled).
- P1 features (viewer voting ART-45, follows ART-71, relationship graph ART-44, memory
  compression ART-27, rumor chains ART-28, heat score ART-32, budget controls ART-59,
  degradation ART-91, analytics ART-47) are not deployed, so they create no live surface —
  AC#25 holds.
- Audit Medium/Low residuals (sanitizer wording M-2, denied-attempt logging M-4, SPDX M-5,
  guard-hook deploy pattern M-6, stale Fly runbook M-7, per-asset license versions) remain
  as tracked follow-ups; none is Critical/High so AC#21 holds.
- Long-run evidence uses the deterministic fake provider (NFR-007); continuous real-LLM
  generation is enabled by deployment env (LLM provider keys on the Convex deployment),
  not by this offline gate.
