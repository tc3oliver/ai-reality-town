# PRD 1.0 Closure Matrix & Closure Audit

**Document version:** 1.0
**Date:** 2026-08-04
**Generated for:** ART-63 (PRD 1.0 public-test acceptance evidence)
**Source of truth:** `backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md` (PRD 1.0, 2718 lines, Sections 1–23)
**Implementation record:** Backlog.md task graph (`npm run backlog -- task list`)
**Priority convention (read from the PRD itself):** Every `FR-*` carries an inline `優先級：P0|P1|P2` tag. Section 17 consolidates the priority bands:
- **P0** — must be complete before public display (`§17 P0`).
- **P1** — needed during public test (`§17 P1`).
- **P2** — subsequent versions (`§17 P2`).
The MVP goals in `§5.1`, the tech/ops goals in `§5.3`, and the UX principles in `§8` are normative P0 unless they explicitly ride on a P1 FR.

**Offline gate evidence (AC#19):** `npm run check` exit 0. Architecture boundaries valid (policy v1, **11 modules**; `test:architecture` ok). `tsc --noEmit` clean. Lint clean. **86 test suites / 1109 tests passed, 5 skipped, 1114 total.** Vite build OK (2.28s). 30-day long-run suite (`test:longrun`, ART-60) green.

**Security audit evidence:** `docs/security-audit-art-62.md` (ART-62, Done). Both Criticals (C-1, C-2) and four Highs (H-2, H-3, H-6, D-1) were remediated inside ART-62. The three release-blocking Highs are now resolved: **H-1** by ART-104 (Clerk identity provider configured, shared ops-token retired — PR #140), **H-4** by ART-103 (pre-generation safety wired into the provider call path — PR #139), **H-5** by ART-102 (FR-K006 emergency stop extended to the upstream engine and restart cron — PR #138).

---

## Closure summary

| Classification | Count | Launch-blocking? |
|---|---:|---|
| **P0 delivered** (in MVP scope, owning task Done, objective verification cited) | 96 | — |
| **Deferred P1/P2** (explicitly out of MVP, owned by a backlog task, does not compromise safety / core experience) | 24 | No |
| **Non-goal** (matches a `§6` non-goal; verified absent — `§ Closure audit`) | 17 | — |
| **Unowned in-scope clause (gap)** | **0** | — |
| **P0 clause whose task is not yet Done** | **0** | — |

**Verdict for AC#24 / AC#26 / AC#27:** every normative in-scope clause in PRD Sections 1–23 is owned. Every P0 clause maps to at least one Done task and at least one objective verification reference (test file/suite, the offline gate, a merged PR, or an audit section). Zero unowned in-scope gaps. Zero P0 clauses blocked on incomplete work.

**Verdict for AC#28:** the implemented scope does not include any of the 17 MVP non-goals (see `Closure audit (non-goals)`).

---

## 1. MVP product goals — §5.1 (14 goals), §5.3 tech/ops goals (9), §5.2 validation

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| §5.1 G1 | One public world | P0 delivered | ART-77 (Done) | `convex/canon/mistwoodSeed.test.ts`; single `MISTWOOD_PUBLIC_WORLD_ID` constant |
| §5.1 G2 | 12–20 main characters | P0 delivered | ART-6, ART-77 (Done) | `convex/canon/characterSeed.test.ts`, `mistwoodFixture.test.ts` (seed count assertions) |
| §5.1 G3 | 6–10 main locations | P0 delivered | ART-5, ART-77 (Done) | `convex/canon/worldConfig.test.ts`, `locationProjection.test.ts` |
| §5.1 G4 | Stable persona/goal/relationship/secret/memory per character | P0 delivered | ART-6, ART-10 (Done) | `characterSeed.test.ts`, `relationship.test.ts` |
| §5.1 G5 | Traceable events every world day | P0 delivered | ART-13, ART-22 (Done) | `convex/canon/commit.test.ts`, `convex/simulation/sceneSimulation.test.ts` |
| §5.1 G6 | 1–3 active Story Arcs sustained | P0 delivered | ART-30 (Done) | `convex/story/portfolio.test.ts` (active-arc cap of 3 enforced) |
| §5.1 G7 | All Canon changes replayable & auditable | P0 delivered | ART-13, ART-17 (Done) | `convex/canon/replay.test.ts`, `snapshotManager.test.ts` |
| §5.1 G8 | One Episode per world day | P0 delivered | ART-33 (Done) | `convex/editorial/episode.test.ts` |
| §5.1 G9 | New viewer understands main line in 30s | P0 delivered | ART-37, ART-75 (Done) | `convex/publicRead/onboardingSummary.test.ts`, `newcomerAcceptance.test.ts` |
| §5.1 G10 | Return viewer catches up quickly | Deferred P1 | ART-39 (To Do, FR-H004) | Does not block launch: FR-H001 current-situation + FR-I003/004 episode pages cover re-entry; personalised recap is a P1 enhancement |
| §5.1 G11 | Daily viewer vote on an environment event | Deferred P1 | ART-45 (To Do, FR-J001) | Does not block launch: voting is a P1 interaction layer; its safety pre-conditions (FR-L003 viewer-input classifier, ART-56) are already Done |
| §5.1 G12 | 30-day continuous simulation, no serious consistency errors | P0 delivered | ART-60 (Done) | `convex/operations/longRunHarness.test.ts`; offline gate `test:longrun` |
| §5.1 G13 | Public read traffic must not increase LLM generation | P0 delivered | ART-40 (Done) | `convex/publicRead/readModel.test.ts`; security audit §4 I-3 (public read path imports no provider) |
| §5.1 G14 | On simulation failure, existing public content stays readable | P0 delivered | ART-40, ART-74 (Done) | `convex/publicRead/readModel.test.ts`, `convex/operations/failureIntegration.test.ts` |
| §5.3 a | LLM may only propose events, never write Canon directly | P0 delivered | ART-12, ART-13, ART-62 (Done) | `convex/canon/proposedEvent.test.ts`, `commit.test.ts`; audit C-1 fix (`commit.ts` is `internalMutation`) |
| §5.3 b | All world-state changes must pass validation | P0 delivered | ART-14, ART-15 (Done) | `convex/canon/validators.test.ts`, `continuity.test.ts` |
| §5.3 c | Events must be idempotent | P0 delivered | ART-12, ART-18 (Done) | `proposedEvent.test.ts` (idempotency key), `scheduler.test.ts` (no double-submit) |
| §5.3 d | World state rebuildable from Snapshot + Event Replay | P0 delivered | ART-17 (Done) | `convex/canon/replay.test.ts`, `snapshotManager.test.ts` |
| §5.3 e | Summaries must not reload full history each time | P0 delivered | ART-34 (Done) | `convex/recaps/model.test.ts` (incremental pyramid) |
| §5.3 f | Public Read Model isolated from simulation write path | P0 delivered | ART-40 (Done) | `convex/publicRead/readModel.test.ts`; audit §4 I-3 |
| §5.3 g | Model / prompt / output must be traceable | P0 delivered | ART-57, ART-72 (Done) | `convex/observability/llmTrace.test.ts`, `convex/simulation/providers/openAICompatible.test.ts` |
| §5.3 h | Operators can pause / retry / correct / rollback | P0 delivered | ART-48, ART-50, ART-53 (Done) | `opsConsole.test.ts`, `canonCorrection.test.ts`, `emergencyStopControls.test.ts` |
| §5.3 i | Inappropriate content must not be published directly | P0 delivered | ART-54, ART-55, ART-103 (Done) | `convex/safety/preGeneration.test.ts`, `postGeneration.test.ts`; H-4 resolution (pre-gen wired) |
| §5.2 | Product validation hypotheses (newcomer / arc / daily return / voting / tracking) | Non-launch measurement | — | Depends on live traffic + analytics (ART-47, deferred P1). Structural enablers (comprehension suite ART-75, content eval ART-92) are Done; live validation is a post-launch activity, not a launch gate |

---

## 2. UX principles — §8 (UX-001 .. UX-006)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| UX-001 | Show the present first, not the history | P0 delivered | ART-41 (Done) | `convex/publicRead/readModel.test.ts`, `newcomerAcceptance.test.ts` (homepage leads with current situation) |
| UX-002 | Only surface info needed to understand the current event (≤4 core chars, 3 backstories, 1 entry point) | P0 delivered | ART-37, ART-67 (Done) | `onboardingSummary.test.ts` (≤4 core characters, 3 essential backstories, 1 recommended entry), `entryRecommendation.test.ts` |
| UX-003 | Deep information revealed layer by layer (30s → 3min → episode → arc → relationship → full history) | P0 delivered | ART-37, ART-38, ART-42, ART-69 (Done) | `arcPrimer.test.ts`, `episodeTimelineProjection.test.ts`, `relationshipArcProjection.test.ts` |
| UX-004 | Even with many arcs, homepage highlights only the top 1–3 | P0 delivered | ART-30, ART-41 (Done) | `portfolio.test.ts` (homepage shows highest-priority arc only) |
| UX-005 | Viewers influence the environment, never dictate outcomes | P0 principle delivered (voting UI P1 deferred) | ART-15 (Canon Validation rejects command-style), ART-45 (To Do, carries the constraint forward) | No viewer-control path exists in MVP; voting candidates are pre-defined safe environment events (`FR-J001` acceptable list); `continuity.test.ts` enforces no sourceless change |
| UX-006 | Tech (tokens / agent count / model names / prompts) must not be the headline of public pages | P0 delivered | ART-41, ART-57 (Done) | `readModel.test.ts` (public payload is剧情/character-scoped); audit §4 I-1 (`getTracePublic` returns a 5-field Pick, no model/prompt) |

---

## 3. Epic A — World initialization (FR-A001 .. FR-A004)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-A001 | Structured world-config import with schema validation, atomicity, initial snapshot | P0 delivered | ART-5 (Done) | `convex/canon/worldConfig.test.ts`, `mistwoodSeed.test.ts` |
| FR-A002 | Character initialization (public/private profile, goals, fears, secrets, relationships, knowledge, assets) | P0 delivered | ART-6 (Done) | `convex/canon/characterSeed.test.ts`, `mistwoodFixture.test.ts` |
| FR-A003 | Initial-tension readiness validator (conflicts, secrets, dependencies, misconceptions, shared-misunderstanding event, launchable arc) | P0 delivered | ART-7 (Done) | `convex/canon/tensionReadiness.test.ts` |
| FR-A004 | Private world warmup (non-public, resumable, produces ≥1 active arc, launchable from a chosen day) | P0 delivered | ART-8 (Done) | `convex/simulation/warmup.test.ts` |

---

## 4. Epic B — Character & relationship (FR-B001 .. FR-B003)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-B001 | Character current state (location, health, emotion, finance, occupation, membership, availability, alive/active) derived only from accepted events, rebuildable from replay | P0 delivered | ART-9 (Done) | `convex/canon/characterState.test.ts` |
| FR-B002 | Multi-dimensional directional relationships (trust/affection/resentment/fear/dependency/familiarity) with reason+source, range-checked, queryable history, no secret leak | P0 delivered | ART-10 (Done) | `convex/canon/relationship.test.ts` |
| FR-B003 | Persona-deviation detection (high-importance deviations flagged, baseless reversions rejected, summaries updated) | Deferred P1 | ART-11 (To Do) | Does not block launch: structural persona fields and `behaviorRules` are enforced at seed validation (FR-A002) and continuity validation (FR-D004); deviation *detection* is a quality enhancement feeding FR-M002 |

---

## 5. Epic C — Simulation scheduling & scenes (FR-C001 .. FR-C005) + §12 world-day pipeline

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-C001 | Idempotent world scheduler (no double-execution of a slot, pause/resume/manual trigger, safe retry, no resubmit of accepted events) | P0 delivered | ART-18 (Done) | `convex/simulation/scheduler.test.ts` |
| FR-C002 | Daily Director plan (arc/goal/position/arc-staleness/environment/repetition-aware, conflict-free, traceable, daily cap) | P0 delivered | ART-19 (Done) | `convex/simulation/director.test.ts` |
| FR-C003 | Knowledge-scoped character intents (structured, traceable, no canon-secret / other-character-memory / operator-note / viewer-only input) | P0 delivered | ART-20 (Done) | `convex/simulation/characterIntent.test.ts` |
| FR-C004 | Conflict-safe scene grouping (same slot/location/character conflicts handled, no double-attendance, intent references preserved, participant cap) | P0 delivered | ART-21 (Done) | `convex/simulation/sceneGrouping.test.ts` |
| FR-C005 | Whole-scene simulation (one pass per scene; runtime-validated; retryable; never writes Canon directly; high-risk → safety review) | P0 delivered | ART-22 (Done) | `convex/simulation/sceneSimulation.test.ts` |
| §12 | 21-step world-day pipeline orchestration | P0 delivered | ART-23, ART-83, ART-97, ART-98 (Done) | `worldDayOrchestration.test.ts`, `worldDayLive.test.ts`, `postCommitOrchestration.test.ts`, `postCommitLive.test.ts` |
| §12 (failure rules) | On any step failure: accepted events preserved, no partial application, public content stays at last valid version, run records failure stage, safe-step retry | P0 delivered | ART-74 (Done) | `convex/operations/failureIntegration.test.ts` |

---

## 6. Epic D — Canon event store (FR-D001 .. FR-D006)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-D001 | Versioned Proposed-Event schema with idempotency key, provenance, participants, causality, no undefined payload | P0 delivered | ART-12 (Done) | `convex/canon/proposedEvent.test.ts` |
| FR-D002 | Append-only accepted-event store (immutable, correction/compensation/retcon only, monotonic sequence, traceable, full-replay capable) | P0 delivered | ART-13 (Done) | `convex/canon/commit.test.ts`; audit C-1 fix (commit is `internalMutation`) |
| FR-D003 | Structural validation (schema version, required fields, event type, state-change union, participant dedup, bounded numerics, idempotency key, world day, summary length, reference format; stable error codes) | P0 delivered | ART-14 (Done) | `convex/canon/validators.test.ts` |
| FR-D004 | Canon validation (no teleport, no bilocation, no dead-participation, no sourceless secret, unique item ownership, no self-relationship, no causeless value change, valid refs, no sequence conflict, no duplicate idempotency key) | P0 delivered | ART-15 (Done) | `convex/canon/continuity.test.ts` (every P0 rule has an automated test — AC for FR-D004) |
| FR-D005 | Pure deterministic reducer (no DB, no clock, no unseeded RNG, same-input/same-output, unsupported version & sequence gap fail explicitly) | P0 delivered | ART-16 (Done) | `convex/canon/reducer.test.ts`, `reducer.purity.test.ts` |
| FR-D006 | Snapshot & replay (daily snapshot, full replay, snapshot+delta replay, full vs snapshot-replay identical, 30-day 100% consistency, rollback preserves history) | P0 delivered | ART-17 (Done) | `convex/canon/snapshotManager.test.ts`, `replay.test.ts`; `longRunHarness.test.ts` for 30-day consistency |

---

## 7. Epic E — Character knowledge, memory, rumor (FR-E001 .. FR-E005)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-E001 | Character knowledge with source, truth status, no unauthorized access, event-driven updates | P0 delivered | ART-24 (Done) | `convex/knowledge/knowledgeLedger.test.ts`, `canonCognitionIntegration.test.ts` |
| FR-E002 | Subjective memory (per-character interpretation, importance, emotional weight, confidence, visibility; separable from Canon Fact; may contain misunderstanding; never directly public) | P0 delivered | ART-25 (Done) | `convex/knowledge/subjectiveMemory.test.ts` |
| FR-E003 | Bounded memory retrieval (semantic/importance/recency/emotion/arc relevance; bounded count; traceable; no full history in prompt; no unauthorized memory) | P0 delivered | ART-26 (Done) | `convex/knowledge/memoryRetrieval.test.ts` |
| FR-E004 | Long-term memory compression (impressions, stable beliefs, relationship summaries, arc understanding, location experience; lossless; Canon-preserving) | P1 delivered | ART-27 (Done) | `convex/knowledge/memoryCompression.test.ts`, `memoryCompression.lossless.test.ts`, `memoryCompression.boundary.test.ts`; `docs/long-term-memory-compression.md`. "Lossless" is pinned to three machine-checked properties — exact partition, verbatim round trip, and recall preservation against the real FR-E003 retriever at every limit 1–12 — and the one dimension that *is* lossy (an old low-importance memory leaves the retrieval corpus) is asserted as such rather than only described |
| FR-E005 | Versioned rumor propagation chains (source, chain, current version, credibility, objective truth, known corrections; never auto-promoted to Canon Fact) | Deferred P1 | ART-28 (To Do) | Does not block launch: rumors are a content enrichment; their absence does not violate any Canon/safety invariant. Arc engine and Episode pipeline do not depend on rumor presence |

---

## 8. Epic F — Story Arc engine (FR-F001 .. FR-F006)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-F001 | Arc creation & classification (assign/merge/new-arc decision, Event Role taxonomy, bounded main-arc count, premise + current question required) | P0 delivered | ART-29 (Done) | `convex/story/classification.test.ts` |
| FR-F002 | Arc lifecycle state machine (Emerging/Active/Escalating/Climax/Resolving/Resolved/Archived with rule-based transitions) | P0 delivered | ART-64 (Done) | `convex/story/lifecycle.test.ts` |
| FR-F003 | Arc data contract (title, premise, current question, status, core characters, inciting event, latest turning point, essential facts, unresolved/resolved questions, recommended entry, heat score, last progress) | P0 delivered | ART-65 (Done) | `convex/story/projection.test.ts` |
| FR-F004 | Arc count control (≤3 main active, ≤6 secondary, ≤6 core chars/arc, ≤2 arcs advanced per event; merge/demote/reject on overflow; no event deletion) | P0 delivered | ART-30 (Done) | `convex/story/portfolio.test.ts` |
| FR-F005 | Arc resolution (14-day-stagnation alert, no unexplained disappearance, resolved arcs leave outcome+consequences, post-resolution summary update) | P0 delivered | ART-31, ART-82 (Done) | `convex/story/resolution.test.ts`, `consequenceSummary.test.ts` |
| FR-F006 | Arc heat score (traceable, not freely LLM-decided, operator-visible composition) | Deferred P1 | ART-32 (To Do) | Does not block launch: arc priority for the homepage uses the deterministic portfolio/active-arc rules (FR-F004); heat score is a refinement that does not alter Canon or safety |

---

## 9. Epic G — Episode & editorial layer (FR-G001 .. FR-G005)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-G001 | Daily Episode (number, title, headline, summary, 3–5 key scenes, relationship changes, new/resolved questions, related arcs/characters, next-episode tease; accepted-events-only; high-importance coverage; no secret leak; failure does not touch Canon) | P0 delivered | ART-33 (Done) | `convex/editorial/episode.test.ts` |
| FR-G002 | Incremental recap pyramid (Raw → Scene → Episode → Arc → Season → Viewer Context; traceable; incremental; never full-history reload; regenerable without changing Canon) | P0 delivered | ART-34 (Done) | `convex/recaps/model.test.ts` |
| FR-G003 | Three-level Episode recaps (Quick 80–150 chars, Standard 400–800 chars, Deep, Machine Summary with What Changed / Why / Who Affected / New+Resolved Questions / Required Prior Facts / Arc Progress) | P0 delivered | ART-66 (Done) | `convex/recaps/recapFormats.test.ts` |
| FR-G004 | Recap coverage & spoiler validation (high-importance coverage or explicit exclusion; major relationship change mentioned; turning point mentioned; spoiler violation detected) | P1 delivered early | ART-35 (Done, PR #115) | `convex/recaps/coverageValidation.test.ts` (35/35) |
| FR-G005 | Episode-derived share formats (local news, social short-post, share-card copy, next-day preview; no new Canon; source-tagged; no auto external publish) | Deferred P1 | ART-36 (To Do) | Does not block launch: share formats are an outreach feature; their absence has no Canon/safety impact. Non-goal §6 "auto-posting unreviewed content to external social" remains absent |

---

## 10. Epic H — New-viewer onboarding (FR-H001 .. FR-H005)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-H001 | Cached current-situation onboarding summary (≤~300 chars; major event + why + ≤4 core chars + 3 backstories + 1 core question + recommended episode + best scene; cached; per-visitor read does not invoke LLM) | P0 delivered | ART-37 (Done) | `convex/publicRead/onboardingSummary.test.ts` |
| FR-H002 | Three-minute active-arc primer (cause, latest turning point, core characters, unresolved questions; ~2–4 min read; no need to start from episode 1) | P0 delivered | ART-38 (Done) | `convex/publicRead/arcPrimer.test.ts` |
| FR-H003 | Recommended entry episode per active arc (core characters present, clear turning point, low comprehension cost, not too far from current progress, reason queryable, re-evaluated on major arc change) | P0 delivered | ART-67 (Done) | `convex/story/entryRecommendation.test.ts` |
| FR-H004 | Device-aware return recap (events since last viewed, tracked-character changes, arc progress, vote consequences, continue-watching point; device-level progress without login) | Deferred P1 | ART-39 (To Do) | Does not block launch: FR-H001/H002/H003 cover re-entry for all viewers; personalised return recap is a P1 engagement enhancement |
| FR-H005 | Spoiler control (Full / Public-only / Watched-only) | P2 deferred (data-compat constraint delivered) | ART-70 (Done) | PRD explicitly says "MVP 可不實作，但資料模型不得阻止後續支援". ART-70 delivers the data-compatibility constraint (modes declared, filtering uses only existing fields, forward-compatible `viewerEpisodeProgress` table not populated in MVP). Functional spoiler UI is P2. `convex/viewer/spoilerMode.test.ts` (10 compatibility tests) |

---

## 11. Epic I — Public viewing interface (FR-I001 .. FR-I008)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-I001 | Story-first homepage (world name+day, current situation, core characters, essential backstory, recommended episode, live entry, current vote, latest major event; no full relationship graph on first screen; no agent/token/model headline; mobile-readable) | P0 delivered | ART-41 (Done) | `convex/publicRead/readModel.test.ts`, `newcomerAcceptance.test.ts` |
| FR-I002 | Live view (simplified map/location list, character positions, active scenes, recent events, world time, active arcs; no high-quality animation expected; public read triggers no generation; browsable while paused) | P0 delivered | ART-68, ART-96 (Done) | `convex/publicRead/liveState.test.ts` |
| FR-I003 | Episode detail page (Quick/Standard/Deep recap, key scenes, related characters/arcs, prev/next, extended reading) | P0 delivered | ART-42, ART-85 (Done) | `convex/publicRead/episodeTimelineProjection.test.ts` |
| FR-I004 | Episode list (by date, by arc, by character, Turning-Point & Recommended-Entry markers) | P0 delivered | ART-86 (Done) | `convex/publicRead/episodeIndexProjection.test.ts` |
| FR-I005 | Privacy-safe public character page (name/image, age, occupation, public background, current state, public goal, main relationships, recent major events, arcs, viewer-known secrets; never exposes unpublished Canon secret / private memory / prompt / raw output / operator notes) | P0 delivered | ART-43, ART-84 (Done) | `convex/publicRead/worldCharacterProjection.test.ts`; audit §4 M-2 (projection builders allowlist via `visibility`) |
| FR-I006 | Public Story Arc page (title, premise, current question, status, core characters, essential backstory, inciting event, latest turning point, recommended entry, related episodes, known clues, unresolved questions, outcome if resolved) | P0 delivered | ART-69, ART-95 (Done) | `convex/publicRead/relationshipArcProjection.test.ts` |
| FR-I007 | Scoped relationship graph (current-arc core characters, one-hop relationships, last-7-day changes; date switch, type filter, summaries, change reasons; never renders all characters/relationships by default) | Deferred P1 | ART-44 (To Do) | Does not block launch: relationship data is reachable via the character page (FR-I005) and arc page (FR-I006); the full graph view is a P1 deep-viewer feature. (Graph accessibility is separately tracked under ART-94, also P1) |
| FR-I008 | Major-event world timeline (arc/character/event-type filters, episode deep-links) | P1 delivered early | ART-87 (Done) | `convex/publicRead/episodeTimelineProjection.test.ts`; ART-87 focused suite `timelineRoute` 14/14 |

---

## 12. Epic J — Viewer interaction (FR-J001 .. FR-J003)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-J001 | Daily environment-event vote (3–4 safe candidates; per-device rate limit; single winner; winner injected as Proposed World Event; no result dictated) | Deferred P1 | ART-45 (To Do) | Does not block launch: voting is the P1 interaction layer. Its safety pre-conditions are already Done — the viewer-input classifier (FR-L003 / ART-56) and Canon Validation (FR-D004) will gate any injected event. No vote UI ships, so no untrusted input surface exists yet (audit M-1 correctly rates this latent) |
| FR-J002 | Vote-consequence tracking (mark vote-triggered events, direct effects, downstream events, unconfirmed indirect effects; never over-claim causation) | Deferred P1 | ART-46 (To Do) | Does not block launch: tracking is a transparency layer over voting; with voting deferred there is no surface to track |
| FR-J003 | Authenticated follows & progress (follow characters/arcs, save progress, personalised return recap) | Deferred P2 | ART-71 (To Do) | Explicit P2 in §17. No auth-required viewer surface in MVP |

---

## 13. Epic K — Admin & operations (FR-K001 .. FR-K006)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-K001 | Simulation operations console (pause/resume/manual slot advance/rerun failed/cancel uncommitted scene/inspect world/create snapshot/inspect schedule+queue) | P0 delivered | ART-48 (Done) | `convex/operations/opsConsole.test.ts`, `opsConsoleControls.test.ts`; audit §3.1 (all 17 privileged routes gated by `requireOperator`) |
| FR-K002 | Proposed-event review (proposed event, validation result, rejection reason, model trace, participants, state changes, related arc, safety label) | P0 delivered | ART-49 (Done) | `convex/operations/proposalReview.test.ts`, `proposalReviewStore.test.ts` |
| FR-K003 | Audited Canon correction (Correction / Compensation / Retcon events; no deletion; operator+reason recorded; replay-consistent; public content re-published; major retcon audited) | P0 delivered | ART-50 (Done) | `convex/operations/canonCorrection.test.ts` |
| FR-K004 | Independent editorial publication lifecycle (Generated/Validated/Safety Review/Ready/Published/Withheld/Superseded; Canon event & public-content status separated; unsafe episode withholdable without deleting Canon; regenerable summaries) | P0 delivered | ART-51 (Done) | `convex/editorial/publicationLifecycle.test.ts` |
| FR-K005 | Audited model/prompt/retry/budget configuration per module | Deferred P1 | ART-52 (To Do) | Does not block launch: a single production-compatible adapter config is wired (ART-72, NFR-004) and traceable (FR-M001). Per-module runtime budget controls are a P1 ops refinement |
| FR-K006 | World emergency stop / kill switch (halt new sim work; preserve public content; preserve in-flight run state; no accepted-event loss; operator resume or rollback) | P0 delivered | ART-53, ART-102 (Done) | `convex/operations/emergencyStopControls.test.ts`, `convex/simulation/emergencyStop.test.ts`; H-5 resolution (ART-102 extends the stop to the upstream engine + `restartDeadWorlds` cron) |

---

## 14. Epic L — Content safety (FR-L001 .. FR-L003)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-L001 | Pre-generation safety limits (CSAM/sexual/hate/extreme-violence/self-harm/real-person-impersonation/PII/crime-instruction prohibited in world config and prompts) | P0 delivered | ART-54, ART-103 (Done) | `convex/safety/preGeneration.test.ts`; H-4 resolution (ART-103 wires `callWithPreGenerationSafety` into the live provider path, PR #139) |
| FR-L002 | Post-generation safety classification per scene & public content (Allow / Allow+Warning / Withhold / Human Review; high-risk never auto-published; safety failure never alters Canon; public summary trimming preserves core facts; queryable block reasons) | P0 delivered | ART-55 (Done) | `convex/safety/postGeneration.test.ts` |
| FR-L003 | Untrusted viewer-input protection (prompt injection, real-person naming, PII, inappropriate violence/sexual content, system-command manipulation, direct result control) | P0 delivered | ART-56 (Done) | `convex/safety/viewerInput.test.ts`. Note (audit M-1): the classifier has zero production callers today because the consuming feature (FR-J001 / ART-45) is deferred; the AC for ART-45 carries "viewer input passes through `classifyViewerInput` server-side" forward |

---

## 15. Epic M — Observability & quality (FR-M001 .. FR-M004)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-M001 | LLM trace per call (world/day/run/scene/arc/character IDs, model, prompt version, input/output tokens, latency, retry count, validation result, final status; no full prompt or secret in public surface) | P0 delivered | ART-57, ART-62 (Done) | `convex/observability/llmTrace.test.ts`; audit §4 I-1 (secret-safe pipeline verified); H-3 fix removed parallel raw-prompt `console.log` path |
| FR-M002 | World quality metrics (continuity, character consistency, event novelty, dialogue repetition, arc progress, arc stagnation, recap coverage, spoiler violation, canon rejection rate, safety withhold rate) | Deferred P1 | ART-58, ART-88, ART-89, ART-90 (To Do) | Does not block launch: the underlying measurements exist structurally — recap coverage & spoiler detection (ART-35), canon rejection (FR-D004 tests), 30-day long-run assertions (ART-60). The unified metrics surface is a P1 observability aggregation |
| FR-M003 | Token & rate-limit controls (daily/module/model caps, max concurrency, retry budget, over-budget degradation) | Deferred P1 | ART-59 (To Do) | Does not block launch: deterministic fake provider is used for all launch-evidence runs (NFR-007); live budget caps apply only when a real provider is wired for continuous operation. Structural enablers (idempotency FR-D001, retry safety FR-C001) are Done |
| FR-M004 | Degradation mode (retry → compatible model → fewer scenes → rule-based background events → defer non-essential recaps → pause; Canon Validation / Safety / Idempotency / Persistence never skipped) | Deferred P1 | ART-91 (To Do) | Does not block launch: degradation is a live-traffic resilience pattern; its safety invariants (Canon Validation, Safety, Idempotency, Persistence) are all independently enforced as P0. 30-day deterministic run (ART-60) proves the happy path |

---

## 16. §9–10 core-concept & world-operation constraints (normative subset)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| §9.3–9.6 | Canon Fact ≠ Character Knowledge ≠ Memory ≠ World Event (distinct entities, separated in schema & projection) | P0 delivered | ART-13, ART-24, ART-25 (Done) | Schema entities §13.5–13.8; `knowledgeLedger.test.ts`, `subjectiveMemory.test.ts` enforce separation |
| §9.10 | Viewer Secret subject to spoiler-level control | P0 delivered (constraint) | ART-35, ART-70 (Done) | `coverageValidation.test.ts` (spoiler violation detection), `spoilerMode.test.ts` |
| §10.1 | 1 real day = 1 world day; 5 time slots; 0–3 scenes per slot; Episode+Recap at day end | P0 delivered | ART-18, ART-33, ART-34 (Done) | `scheduler.test.ts`, `episode.test.ts`, `recaps/model.test.ts` |
| §10.2 | Dev/test mode must support pause, manual slot advance, manual day advance, accelerated sim, fixed-seed replay, non-public warmup | P0 delivered | ART-8, ART-18, ART-48, ART-60 (Done) | `warmup.test.ts`, `scheduler.test.ts`, `opsConsoleControls.test.ts`, `longRunHarness.test.ts` (fixed-seed 7/30-day) |
| §10.3 | 30–60-day pre-public warmup; system marks real start day, public broadcast start day, recommended newcomer entry point | P0 delivered | ART-8, ART-67, ART-77 (Done) | `warmup.test.ts`, `entryRecommendation.test.ts`, `mistwoodSeed.test.ts` |

---

## 17. §13 data model (descriptive — noted, not rowed)

PRD §13 explicitly states: "以下為產品層必要 Entity，**實際資料庫 Schema 由技術設計決定**." The entity list is therefore descriptive input to technical design, not a set of independent normative clauses. All 14 entities (World, Character, Relationship, Location, Canonical Fact, Character Knowledge, Memory, World Event, Story Arc, Episode, Recap Snapshot, Viewer Progress, Viewer Intervention, Simulation Run) are represented in the Convex schema and exercised by the test suites cited throughout this matrix. No unowned entity.

---

## 18. §14 non-functional requirements (NFR-001 .. NFR-009)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| NFR-001 | Availability: public content 99.5%; sim-engine outage does not make history unreadable; publish/sim failure isolation | P0 (structural) delivered; live SLO is operational | ART-40, ART-74 (Done) | `readModel.test.ts`, `failureIntegration.test.ts` prove failure isolation. The 99.5% uptime figure is a live SLO measurable only post-deploy and is not a pre-launch code gate |
| NFR-002 | Performance: homepage LCP <2.5s; read P95 <500ms; live update latency <5s; relationship graph ≤30 default nodes; public pages never wait on real-time LLM | P0 (structural) delivered; live figures operational | ART-40, ART-41 (Done) | Public reads served from pre-computed projections (`readModel.ts`, no provider import — audit I-3). `<30` graph default enforced by FR-I007 scope (ART-44 deferred, but the cap is a constraint carried forward). Live LCP/P95 measurable only post-deploy |
| NFR-003 | Determinism: identical snapshot+events → identical projection; reducer has full automated tests; event commit is idempotent | P0 delivered | ART-16, ART-17, ART-12 (Done) | `reducer.test.ts`, `reducer.purity.test.ts`, `replay.test.ts`, `proposedEvent.test.ts` |
| NFR-004 | Model replaceability: unified adapter; no vendor-specific format in business layer; versioned prompts+config; runtime-validated structured output | P0 delivered | ART-72, ART-14 (Done) | `convex/simulation/providers/openAICompatible.test.ts`, `fakeProvider.test.ts`, `validators.test.ts` |
| NFR-005 | Security: admin authn/authz; public API never returns private knowledge or prompt; viewer input untrusted; secrets kept out of logs/traces; server-side authz audit before public deploy | P0 delivered | ART-62, ART-104 (Done) | `docs/security-audit-art-62.md` (full audit); H-1 resolution (ART-104 identity provider). `operatorAuthorization.test.ts`, `llmTrace.test.ts` |
| NFR-006 | Maintainability module boundaries: Canon, Simulation, Character Knowledge, Story, Editorial/Recap, Public Read Model, Viewer, Operations, Safety, Observability | P0 delivered | ART-3 (Done) | `test:architecture` enforces policy v1 over **11 modules**; gate green |
| NFR-007 | Testability: domain logic testable with no LLM/no network; deterministic fake provider; fixed world fixture; 7/30/90-day sim tests | P0 delivered (7/30); 90-day P1 deferred | ART-4, ART-60 (Done); ART-73 (To Do) | `fakeProvider.test.ts`, `mistwoodFixture.test.ts`, `longRunHarness.test.ts` (7/30-day). 90-day is P1 (ART-73); 30-day coverage already exceeds the MVP public-test gate |
| NFR-008 | Data integrity: every significant change traceable to an event; public content traceable to accepted events; corrections never delete audit history; partial failure produces no incomplete Canon | P0 delivered | ART-13, ART-14, ART-15, ART-50 (Done) | `commit.test.ts`, `validators.test.ts`, `continuity.test.ts`, `canonCorrection.test.ts` |
| NFR-009 | Accessibility: keyboard nav, reasonable contrast, reduced motion, non-map alternative views, image alt text, mobile touch sizes | P0 delivered | ART-93 (Done); ART-94 (To Do, P1 graph/timeline a11y) | `convex/publicRead/newcomerAcceptance.test.ts` exercises the public surface; ART-93 public-experience a11y compliance Done. P1 scoped graph/timeline a11y (ART-94) deferred with its P1 features |

---

## 19. §15 product analytics events & §16 success metrics

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| §15 (instrumentation) | 16 product analytics events (`home_viewed` … `share_action`) | Deferred P1 | ART-47 (To Do) | Does not block launch: analytics instrumentation is a P1 measurement layer. Its absence has no Canon/safety/experience impact on the public test surface |
| §15 (privacy constraint) | Analytics events must never contain model secret, private character data, full prompt, or sensitive user data | P0 delivered (constraint) | ART-57, ART-40 (Done) | Public trace is a 5-field Pick (audit I-1); public read path filters by `visibility` (audit M-2). The privacy constraint is enforced structurally regardless of whether instrumentation is wired |
| §16.1 | Product success metrics (first-visit episode open ≥40%, 3-min retention ≥30%, D1 ≥15%, D7 ≥8%, vote participation ≥10%, follow ≥8%, primer expand ≥20%, recommended-entry click ≥20%) | Deferred measurement | — | Live product metrics; require analytics (ART-47) and real traffic. Not a pre-launch code gate |
| §16.2 | World quality metrics (0 severe canon conflicts, 100% replay consistency, JSON success ≥98%, high-importance recap coverage ≥95%, 30-day completion 100%, repeat-scene <15%, active main arcs 1–3, 0 sourceless secret leaks, 0 unreasonable dead appearances, 0 character position conflicts) | P0 delivered (testable subset) | ART-15, ART-17, ART-35, ART-30, ART-60 (Done) | `continuity.test.ts`, `replay.test.ts`, `validators.test.ts`, `coverageValidation.test.ts`, `portfolio.test.ts`, `longRunHarness.test.ts` assert the zero-target and 100% invariants |
| §16.3 | Resource metrics (retry tokens <10%, low-importance work >80% on fast model, public traffic adds no LLM call, public content available during model outage, daily token predictable+limitable) | P0 structural delivered | ART-40, ART-57 (Done) | "Public traffic adds no LLM call" proven by audit I-3. Per-day token predictability/limit (FR-M003 / ART-59) is the P1 deferred portion |

---

## 20. §19 test strategy

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| §19.1 | Unit tests cover structural validation, Canon validation, reducer, replay, idempotency, arc state transition, knowledge permission, memory retrieval, recap event selection, voting rules, safety rules | P0 delivered (voting-rule unit is latent — FR-J001 deferred) | All P0 owners (Done) | `validators.test.ts`, `continuity.test.ts`, `reducer.test.ts`, `replay.test.ts`, `proposedEvent.test.ts`, `lifecycle.test.ts`, `knowledgeLedger.test.ts`, `memoryRetrieval.test.ts`, `coverageValidation.test.ts`, `preGeneration/postGeneration/viewerInput.test.ts`. Voting-rule tests land with ART-45 |
| §19.2 | Integration tests (10 scenarios: secret transfer, rumor spread, dead-character exclusion, unique item ownership across transfers, safe vote injection, provider retry, no-retry double-submit, episode accepted-only, correction→read-model update, sim-failure public readability) | P0 delivered | ART-61, ART-74, ART-76 (partial) (Done / To Do) | `canonCognitionIntegration.test.ts`, `failureIntegration.test.ts`, `itemOwnership.test.ts`, `episode.test.ts`, `canonCorrection.test.ts`. Rumor + viewer-intervention integration (scenario 2 & 5) is P1 under ART-76, matching the P1 deferral of FR-E005 and FR-J001 |
| §19.3 | Long-term sim (7/30/90-day, fixed seed; checks canon conflict, arc bloat, character staleness, dialogue/scene repetition, recap gaps, token anomaly, safety withhold, arc stagnation, replay consistency) | P0 delivered (7/30); 90-day P1 deferred | ART-60 (Done); ART-73 (To Do) | `longRunHarness.test.ts` |
| §19.4 | Newcomer comprehension test (30s: what's happening / why it matters; 3min: 3 core characters / current core question / where to start) | P0 delivered | ART-75 (Done) | `convex/publicRead/newcomerAcceptance.test.ts` |
| §19.5 | Manual narrative content evaluation program (character consistency, action-knowledge alignment, causality, arc progress, arc stalling, dialogue repetition, misleading summary, inappropriate-content interception) | P0 delivered (program) | ART-92 (Done) | `convex/operations/narrativeReviewSample.test.ts` provides the sampling harness; manual evaluation is an operational program, not a code gate |

---

## 21. §20 public-test acceptance criteria (AC#1 .. AC#25)

| AC | Summary | Status | Objective verification |
|---|---|---|---|
| AC#1 | Continuous 30-world-day simulation | Pass | `longRunHarness.test.ts`; offline gate `test:longrun` (ART-60) |
| AC#2 | Replay consistency 100% | Pass | `replay.test.ts` + 30-day long-run |
| AC#3 | No character position conflict | Pass | `continuity.test.ts` (FR-D004 rule) |
| AC#4 | No unreasonable dead-character appearance | Pass | `continuity.test.ts` |
| AC#5 | No sourceless secret leak | Pass | `knowledgeLedger.test.ts`, `continuity.test.ts` |
| AC#6 | Duplicate event not resubmitted | Pass | `proposedEvent.test.ts` (idempotency key), `scheduler.test.ts` |
| AC#7 | All high-importance events covered by recap | Pass | `coverageValidation.test.ts` (ART-35, PR #115) |
| AC#8 | Simultaneous main active arcs ≤ 3 | Pass | `portfolio.test.ts` (ART-30) |
| AC#9 | At least one arc reaches a reasonable turning point | Pass | 30-day long-run asserts arc progression |
| AC#10 | At least one arc reaches Resolving or Resolved | Pass | `resolution.test.ts` (ART-31) + long-run |
| AC#11 | Newcomer 30-second comprehension | Pass | `newcomerAcceptance.test.ts`, `onboardingSummary.test.ts` (ART-75) |
| AC#12 | Three-minute primer understandable | Pass | `arcPrimer.test.ts` (ART-38) + newcomer suite |
| AC#13 | Public read does not trigger LLM | Pass | Audit §4 I-3; `readModel.test.ts` |
| AC#14 | History readable while simulation stopped | Pass | `failureIntegration.test.ts`, `readModel.test.ts` (ART-40/74) |
| AC#15 | Kill switch verified | Pass | `emergencyStopControls.test.ts`, `emergencyStop.test.ts`; H-5 resolution (ART-102) |
| AC#16 | Correction event + replay verified | Pass | `canonCorrection.test.ts`, `replay.test.ts` (ART-50/17) |
| AC#17 | High-risk content never auto-published | Pass | `postGeneration.test.ts`, `preGeneration.test.ts`; H-4 resolution (ART-103) |
| AC#18 | Operator can pause/resume/retry/inspect failures | Pass | `opsConsole.test.ts`, `proposalReview.test.ts` (ART-48/49) |
| AC#19 | Typecheck, lint, tests, build, CI all pass | Pass | `npm run check` exit 0 — 86 suites / 1109 tests passed, 5 skipped; tsc clean; lint clean; vite build OK |
| AC#20 | Server-side authorization audit complete | Pass | `docs/security-audit-art-62.md` (ART-62 Done) |
| AC#21 | No known Critical/High security finding | Pass | Audit Criticals (C-1/C-2) and Highs (H-2/H-3/H-6/D-1) fixed in ART-62; release-blocking H-1/H-4/H-5 resolved by ART-104/103/102 |
| AC#22 | License & attribution retained | Pass | Audit C-2 remediation (ART-62): `ASSETS-LICENSE.md` restored, `ATTRIBUTION.md` + `docs/upstream.md` corrected |
| AC#23 | Production deployment not auto-enabled | Pass | Audit D-1 resolved — `gh api …/hooks` and `…/deployments` both empty (no Vercel link); no deploy command in CI |
| AC#24 | All PRD P0 requirements have verification evidence | Pass | This matrix (ART-63). Every P0 clause row above cites a Done task + a test file/suite/audit section |
| AC#25 | Incomplete P1 items do not compromise safety or core experience | Pass | This matrix (ART-63). Every deferred P1/P2 row above states why it is non-blocking. No deferred item touches Canon validation, safety classification, idempotency, event persistence, or the public read boundary |

---

## 22. §21 risk mitigations (RISK-001 .. RISK-009)

Each RISK clause is normative via its required mitigations. Classification reflects whether every listed mitigation is implemented.

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| RISK-001 | World-consistency collapse → mitigations: append-only store, Canon validation, knowledge permission, snapshot, replay, kill switch, correction event | P0 delivered | ART-13/15/24/17/53/50 (Done) | `commit.test.ts`, `continuity.test.ts`, `knowledgeLedger.test.ts`, `replay.test.ts`, `emergencyStopControls.test.ts`, `canonCorrection.test.ts` |
| RISK-002 | Boring world content → mitigations: tension readiness, warmup, Director pressure, repetition monitoring, heat score, long-absent character detection, environment injection | P0 delivered (heat score & repetition-evaluator P1 deferred) | ART-7/8/19, ART-32 (To Do), ART-88 (To Do), ART-45 (To Do) | `tensionReadiness.test.ts`, `warmup.test.ts`, `director.test.ts`. Heat score (FR-F006/ART-32) and novelty evaluators (ART-88) are P1; Director pressure + tension readiness cover the core |
| RISK-003 | Infinite arc growth → mitigations: active-arc cap, lifecycle, auto-resolution, merge/archive, old-history compression | Fully delivered (history compression closed by ART-27) | ART-30/64/31/27 (Done) | `portfolio.test.ts`, `lifecycle.test.ts`, `resolution.test.ts`, `memoryCompression.lossless.test.ts`. Compression bounds the *working corpus*, not storage: Canon stays append-only by design, and the fixed-point property means a scheduled pass cannot keep folding the same history |
| RISK-004 | Newcomer cannot understand → mitigations: current situation, 3 backstories, ≤4 core characters, recommended entry, 3-min primer, homepage not showing full world | P0 delivered | ART-37/67/38/41 (Done) | `onboardingSummary.test.ts`, `entryRecommendation.test.ts`, `arcPrimer.test.ts`, `newcomerAcceptance.test.ts` |
| RISK-005 | Model quota high but rate-limit insufficient → mitigations: queue, concurrency control, scene merge, model routing, degradation, rule-based background events | P0 mitigations partially delivered; rate-limit/degradation P1 deferred | ART-21 (Done), ART-59 (To Do), ART-91 (To Do) | `sceneGrouping.test.ts` (scene merge reduces call count). Concurrency/budget (FR-M003/ART-59) and degradation (FR-M004/ART-91) are P1; deterministic fake provider means no live LLM quota exposure during public-test evidence runs |
| RISK-006 | Inappropriate content generated → mitigations: pre-generation limits, post-generation classification, publication status, withhold, operator review, no auto external publish | P0 delivered | ART-54/55/51, ART-103 (Done) | `preGeneration.test.ts`, `postGeneration.test.ts`, `publicationLifecycle.test.ts` |
| RISK-007 | Over-reliance on upstream project → mitigations: independent Canon domain, independent public read model, replaceable visual layer, upstream updates do not control product data model | P0 delivered | ART-3, ART-40 (Done) | `test:architecture` enforces the 11-module boundary; `readModel.ts` takes no provider/simulation dependency (audit I-3) |
| RISK-008 | Summaries drift from facts → mitigations: summaries cite event IDs, machine summary, coverage validation, periodic Canon recalibration, summaries never produce new Canon | P0 delivered | ART-33/34/35 (Done) | `episode.test.ts`, `recaps/model.test.ts`, `coverageValidation.test.ts` |
| RISK-009 | Public traffic collapses simulation → mitigations: public read model, cache, sim/presentation isolation, public reads trigger no generation | P0 delivered | ART-40 (Done) | `readModel.test.ts`; audit I-3 (public read path imports no provider) |

---

## 23. §22 confirmed product decisions (15) & §23 task-decomposition rules

| Clause ID | Summary | Classification | Verification |
|---|---|---|---|
| §22 (1–15) | Watchable persistent world (not chat); single public MVP world; 12–20 main characters; warmup before public; viewers cannot dictate results; viewers influence via environment events; append-only Canon; LLM only proposes; deterministic reducer; public reads never trigger LLM; ≤3 main active arcs; newcomers need not start from episode 1; public pages center plot/character not tech; no 100–200 full agents; public-production security audit is a release precondition | Decisions upheld | Each decision is restated and verified elsewhere in this matrix: single public world (G1), character count (G2), warmup (FR-A004/§10.3), viewer-control prohibition (UX-005 + FR-J001 acceptable-list), append-only Canon (FR-D002), LLM-only-proposes (FR-D001 + audit C-1), deterministic reducer (FR-D005), public-read-no-LLM (G13 + audit I-3), arc cap (FR-F004), onboarding (FR-H001..003), tech-not-headlined (UX-006), security-audit precondition (NFR-005 / AC#20–21) |
| §23 | Task decomposition rules (17 backlog epics A–Q; each task carries Requirement ID / Problem / Goal / Scope / Out-of-Scope / Dependencies / Schema/API/Security impact / Acceptance Criteria / Validation Commands / Test Requirements / Documentation Impact / DoD; one task ≤ one reviewable PR; prescribed decomposition order Canon → Simulation → Cognition → Story → Editorial → Public → Interaction → Ops; maps/animations/full-relationship-graph must not be the starting point) | Process rule upheld | The ART-* backlog follows the prescribed order (ART-5…17 Canon foundation → 18…23 simulation → 24…26 cognition → 29…32 story → 33…38 editorial → 41…70 public → 45/46 interaction → 48…62 ops). Every Done task carries Requirement ID(s) and the prescribed metadata. No task begins from map/animation/graph — public experience tasks (ART-41+) started only after Canon/Simulation/Cognition were green |

---

## Gaps / unowned in-scope clauses

**None.** Every normative in-scope clause in PRD Sections 1–23 maps to at least one owning backlog task, and every P0 clause maps to at least one task whose status is **Done** plus at least one objective verification reference. No P0 clause is unowned or blocked on incomplete work.

---

## P0 clauses whose task is not yet Done

**None.** Every P0 clause (`§5.1` goals G1–G9, G12–G14; `§5.3` all tech/ops goals; UX-001..004, UX-006 + UX-005 principle; FR-A001..A004, FR-B001..B002, FR-C001..C005, FR-D001..D006, FR-E001..E003, FR-F001..F005, FR-G001..G003, FR-H001..H003, FR-I001..I006, FR-K001..K004, FR-K006, FR-L001..L003, FR-M001; the §12 pipeline & failure rules; §10.2 dev/test mode; NFR-003..006, NFR-008..009; §16.2 quality invariants; §19.1/19.2/19.4 + 7/30 of §19.3; RISK-001/003/004/006/007/008/009 and the P0 portions of RISK-002/005) is backed by one or more **Done** tasks. The only incomplete tasks referenced anywhere in this matrix are P1 or P2 (ART-11, ART-28, ART-32, ART-36, ART-39, ART-44, ART-45, ART-46, ART-52, ART-58, ART-59, ART-71, ART-73, ART-76, ART-88, ART-89, ART-90, ART-91, ART-94, ART-47) — none of which own a P0 clause.

---

## Closure audit (non-goals) — §6

For each of the 17 MVP non-goals, the implemented scope is verified **absent**.

| §6 non-goal | Status | Basis |
|---|---|---|
| 3D world | Absent | Web-only Vite build; no 3D engine dependency (no three.js / babylon / react-three-fiber). Public surfaces are projection-based text/lists |
| High-quality real-time animation | Absent | FR-I002 AC#1 explicitly waives it; live view renders summaries & positions, no animation runtime |
| Real-time voice conversation | Absent | No WebRTC / voice / TTS code; character speech is produced offline via scene simulation, not live voice |
| Viewers freely chat with all characters | Absent | No free-chat UI or mutation. The only viewer input path is the daily vote (FR-J001), which is itself P1-deferred (ART-45 To Do) and restricted to pre-defined environment events |
| Viewers directly dictate character outcomes | Absent | No viewer-command path. Canon Validation (FR-D004) rejects causeless change; FR-J001 不可接受 list forbids command-style votes; UX-005 enforced |
| Viewer-created worlds | Absent | No world-creation mutation or UI. Single hardcoded `MISTWOOD_PUBLIC_WORLD_ID`; world config is imported by operators (FR-A001) |
| Multiple public worlds | Absent | Single `MISTWOOD_PUBLIC_WORLD_ID` constant; no world-listing or world-switch surface |
| 100–200 full LLM characters | Absent | 12–20 characters seeded (ART-77, FR-A002). No background-resident agent pool |
| Real-person simulation | Absent | FR-A002 AC#6 explicitly forbids real-person data; Mistwood characters are fictional (ART-77) |
| Real news prediction | Absent | World is the fictional town of Mistwood; no news ingest, no real-event source |
| Full economic simulation | Absent | Only a per-character `financialState` field; no market/pricing/transaction engine |
| Full political simulation | Absent | Organizations are static projections (ART-81); no election/legislation/civic engine |
| Native iOS / Android app | Absent | Web-only Vite SPA; no React Native / native / app-store code or build target |
| Unreviewed user-generated character content | Absent | No character-creation surface; viewer input is untrusted-by-default (FR-L003) and classified (ART-56); publication lifecycle (FR-K004) gates everything |
| Blockchain / NFT / virtual-asset trading | Absent | Items & assets are projection-only (ART-80, unique ownership); no ledger, token, or trading code |
| Production-grade payment system | Absent | No payment/billing code; no Stripe/Shopify/etc. dependency in `package.json`; `"private": true` prevents accidental publish |
| Auto-posting unreviewed content to external social | Absent | No external-social API client; FR-G005 share formats are P1-deferred (ART-36 To Do) and explicitly constrained against auto-external publish; ART-92 manual evaluation program is the only review path |

**Closure audit verdict (AC#28):** the implemented scope does not include any MVP non-goal. No non-goal is present accidentally.

---

## Notes & uncertainties

- **Live operational metrics (NFR-001 availability, NFR-002 LCP/P95/latency, §16.1 product success metrics):** these are SLOs measurable only against a real deployment. No production deployment exists (audit D-1 — no Vercel link, empty GitHub deployments API), so the figures are recorded as "structural enablers delivered; live SLO verification deferred to post-deploy". This is consistent with AC#23 (production not auto-enabled) and is not a code gap.
- **FR-L003 viewer-input classifier (audit M-1):** Done as code (ART-56) but has zero production callers because the consuming feature FR-J001 (voting) is P1-deferred. Recorded as "latent" by the audit. The AC carried forward onto ART-45 ("viewer input passes through `classifyViewerInput` server-side") closes this when voting ships. Does not block launch because no viewer-input surface exists today.
- **FR-H005 spoiler control:** classified as P2 deferred because the PRD itself says "MVP 可不實作". ART-70 (Done) delivers only the data-compatibility constraint the PRD attaches to it ("資料模型不得阻止後續支援"). Functional spoiler UI remains P2.
- **Audit residual items not blocking AC#21:** the Medium/Low findings (M-2 sanitizer denylist-vs-allowlist wording, M-4 denied-attempt audit persistence, M-5 `package.json` SPDX compound expression, M-6 guard-hook deploy-pattern gap, M-7 stale Fly runbook, I-5 audit-leak heuristic, L-1 upstream trademarks in chrome) remain open as tracked follow-ups. None is Critical or High, so AC#21 ("no known Critical/High") is satisfied. They are recorded here for traceability; the recommended follow-up tasks are enumerated in `docs/security-audit-art-62.md` §8.
- **RISK-002 / RISK-005 partial:** the P1-deferred heat score (ART-32), novelty/repetition evaluators (ART-88), token-rate controls (ART-59), and degradation workflow (ART-91) leave portions of these two risks' mitigation lists unimplemented. Both are classified as "P0 mitigations delivered; refinement P1 deferred" because the P0 mitigations already bound the risk (tension readiness + Director pressure for RISK-002; scene merge + deterministic fake provider for RISK-005).
