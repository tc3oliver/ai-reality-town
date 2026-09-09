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

**Post-audit updates:** this matrix is a living traceability record, so a clause delivered after the
ART-63 audit is re-classified in place and the counts above move with it; the dated gate evidence in
this header is left as the audit found it. The `P1 delivered early` rows (ART-35, ART-87) are the
existing precedent for a non-P0 clause counting as delivered.

- **2026-09-09 — FR-M004** moved `Deferred P1` → `Delivered` (ART-91,
  `docs/model-outage-degradation.md`), and closes the last open clause in Epic M. Two things are worth stating plainly rather than leaving implied.
  First, the "never skipped" clause is satisfied by construction rather than by discipline: the
  ladder returns a LEVEL and runs none of the four gates itself, and rung 4 — the rung a shortcut
  would build as a Canon bypass — emits **Proposed** Events that pass structural and Canon
  validation like any other. Second, the ladder needed a real defect fixed before it could work at
  all: `describeWorldDayError` collapsed every provider outage, timeout, exhausted route chain and
  budget refusal into the single code `WORLD_DAY_STAGE_FAILED`, so the field a ladder must read
  could not distinguish the failures it must respond to differently. RISK-005's mitigation list is
  complete as of this row.
- **2026-09-07 — FR-F002/F004/F005 live closure** (ART-163). An audit of the Story Arc engine
  against a running world found four capabilities implemented, unit-tested, registered and called
  by nothing: `recordArcResolutionDecision`, `applyArcResolutionConsequences`, any action on a
  stagnation prompt, and `validateMajorArcMemberships`. The rows above already read "delivered",
  and were: the rules existed and passed their tests. What no test asked was whether the pipeline
  used them. This is recorded as a closure rather than a re-classification because the requirement
  was never satisfied on the path the world actually takes.
- **2026-09-07 — FR-E005** moved `Deferred P1` → `P1 delivered` (ART-28,
  `docs/rumor-propagation-chains.md`). The `rumor` event type had existed since the foundation
  and was consumed by nothing; the scene author's `rumors[]` collection is narrative colour by
  its own prompt and was never domain state. Neither is a partial implementation, and the
  distinction is now stated in the prompt as well as in code. Rumor chains are internal: reads
  are authorized under the knowledge ledger's own gate, a character sees only what reached them,
  and no public read model carries a rumor field.
- **2026-08-25 — FR-E004** moved `Deferred P1` → `P1 delivered` (ART-27, PR #201,
  `docs/long-term-memory-compression.md`).
- **2026-08-25 — FR-B003** moved `Deferred P1` → `P1 delivered` (ART-11, `docs/persona-deviation.md`).
  Gate at that commit: `npm run check` exit 0, **167 suites / 2599 tests** (2594 passed, 5 skipped).
- **2026-08-28 — FR-J002** moved `Deferred P1` → `P1 delivered` (ART-46,
  `docs/vote-consequence-tracking.md`). Delivered as a DERIVED read model: Canon is untouched and
  no causality is stamped anywhere, because `causedByEventIds` is empty on every event the running
  system produces and inferring edges to fill the view is exactly what AC#2 forbids. The view
  reports what provenance supports and states the emptiness plainly.
  Gate at that commit: `npm run check` exit 0, **178 suites / 2745 tests** (2740 passed, 5 skipped).
- **2026-08-29 — FR-G005** moved `Deferred P1` → `P1 delivered` (ART-36,
  `docs/episode-share-formats.md`). Delivered as a DERIVED, OPERATOR-ONLY artifact. Two things are
  worth stating plainly rather than leaving implied. First, AC#1 is a build guarantee, not a
  convention: a new `derivedContent` module (root `convex/editorial/derived`) sits under
  `canonWriteBoundary.forbiddenModules` and may not depend on `canon`, so naming a write symbol or
  importing the Canon model fails `check:architecture`. Second, AC#3 is a refusal at the
  publication-candidate boundary, NOT a check performed before transmitting — this deployment still
  has no external publication transport of any kind, and none was added. The §6 non-goal row was
  updated rather than retired.
  Gate at that commit: `npm run check` exit 0, **188 suites / 2957 tests** (2952 passed, 5 skipped),
  architecture boundaries valid (policy v1, **20 modules**); `npm run e2e` green (72 passed), run
  on its own since it is not part of `check`.

---

## Closure summary

**The `Classification` column is a closed vocabulary, and these counts are checked against it.**
Every clause row's classification is exactly one of the tokens below — no prose, no bold, no
parentheticals; the nuance that used to live in that cell now lives in `Objective verification`,
where the rest of the nuance already was. `npm run check` runs
`scripts/docs/check-closure-matrix.mjs`, which recounts the rows and fails if any total here
disagrees with them, if a row carries a classification outside the vocabulary, or if the totals do
not sum to the number of rows. See `§ Counting rules` below.

Before ART-152 these totals were prose-maintained and had drifted badly: `P0 delivered` read 98
against 108 rows, and `Deferred P1/P2` read 20 against 3. The drift was not random. The summary had
no bucket for a P1 or P2 clause that had been **delivered**, so each time the post-audit log below
moved a clause out of `Deferred` (FR-B003, FR-E004, FR-E005, FR-G005, FR-I007, FR-J001, FR-J002,
FR-M002, FR-M003, FR-M004 and the rest), the deferred count was decremented and nothing was
incremented. Fifteen clauses fell out of the arithmetic one at a time.

| Classification | Count | Launch-blocking? |
|---|---:|---|
| `P0 delivered` — in MVP scope, owning task Done, objective verification cited | 108 | — |
| `P1 delivered` — a P1 clause delivered anyway; not required for launch | 16 | No |
| `P2 delivered` — a P2 clause delivered anyway | 1 | No |
| `P1 deferred` — explicitly out of MVP, owned by a backlog task | 0 | No |
| `P2 deferred` — explicitly out of MVP, owned by a backlog task | 1 | No |
| `Not launch-gated` — delivered as far as an offline gate reaches; the remainder needs live traffic | 2 | No |
| **Total clause rows** | **128** | |
| **Non-goal** (matches a `§6` non-goal; verified absent — `§ Closure audit`) | 17 | — |
| **Unowned in-scope clause (gap)** | **0** | — |
| **P0 clause whose task is not yet Done** | **0** | — |

### Counting rules

- A **clause row** is a row in any table whose header is exactly
  `| Clause ID | Summary | Classification | Owning task (status) | Objective verification |`.
  The §22/§23 table has a different header (four columns) and records process decisions rather than
  clauses, so it is deliberately not counted.
- A **non-goal row** is a row of the `| §6 non-goal | Status | Basis |` table, and every one of them
  must read `Absent` — a non-goal that is present is not a counting error, it is a scope breach.
- The three bold rows are asserted to be zero by the `§ Gaps` and `§ P0 clauses whose task is not yet
  Done` sections. They are counted as literals rather than derived, because "no row says this" is not
  evidence that the condition does not exist — those two sections are the evidence.

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
| §5.1 G8 | One Episode per **completed** world day | P0 delivered | ART-33, ART-89 (Done) | `convex/editorial/episode.test.ts`, `convex/operations/postCommitWorldState.test.ts`, `longRunHarness.test.ts` (`recapCoverage.episodes === worldDays - 1`). **"Completed" is load-bearing and was corrected by ART-89.** A day used to count as complete the moment one accepted event carried the final time slot; the post-commit pipeline runs once per accepted event, so the first event of a day's final slot triggered that day's Episode, and Episodes are idempotent per day — the rest of the slot reached no Episode, recap or publication. A day is now complete only once the world has moved past it (`day < latestWorldDay`), so the newest day's Episode is due on the next day's first commit, which in production is the next cron tick. The harness therefore reports one episode per day *except* the newest, and that assertion said `worldDays` until ART-89 |
| §5.1 G9 | New viewer understands main line in 30s | P0 delivered | ART-37, ART-75 (Done) | `convex/publicRead/onboardingSummary.test.ts`, `newcomerAcceptance.test.ts` |
| §5.1 G10 | Return viewer catches up quickly | P1 delivered | ART-39 (Done, FR-H004) | `src/components/recap/returnRecap.test.ts` (bounded output: a 30-day absence yields the same size recap as a 2-day one; followed content ordered first), `convex/viewer/viewerProgressFunctions.test.ts`; E2E `e2e/dynamicView.spec.ts` 「the return recap performs no write on load」; design note `docs/device-return-recap.md` |
| §5.1 G11 | Daily viewer vote on an environment event | P1 delivered | ART-45 (Done, FR-J001) | `convex/viewer/environmentVote.test.ts`, `environmentVoteInjection.test.ts`; design note `docs/daily-environment-vote.md`; PR #204 |
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
| §5.2 | Product validation hypotheses (newcomer / arc / daily return / voting / tracking) | Not launch-gated | ART-47 (Done) | Depends on live traffic. The measurement layer now exists: ART-47 ships the events, the store and the §16.1 computation. Structural enablers (comprehension suite ART-75, content eval ART-92) are Done; live validation remains a post-launch activity, not a launch gate |

---

## 2. UX principles — §8 (UX-001 .. UX-006)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| UX-001 | Show the present first, not the history | P0 delivered | ART-41 (Done) | `convex/publicRead/readModel.test.ts`, `newcomerAcceptance.test.ts` (homepage leads with current situation) |
| UX-002 | Only surface info needed to understand the current event (≤4 core chars, 3 backstories, 1 entry point) | P0 delivered | ART-37, ART-67 (Done) | `onboardingSummary.test.ts` (≤4 core characters, 3 essential backstories, 1 recommended entry), `entryRecommendation.test.ts` |
| UX-003 | Deep information revealed layer by layer (30s → 3min → episode → arc → relationship → full history) | P0 delivered | ART-37, ART-38, ART-42, ART-69 (Done) | `arcPrimer.test.ts`, `episodeTimelineProjection.test.ts`, `relationshipArcProjection.test.ts` |
| UX-004 | Even with many arcs, homepage highlights only the top 1–3 | P0 delivered | ART-30, ART-41 (Done) | `portfolio.test.ts` (homepage shows highest-priority arc only) |
| UX-005 | Viewers influence the environment, never dictate outcomes | P0 delivered | ART-15 (Canon Validation rejects command-style), ART-45 (Done) | The principle is upheld now that voting ships, not only in the absence of a voting path. The ballot is a closed catalog of world-environment facts that cannot express a character outcome (`environmentVote.test.ts` → *no catalog entry can express an outcome*); a winning event is still refused by Canon (`environmentVoteInjection.test.ts` → *a winning event is still refused when it violates an immutable world rule*); `continuity.test.ts` enforces no sourceless change |
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
| FR-B003 | Persona-deviation detection (high-importance deviations flagged, baseless reversions rejected, summaries updated) | P1 delivered | ART-11 (Done) | `convex/canon/personaDeviation.test.ts`, `convex/canon/personaDeviation.boundary.test.ts`; design note `docs/persona-deviation.md` |

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
| FR-D006 | Snapshot & replay (daily snapshot, full replay, snapshot+delta replay, full vs snapshot-replay identical, 30-day 100% consistency, rollback preserves history) | P0 delivered | ART-17 (Done) | `convex/canon/snapshotManager.test.ts`, `replay.test.ts`; `longRunHarness.test.ts` for 30-day consistency. ART-58 made the long-run half real: the harness now binds the actual `createDailySnapshot` (the stage was a stub citing an already-Done ART-99), so "full vs snapshot-replay identical" is checked against snapshots the run genuinely persisted rather than against a second replay of the same log |

---

## 7. Epic E — Character knowledge, memory, rumor (FR-E001 .. FR-E005)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-E001 | Character knowledge with source, truth status, no unauthorized access, event-driven updates | P0 delivered | ART-24 (Done) | `convex/knowledge/knowledgeLedger.test.ts`, `canonCognitionIntegration.test.ts` |
| FR-E002 | Subjective memory (per-character interpretation, importance, emotional weight, confidence, visibility; separable from Canon Fact; may contain misunderstanding; never directly public) | P0 delivered | ART-25 (Done) | `convex/knowledge/subjectiveMemory.test.ts` |
| FR-E003 | Bounded memory retrieval (semantic/importance/recency/emotion/arc relevance; bounded count; traceable; no full history in prompt; no unauthorized memory) | P0 delivered | ART-26 (Done) | `convex/knowledge/memoryRetrieval.test.ts` |
| FR-E004 | Long-term memory compression (impressions, stable beliefs, relationship summaries, arc understanding, location experience; lossless; Canon-preserving) | P1 delivered | ART-27 (Done) | `convex/knowledge/memoryCompression.test.ts`, `memoryCompression.lossless.test.ts`, `memoryCompression.boundary.test.ts`; `docs/long-term-memory-compression.md`. "Lossless" is pinned to three machine-checked properties — exact partition, verbatim round trip, and recall preservation against the real FR-E003 retriever at every limit 1–12 — and the one dimension that *is* lossy (an old low-importance memory leaves the retrieval corpus) is asserted as such rather than only described |
| FR-E005 | Versioned rumor propagation chains (source, chain, current version, credibility, objective truth, known corrections; never auto-promoted to Canon Fact) | P1 delivered | ART-28 (Done) | `convex/canon/rumorChain.test.ts`, `convex/knowledge/rumorLedger.test.ts`, `convex/publicRead/rumorPublicBoundary.test.ts`; `docs/rumor-propagation-chains.md`. Four state changes folded by the deterministic reducer, so the chain is replayable rather than a derived table. The two fields a provider must not author are DERIVED: objective truth by asking Canon about the claim, credibility from what holders currently make of it. Per-character belief is the knowledge ledger with a rumor link rather than a second store, so 「角色知道什麼」 keeps one answer. AC#1 is enforced structurally (no rumor path writes `facts`) and by refusal (`RUMOR_CANNOT_BECOME_FACT`) |

---

## 8. Epic F — Story Arc engine (FR-F001 .. FR-F006)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-F001 | Arc creation & classification (assign/merge/new-arc decision, Event Role taxonomy, bounded main-arc count, premise + current question required) | P0 delivered | ART-29 (Done) | `convex/story/classification.test.ts` |
| FR-F002 | Arc lifecycle state machine (Emerging/Active/Escalating/Climax/Resolving/Resolved/Archived with rule-based transitions) | P0 delivered | ART-64, ART-163 (Done) | `convex/story/lifecycle.test.ts`, `convex/operations/arcClosureLoop.test.ts`. ART-163 closed the live half: `Archived` was unreachable in production (no accepted event classifies into a `resolved` arc, so the classification-driven path stops one step short) and every resolution status is now gated by a recorded decision rather than by a legality check alone |
| FR-F003 | Arc data contract (title, premise, current question, status, core characters, inciting event, latest turning point, essential facts, unresolved/resolved questions, recommended entry, heat score, last progress) | P0 delivered | ART-65 (Done) | `convex/story/projection.test.ts` |
| FR-F004 | Arc count control (≤3 main active, ≤6 secondary, ≤6 core chars/arc, ≤2 arcs advanced per event; merge/demote/reject on overflow; no event deletion) | P0 delivered | ART-30, ART-163 (Done) | `convex/story/portfolio.test.ts`, `convex/operations/arcClosureLoop.test.ts`. The ≤2-major-arcs-per-event clause was enforced nowhere in production until ART-163 wired `validateMajorArcMemberships` into the live classification; the ≤6 secondary clause now has a per-world-day checkpoint in the ART-60 harness, which previously sampled only the major pool |
| FR-F005 | Arc resolution (14-day-stagnation alert, no unexplained disappearance, resolved arcs leave outcome+consequences, post-resolution summary update) | P0 delivered | ART-31, ART-82, ART-163 (Done) | `convex/story/resolution.test.ts`, `consequenceSummary.test.ts`, `convex/operations/arcClosureLoop.test.ts`, `docs/arc-stagnation-resolution.md`. ART-31 and ART-82 built and tested the rules; ART-163 found that `recordArcResolutionDecision` and `applyArcResolutionConsequences` had **no production caller**, so on the live path arcs reached `resolved` with no outcome, no consequences and no summary refresh, and a stagnation prompt was recorded but acted on by nothing. Resolution is now routed through a decision (decide → transition → apply), and a deterministic ladder gives a stalled arc's slot back without deleting the arc |
| FR-F006 | Arc heat score (traceable, not freely LLM-decided, operator-visible composition) | P1 delivered | ART-32 (Done) | `convex/story/heat.test.ts`, `docs/arc-heat-score.md`. The field is not new — `heatScore` has ordered the homepage since ART-65 — but its value was `Math.round(importance * 100)`, one of FR-F006's six signals read off the single event being folded, which made 新鮮度 *unrepresentable* and 是否接近高潮 inert. It is now a weighted composite of all six, renormalised by measured weight, with every component's evidence persisted to `storyArcHeatScores` (AC#1) and readable through the operator-gated `inspectArcHeat` (AC#3). AC#2 was already true and is now pinned: `compareArcsByHeat` is one exported, total, deterministic comparator. 觀眾互動 required a new `arcInteractionCounters` rollup, bumped at analytics ingest — `analyticsEvents` has no arc index and a life-of-arc count would be unbounded on a per-event path |

---

## 9. Epic G — Episode & editorial layer (FR-G001 .. FR-G005)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-G001 | Daily Episode (number, title, headline, summary, 3–5 key scenes, relationship changes, new/resolved questions, related arcs/characters, next-episode tease; accepted-events-only; high-importance coverage; no secret leak; failure does not touch Canon) | P0 delivered | ART-33 (Done) | `convex/editorial/episode.test.ts` |
| FR-G002 | Incremental recap pyramid (Raw → Scene → Episode → Arc → Season → Viewer Context; traceable; incremental; never full-history reload; regenerable without changing Canon) | P0 delivered | ART-34 (Done), ART-164 (live wiring: scene/arc/season had no caller) | `convex/recaps/model.test.ts`, `convex/operations/postCommitLive.test.ts` |
| FR-G003 | Three-level Episode recaps (Quick 80–150 中文字, Standard 400–800 中文字, Deep, Machine Summary with What Changed / Why / Who Affected / New+Resolved Questions / Required Prior Facts / Arc Progress) | P0 delivered | ART-66 (Done), ART-164 (composition, persistence, live wiring; no builder existed for Quick or Standard) | `convex/recaps/recapFormats.test.ts`, `convex/recaps/recapComposition.test.ts`, `convex/simulation/fakeSceneNarratorLanguage.test.ts` |
| FR-G004 | Recap coverage & spoiler validation (high-importance coverage or explicit exclusion; major relationship change mentioned; turning point mentioned; spoiler violation detected) | P1 delivered | ART-35 (Done, PR #115), ART-164 (made it an enforced publication precondition; both functions had zero callers) | Delivered ahead of MVP scope. `convex/recaps/coverageValidation.test.ts`, `convex/operations/postCommitLive.test.ts` |
| FR-G005 | Episode-derived share formats (local news, social short-post, share-card copy, next-day preview; no new Canon; source-tagged; no auto external publish) | P1 delivered | ART-36 (Done) | `convex/editorial/derived/shareFormats.test.ts`, `convex/editorial/derived/shareFormats.boundary.test.ts`, `convex/editorial/shareFormatFunctions.test.ts`; `docs/episode-share-formats.md`. AC#1 is enforced by the build: `derivedContent` is a declared module under `canonWriteBoundary.forbiddenModules` and may not depend on `canon`. AC#3 remains compatible with the §6 non-goal — no external transport was added; see the non-goal row below |

---

## 10. Epic H — New-viewer onboarding (FR-H001 .. FR-H005)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-H001 | Cached current-situation onboarding summary (≤~300 chars; major event + why + ≤4 core chars + 3 backstories + 1 core question + recommended episode + best scene; cached; per-visitor read does not invoke LLM) | P0 delivered | ART-37 (Done) | `convex/publicRead/onboardingSummary.test.ts` |
| FR-H002 | Three-minute active-arc primer (cause, latest turning point, core characters, unresolved questions; ~2–4 min read; no need to start from episode 1) | P0 delivered | ART-38 (Done) | `convex/publicRead/arcPrimer.test.ts` |
| FR-H003 | Recommended entry episode per active arc (core characters present, clear turning point, low comprehension cost, not too far from current progress, reason queryable, re-evaluated on major arc change) | P0 delivered | ART-67 (Done) | `convex/story/entryRecommendation.test.ts` |
| FR-H004 | Device-aware return recap (events since last viewed, tracked-character changes, arc progress, vote consequences, continue-watching point; device-level progress without login) | P1 delivered | ART-39 (Done) | AC#7 is now delivered in BOTH clauses. The first (no cross-identity read or write) was ART-39's and is tested in both directions since ART-71 — a signed-in caller cannot reach the device row, and two accounts cannot reach each other. The second (explicit, authorized, lossless merging) is ART-71's `mergeDeviceProgressIntoAccount`: it needs both a verified identity and the device token, nothing merges as a side effect of signing in, and everything the caps cannot keep is REPORTED rather than dropped — `mergeWasLossless` is computed, not asserted. `src/components/recap/returnRecap.test.ts` (AC#1 bounded output + AC#2 followed-content ordering + the pin that `uncertain` vote-consequence nodes are never presented as effects), `convex/viewer/viewerProgress.test.ts`, `convex/viewer/viewerProgressFunctions.test.ts` (AC#3 device progress; AC#7 cross-identity negative: digest B can neither observe nor mutate digest A's row; an over-budget device writes zero rows), a11y `src/components/public/publicPages.a11y.test.tsx`, E2E `e2e/dynamicView.spec.ts`. **AC#7 is NOT checked.** Its first clause (no cross-identity read or write) is delivered structurally — every access is index-keyed on the caller's own digest, with no caller-supplied row id and no scan — and holds against accident and enumeration but NOT against an adversary presenting another viewer's client-minted key. Its second clause (explicit, authorized, lossless merging) is unsatisfiable here: this deployment has no viewer authentication (`convex/auth.config.ts` returns `providers: []`; the only `getUserIdentity()` callers are operator functions), so "authenticated progress" is a provably empty set and a merge routine would have no second operand. ART-71 (FR-J003, depends on ART-39) owns it; the `viewerKey` namespace (`device:` / `auth:`) is reserved so that merge needs no destructive migration. See `docs/device-return-recap.md` §5 |
| FR-H005 | Spoiler control (Full / Public-only / Watched-only) | P2 deferred | ART-70 (Done) | ART-70 (Done) delivers the data-compatibility constraint the PRD attaches to this clause; the functional spoiler UI is the deferred part. PRD explicitly says "MVP 可不實作，但資料模型不得阻止後續支援". ART-70 delivers the data-compatibility constraint (modes declared, filtering uses only existing fields, forward-compatible `viewerEpisodeProgress` table not populated in MVP). Functional spoiler UI is P2. `convex/viewer/spoilerMode.test.ts` (10 compatibility tests) |

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
| FR-I007 | Scoped relationship graph (current-arc core characters, one-hop relationships, last-7-day changes; date switch, type filter, summaries, change reasons; never renders all characters/relationships by default) | P1 delivered | ART-44 (Done) | Server-scoped read model `relationshipGraph:<worldId>:<worldDay>`, built from Canon (`convex/publicRead/relationshipGraphProjection.ts`) + `#graph/<worldId>` page. `convex/publicRead/relationshipGraphProjection.test.ts`, `src/components/public/relationshipGraphRoute.test.ts`, `e2e/dynamicView.spec.ts`. See `docs/scoped-relationship-graph.md`. (Full P1 graph accessibility remains ART-94) |
| FR-I008 | Major-event world timeline (arc/character/event-type filters, episode deep-links) | P1 delivered | ART-87 (Done) | Delivered ahead of MVP scope. `convex/publicRead/episodeTimelineProjection.test.ts`; ART-87 focused suite `timelineRoute` 14/14 |

---

## 12. Epic J — Viewer interaction (FR-J001 .. FR-J003)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-J001 | Daily environment-event vote (3–4 safe candidates; per-device rate limit; single winner; winner injected as Proposed World Event; no result dictated) | P1 delivered | ART-45 (Done) | `convex/viewer/environmentVote.test.ts` (30 tests: candidate safety/Canon shape, per-device limit, attempt budget, cutoff, deterministic single winner), `environmentVoteInjection.test.ts` (9 tests: real commit pipeline, idempotency, Canon rejection). The write surface is the deployment's ONLY viewer-reachable mutation and is fenced by `viewerWriteBoundary`; see `docs/daily-environment-vote.md` §2 for the read-only-guarantee decision. Merged implementation evidence: PR #204 |
| FR-J002 | Vote-consequence tracking (mark vote-triggered events, direct effects, downstream events, unconfirmed indirect effects; never over-claim causation) | P1 delivered | ART-46 (In Progress) | `voteConsequenceProjection.test.ts` (23 tests: trigger selection off the `vote:` prefix cross-checked against `appliedEventId`, direct edges, multi-hop closure with real paths, cycle termination, determinism, provenance validation), `voteConsequenceProjectionFunctions.test.ts` (10 tests: the six indexed reads, the Scene → grouping-run → Director-plan walk, the ART-132 safety gate, and the published payload), `src/components/vote/voteConsequenceModel.test.ts` (14 tests: the four distinct labels and the wording that keeps AC#2). **AC#2 is pinned by a test against today's real canon shape** — no event carries a `causedByEventIds` edge, so `direct`/`downstream` MUST be empty and everything context-linked lands in `uncertain`; the view reports honest emptiness instead of inferring causality. A derived read model only: Canon is unchanged, no causality is stamped, and no new public query is added (reads reuse `getPublishedReadModel`). **Known bound, stated rather than implied:** links are reported over `[targetWorldDay, targetWorldDay + VOTE_CONSEQUENCE_LOOKAHEAD_DAYS]` (=1, derived from the Director's `RECENT_EVENT_WINDOW` of 10 accepted events over five slots a day), and the pipeline re-runs the same trailing window on each commit — so a link crossing more days than that is NOT reported. Removing the bound needs providers to emit real `causedByEventIds` first. See `docs/vote-consequence-tracking.md` §5.2 |
| FR-J003 | Authenticated follows & progress (follow characters/arcs, save progress, personalised return recap) | P2 delivered | ART-71 (Done) | `convex/viewer/authenticatedProgress.test.ts`, `convex/viewer/viewerProgressFunctions.test.ts`, `docs/authenticated-viewer-progress.md`. Delivered ahead of MVP scope, on the substrate ART-39 left for it: `VIEWER_KEY_NAMESPACES` has carried an unreachable `auth` namespace since then, and ART-104 configured the identity provider. `getViewerProgress`/`recordViewerProgress` now prefer a VERIFIED identity over the presented token — folded rather than duplicated, because two endpoints would let a signed-in client reach the anonymous row by calling the wrong one — and one new mutation delivers FR-H004 AC#7's second clause. `viewerWriteBoundary.maxViewerMutations` moved 2 → 3, declared in four places that must agree. What is NOT proven here is Convex's JWT verification: no live Clerk credential exists in this repository, and that code is Convex's rather than this repository's |

---

## 13. Epic K — Admin & operations (FR-K001 .. FR-K006)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-K001 | Simulation operations console (pause/resume/manual slot advance/rerun failed/cancel uncommitted scene/inspect world/create snapshot/inspect schedule+queue) | P0 delivered | ART-48 (Done) | `convex/operations/opsConsole.test.ts`, `opsConsoleControls.test.ts`; audit §3.1 (all 17 privileged routes gated by `requireOperator`) |
| FR-K002 | Proposed-event review (proposed event, validation result, rejection reason, model trace, participants, state changes, related arc, safety label) | P0 delivered | ART-49 (Done) | `convex/operations/proposalReview.test.ts`, `proposalReviewStore.test.ts` |
| FR-K003 | Audited Canon correction (Correction / Compensation / Retcon events; no deletion; operator+reason recorded; replay-consistent; public content re-published; major retcon audited) | P0 delivered | ART-50 (Done) | `convex/operations/canonCorrection.test.ts` |
| FR-K004 | Independent editorial publication lifecycle (Generated/Validated/Safety Review/Ready/Published/Withheld/Superseded; Canon event & public-content status separated; unsafe episode withholdable without deleting Canon; regenerable summaries) | P0 delivered | ART-51 (Done) | `convex/editorial/publicationLifecycle.test.ts` |
| FR-K005 | Audited model/prompt/retry/budget configuration per module | P0 delivered | ART-52 (In Progress) | Configuration is delivered here; its ENFORCEMENT is owned by FR-M003. `convex/shared/moduleModelConfig.test.ts`, `convex/operations/moduleModelConfigFunctions.test.ts`, `convex/simulation/moduleConfigSelection.test.ts`; `docs/model-configuration.md`. All eight settings are per-module, versioned, `admin`-gated and audited, and the scene-simulation call path provably reads them (the selection test asserts on what `structuredChat` receives). **Scope boundary, stated rather than implied:** `fallbackModel` and `dailyTokenBudget` are stored and readable configuration only — ART-59 (FR-M003) owns budget/retry-limit ENFORCEMENT and ART-91 owns the degradation ordering, and both depend on this task |
| FR-K006 | World emergency stop / kill switch (halt new sim work; preserve public content; preserve in-flight run state; no accepted-event loss; operator resume or rollback) | P0 delivered | ART-53, ART-102 (Done) | `convex/operations/emergencyStopControls.test.ts`, `convex/simulation/emergencyStop.test.ts`; H-5 resolution (ART-102 extends the stop to the upstream engine + `restartDeadWorlds` cron) |

---

## 14. Epic L — Content safety (FR-L001 .. FR-L003)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-L001 | Pre-generation safety limits (CSAM/sexual/hate/extreme-violence/self-harm/real-person-impersonation/PII/crime-instruction prohibited in world config and prompts) | P0 delivered | ART-54, ART-103 (Done) | `convex/safety/preGeneration.test.ts`; H-4 resolution (ART-103 wires `callWithPreGenerationSafety` into the live provider path, PR #139) |
| FR-L002 | Post-generation safety classification per scene & public content (Allow / Allow+Warning / Withhold / Human Review; high-risk never auto-published; safety failure never alters Canon; public summary trimming preserves core facts; queryable block reasons) | P0 delivered | ART-55 (Done) | `convex/safety/postGeneration.test.ts` |
| FR-L003 | Untrusted viewer-input protection (prompt injection, real-person naming, PII, inappropriate violence/sexual content, system-command manipulation, direct result control) | P0 delivered | ART-56, ART-45 (Done) | `convex/safety/viewerInput.test.ts`. Audit M-1's "latent" note is CLOSED: ART-45 gave the classifier two production callers — the ballot slate is classified before a round opens, and every submitted candidate id is classified before it is compared (`environmentVote.test.ts` → *an injection payload in the candidate id is refused by the FR-L003 classifier*). `viewerWriteBoundary.requiredSymbols` fails the build if the viewer write module stops naming it |

---

## 15. Epic M — Observability & quality (FR-M001 .. FR-M004)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| FR-M001 | LLM trace per call (world/day/run/scene/arc/character IDs, model, prompt version, input/output tokens, latency, retry count, validation result, final status; no full prompt or secret in public surface) | P0 delivered | ART-57, ART-62 (Done) | `convex/observability/llmTrace.test.ts`; audit §4 I-1 (secret-safe pipeline verified); H-3 fix removed parallel raw-prompt `console.log` path |
| FR-M002 | World quality metrics (continuity, character consistency, event novelty, dialogue repetition, arc progress, arc stagnation, recap coverage, spoiler violation, canon rejection rate, safety withhold rate) | P1 delivered | ART-58, ART-88, ART-89, ART-90, ART-166 (Done) | **ART-58 delivers** the shared evaluator contract (`convex/quality/evaluator.ts`) and the Continuity evaluator v1 (`convex/quality/continuity.ts`): the Continuity Score plus all five §16.2 Canon targets, each carrying its own numerator, denominator, target and direction, with a zero denominator reporting `no_observations` rather than a perfect score. Read through the operator-gated `getContinuityQualityMetrics` (`convex/operations/worldQualityFunctions.ts`, capability `world.inspect`) and computed by the same functions inside `LongRunFindings.continuity`. `convex/quality` is in `canonWriteBoundary.forbiddenModules`, so measuring the world cannot write to it. **ART-88 delivers** the Narrative evaluator v1 (`convex/quality/narrative.ts`) on the same contract, with its similarity module (`convex/quality/textSimilarity.ts`): §16.2's 重複場景比例 counting exact **or** near duplicates (Jaccard ≥ 0.8 over identifier-masked character 3-grams) over **accepted** scenes — withheld scenes excluded and published as excluded — plus the exact and template-reuse splits, `dialogue_repetition_ratio`, `voice_distinctiveness`, `persona_deviation_rate` and `event_novelty_ratio`, and a `character_consistency` composite weighting voice and persona 0.5 each. Read through `getNarrativeQualityMetrics` (same file, same `world.inspect` gate) and computed by the same function inside `LongRunFindings.narrative`. `docs/world-quality-metrics.md`. **ART-89 delivers** the Story-quality evaluator v1 (`convex/quality/storyQuality.ts`) on the same contract: §16.2's 高重要度摘要覆蓋率 (`recap_coverage`), `spoiler_violation_rate` read from the persisted FR-G004 verdicts rather than from recap text, and `arc_progress_rate`, `arc_stagnation_rate` and `arc_resolution_evidence`, composed into a `story_health` score weighting coverage 0.4, spoiler safety 0.3, arc progress 0.2 and pacing 0.1. **The coverage denominator is read from Canon and never from the episodes**, because `buildDailyEpisode` throws `EPISODE_IMPORTANT_EVENT_MISSING` rather than store an Episode that omits a high-importance event — a ratio over stored episodes reads 100% by construction and could not fail. ART-89 also closes §16.2's exclusion clause, which had a type and a check since ART-35 and no storage and no writer: `coverageExclusions` plus the `safety.override`-gated `declareRecapExclusion` mutation are that storage and that writer, append-only and one row per event. Read through `getStoryQualityMetrics` (same file, same `world.inspect` gate) and computed by the same function inside `LongRunFindings.storyQuality`. **ART-90 delivers** the Operational-quality evaluator v1 (`convex/quality/operationalQuality.ts`) on the same contract, without changing a line of `evaluator.ts`: the **Canon Rejection Rate** (rejected / judged proposals, keyed by `(idempotencyKey, stage)`), the **Safety Withhold Rate** (withheld-or-review scenes / classified scenes), §16.2's **JSON 結構成功率** and a `scene_classification_coverage` companion, composed into an `operational_health` score weighting structured output 0.5, canon acceptance 0.3 and classification coverage 0.2. Every rate carries **reason dimensions**: stable codes and their counts — Canon error codes, classifier categories, schema codes, provider failure codes, models — and never a message, a path or a payload, which is how FR-M002's "without exposing secrets" clause is satisfied by construction rather than by redaction. **None of the three was answerable before ART-90, because the evidence did not exist.** `commitProposedEvent` throws and writes nothing, so rejections were never persisted per proposal; `worldDayRuns` is patched per attempt, `scheduledSlots.errorCode` is cleared on retry, and `worldDayCheckpoints` holds one code for a stage that may have judged a dozen proposals, because both stages throw on the first failure — a rate over them would have a slot-shaped denominator and a first-failure-shaped numerator. Structured-output failures were worse: a scene that exhausted its attempts threw and wrote **no row at all**, so a rate over `sceneSimulationRuns` read 100% by construction. And `recordTrace` (`convex/observability/traces.ts`) was a registered `internalMutation` with **zero production callers**, so `llmTraces` — its normaliser, its redaction and its public projection all built and tested — was empty in every world, `validationResult` and `finalStatus` were structurally absent, and two consumers (`dynamicViewMetricsFunctions`'s trace count, the FR-K002 proposal review's Model Trace) read an always-empty table. ART-90 adds `canonValidationOutcomes` plus `recordProposalValidations` and `recordAuthoringAttempt`, both `internalMutation`s and insert-if-absent on derived keys — a proposal by `(worldId, idempotencyKey, stage)`, an attempt by `${simulationRunId}:attempt:${n}`, a scene by `sceneId`, all derived from `(worldId, worldDay, timeSlot)` — so a slot run three times contributes one row per logical unit. Both validation stages now judge **every** proposal and record each verdict before throwing on the first rejection; the commit path is unchanged and only the verdicts survive. Read through `getOperationalQualityMetrics` (same file, same `world.inspect` gate) and computed by the same function inside `LongRunFindings.operationalQuality` / `operationalBreakdown`. `docs/world-quality-metrics.md` §6, `docs/llm-tracing.md`. **Epic M is now closed:** FR-M004 degradation (ART-91) delivered the last open clause, and it consumes exactly the signals named here — the provider failure codes ART-90 made stable are what `DEGRADATION_TRIGGER_CODES` selects on **ART-166 corrects three things this row asserted and the code did not do.** `getStoryQualityMetrics` never passed `pendingWorldDays`, so the console charged the world's newest accepted day — the one day that by construction has no Episode yet — as uncovered and reported a lower 高重要度摘要覆蓋率 than the ninety-day gate did off the same rule; `recordAuthoringAttempt` accepted an `errorCode` and had no column to write it to, so both published reason dimensions carried one substituted constant each rather than the code the attempt failed with; and the same writer booked literal zeros for tokens and latency it never observed, which the FR-K002 Model Trace panel rendered as a measurement. `llmTraces` gains an optional `errorCode` normalised as an upper-case CODE, its three accounting fields become optional and are omitted, and the row now goes through `normalizeLlmTraceDraft` — which this row's own sentence about the whitelist normaliser had described since ART-90 while the one writer the deployment runs bypassed it. `EXCLUSION_WITHOUT_REASON` is also withdrawn from the Story-quality finding codes: `buildCoverageExclusion` refuses any reason below `MIN_EXCLUSION_REASON_LENGTH`, so no stored row could produce it, and the fail-closed behaviour it accompanied is kept under `HIGH_IMPORTANCE_EVENT_UNCOVERED` |
| FR-M003 | Token & rate-limit controls (daily/module/model caps, max concurrency, retry budget, over-budget degradation) | P1 delivered | ART-59 (In Progress) | Delivered as enforcement over the FR-K005 configuration. `convex/shared/tokenBudget.test.ts`, `convex/operations/tokenBudgetEnforcement.test.ts`, `convex/operations/longRunHarness.test.ts`; `docs/token-budget-controls.md`. All five limits are enforced on the live scene path — one reservation per provider ATTEMPT, so the retry budget is a limit rather than a description — and every decision is audited to `tokenBudgetLedger` with the counter snapshot it was measured against. The over-budget strategy is selected by a pure, clock-free function and its fallbacks are recorded rather than silent. The per-module cap is DELEGATED to ART-52's `dailyTokenBudget`, never copied. **Two limitations, recorded rather than implied:** (1) `maxConcurrentCalls` is enforced and unit-tested but cannot bind on the live path today, because `authorSlotScenes` walks a slot's scenes sequentially — ART-159 moved the live provider call into an action, so reserve/settle are now genuinely separate transactions and `inFlight` counts something real, but one author is still in flight at a time; (2) the reservation excludes prompt tokens (no tokenizer in the Convex runtime), so a limit can be crossed by up to one prompt before it binds — settlement is exact. Metering integrity is defended by construction and at run time, because a meter keyed on the wrong model is the one failure here whose symptom is silence: ART-159 fused the author and the metered model id into one value (`sceneAuthorFor`) so they cannot be repointed separately, and `BudgetSettlement.resolvedModel` compares what the gateway said served the call against the metered key at settlement, counting divergences into `ResourceUsageReport.modelMeteringMismatches`. The ordered degradation ladder is ART-91, **now delivered** (FR-M004 below): this task's over-budget hop stays a single decision about one call, while the ladder is a persisted decision about the world, and `SCENE_BUDGET_REFUSED` / `SCENE_BUDGET_DEFERRED` are among the codes that escalate it |
| FR-M004 | Degradation mode (retry → compatible model → fewer scenes → rule-based background events → defer non-essential recaps → pause; Canon Validation / Safety / Idempotency / Persistence never skipped) | P1 delivered | ART-91 (Done) | `convex/simulation/degradation.test.ts`, `convex/simulation/rulesOnlyAuthor.test.ts`, `convex/operations/deferredSummaries.test.ts`, `convex/operations/degradationIntegration.test.ts`; `docs/model-outage-degradation.md`. **The six rungs are one ordered list in one pure module** (`convex/simulation/degradation.ts`): `nextLevel` is total on it, so `advanceDegradation` moves at most one rung per decision and no caller can request a jump — AC#1 is a property of the function rather than a convention its callers keep. `FAILURES_BEFORE_ESCALATION` is 2, so one bad minute cannot degrade a world, and **only provider-side codes escalate** (`DEGRADATION_TRIGGER_CODES`): a Canon rejection, a safety refusal or an unrecognised code moves neither the level nor the counter, because no rung makes a refused request acceptable. Recovery is one rung per authored slot; `paused` recovers only by operator action, and `resumeFromPause` returns to `rules_only` rather than to `normal`. **The four never-skipped invariants hold because the ladder does not run them**: it returns a LEVEL, and every level's events still travel `validate_structured_output` → `validate_canon` → `commit_accepted_events`. Rung 4 is the rung most likely to be built as a bypass and is not one — `deriveRulesOnlyEvents` emits **Proposed** Events with derived idempotency keys that pass `validateEventStructure` and commit through `commitProposedEvent`, and each asserts only that a slot passed at an occupied place (one public `fact_created`, no relationship, memory, knowledge or rumor, because every one of those would be an interpretation). It is explicitly **not** the deterministic fake narrator: an outage must never put invented narration into Canon, and `sceneAuthorFor` has no default, so the fake cannot be reached by failure. Rung 5 defers `scene`, `arc`, `season` and `viewer_context` and **never `episode`** — an unpublished day is exactly the coverage failure §16.2 measures, so degradation must not manufacture the gap the metrics exist to detect; skipping a tier leaves its cursor untouched, so the next healthy run covers the same range and the cursor **is** the backfill, which is why no backfill queue exists. Rung 6 refuses admission **before** the slot is claimed, so no lease is burned, and it is a third stop separate from `world.pause` (stops the clock reserving slots) and the FR-K006 kill switch (halts the executor); all three can be true at once and each is released by its own action. AC#2 traceability is `worldDegradationTransitions`, append-only with an id derived from `(worldId, worldDay, timeSlot, kind)`, so a **retried slot cannot walk the ladder**; the operator surface is `getDegradationStatus` (`world.inspect`) and `resumeDegradation` (`world.resume`). AC#3/#4/#5 are proven against ART-60's real fixture: a total provider outage leaves the public last-known-good payload and version byte-identical, the ladder descends on the outcomes the real pipeline produced, rules-only events commit through the real validation and dedupe on retry, and recovery climbs one rung per authored slot. **One defect fixed on the way:** `describeWorldDayError` collapsed every error without a Canon-shaped `.error` into `WORLD_DAY_STAGE_FAILED`, so a provider outage, a timeout, an exhausted route chain and a budget refusal all reached `scheduledSlots.errorCode` as one generic string and an operator could not tell them apart; it now preserves any error's own stable `code`, which is the distinction the ladder is built on. **Two limits recorded rather than implied:** rung 2 substitutes the plan's requested model, which reaches the FR-M003 reservation but not the provider call's `model` override (`docs/model-outage-degradation.md` §11), and the ladder is fed only from the live action path, so a fake-provider run never moves it |

---

## 16. §9–10 core-concept & world-operation constraints (normative subset)

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| §9.3–9.6 | Canon Fact ≠ Character Knowledge ≠ Memory ≠ World Event (distinct entities, separated in schema & projection) | P0 delivered | ART-13, ART-24, ART-25 (Done) | Schema entities §13.5–13.8; `knowledgeLedger.test.ts`, `subjectiveMemory.test.ts` enforce separation |
| §9.10 | Viewer Secret subject to spoiler-level control | P0 delivered | ART-35, ART-70 (Done) | `coverageValidation.test.ts` (spoiler violation detection), `spoilerMode.test.ts` |
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
| NFR-001 | Availability: public content 99.5%; sim-engine outage does not make history unreadable; publish/sim failure isolation | P0 delivered | ART-40, ART-74 (Done) | The structural half is delivered and gated offline; the live availability SLO is an operational measurement against a running deployment, not a code gap — see Notes & uncertainties. `readModel.test.ts`, `failureIntegration.test.ts` prove failure isolation. The 99.5% uptime figure is a live SLO measurable only post-deploy and is not a pre-launch code gate |
| NFR-002 | Performance: homepage LCP <2.5s; read P95 <500ms; live update latency <5s; relationship graph ≤30 default nodes; public pages never wait on real-time LLM | P0 delivered | ART-40, ART-41 (Done) | The structural half is delivered and gated offline; the live LCP/P95 figures are operational measurements against a running deployment — see Notes & uncertainties. Public reads served from pre-computed projections (`readModel.ts`, no provider import — audit I-3). `<=30` graph default now ENFORCED server-side before publication (`RELATIONSHIP_GRAPH_MAX_NODES`, ART-44), re-checked by `assertRelationshipGraphBounds` on every payload, with the omitted counts published rather than truncating silently. Live LCP/P95 measurable only post-deploy |
| NFR-003 | Determinism: identical snapshot+events → identical projection; reducer has full automated tests; event commit is idempotent | P0 delivered | ART-16, ART-17, ART-12 (Done) | `reducer.test.ts`, `reducer.purity.test.ts`, `replay.test.ts`, `proposedEvent.test.ts` |
| NFR-004 | Model replaceability: unified adapter; no vendor-specific format in business layer; versioned prompts+config; runtime-validated structured output | P0 delivered | ART-72, ART-14 (Done) | `convex/simulation/providers/openAICompatible.test.ts`, `fakeProvider.test.ts`, `validators.test.ts` |
| NFR-005 | Security: admin authn/authz; public API never returns private knowledge or prompt; viewer input untrusted; secrets kept out of logs/traces; server-side authz audit before public deploy | P0 delivered | ART-62, ART-104 (Done) | `docs/security-audit-art-62.md` (full audit); H-1 resolution (ART-104 identity provider). `operatorAuthorization.test.ts`, `llmTrace.test.ts` |
| NFR-006 | Maintainability module boundaries: Canon, Simulation, Character Knowledge, Story, Editorial/Recap, Public Read Model, Viewer, Operations, Safety, Observability | P0 delivered | ART-3 (Done) | `test:architecture` enforces policy v1 over **11 modules**; gate green |
| NFR-007 | Testability: domain logic testable with no LLM/no network; deterministic fake provider; fixed world fixture; 7/30/90-day sim tests | P0 delivered | ART-4, ART-60 (Done); ART-73 (To Do) | The 90-day half was P1-deferred until ART-73 delivered it: `npm run test:ninetyday` runs 90 world days on a fixed seed as additional resilience evidence WITHOUT replacing the 7/30-day P0 gate. `fakeProvider.test.ts`, `mistwoodFixture.test.ts`, `longRunHarness.test.ts` (7/30-day). 90-day is P1 (ART-73); 30-day coverage already exceeds the MVP public-test gate |
| NFR-008 | Data integrity: every significant change traceable to an event; public content traceable to accepted events; corrections never delete audit history; partial failure produces no incomplete Canon | P0 delivered | ART-13, ART-14, ART-15, ART-50 (Done) | `commit.test.ts`, `validators.test.ts`, `continuity.test.ts`, `canonCorrection.test.ts` |
| NFR-009 | Accessibility: keyboard nav, reasonable contrast, reduced motion, non-map alternative views, image alt text, mobile touch sizes | P0 delivered | ART-93 (Done); ART-94 (To Do, P1 graph/timeline a11y) | `convex/publicRead/newcomerAcceptance.test.ts` exercises the public surface; ART-93 public-experience a11y compliance Done. P1 scoped graph/timeline a11y (ART-94) deferred with its P1 features |

---

## 19. §15 product analytics events & §16 success metrics

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| §15 (instrumentation) | 16 product analytics events (`home_viewed` … `share_action`) | P0 delivered | ART-47 (Done) | All sixteen declared in `convex/shared/analyticsContract.ts` and emitted from the real public surfaces. `share_action` required adding a share affordance — a copy-link button on the Episode page — because the event had no trigger before it. `docs/product-analytics.md` §1 |
| §15 (privacy constraint) | Analytics events must never contain model secret, private character data, full prompt, or sensitive user data | P0 delivered | ART-57, ART-40, ART-47 (Done) | Public trace is a 5-field Pick (audit I-1); public read path filters by `visibility` (audit M-2). ART-47 adds the third enforcement: ONE allowlist in `shared`, applied at the browser emitter, at Convex's argument validator and again at the ingest, plus `analyticsWriteBoundary.forbiddenPayloadKeys` failing the BUILD if the telemetry module names a forbidden field. `analyticsPrivacy.test.ts` attacks it with every forbidden field at once |
| §16.1 | Product success metrics (first-visit episode open ≥40%, 3-min retention ≥30%, D1 ≥15%, D7 ≥8%, vote participation ≥10%, follow ≥8%, primer expand ≥20%, recommended-entry click ≥20%) | Not launch-gated | ART-47 (Done) | All eight computed in `convex/analytics/metrics.ts` and read through an operator-gated query; `metrics.test.ts` settles every definition from fixtures, which is what AC#5 asks for. A zero denominator reports `no_observations`, never `0%`. One caveat is recorded rather than hidden: `durationMs` is time-to-last-interaction, so 停留超過三分鐘 is a floor rather than the PRD's exact quantity (`docs/product-analytics.md` §6) |
| §16.2 | World quality metrics (0 severe canon conflicts, 100% replay consistency, JSON success ≥98%, high-importance recap coverage ≥95%, 30-day completion 100%, repeat-scene <15%, active main arcs 1–3, 0 sourceless secret leaks, 0 unreasonable dead appearances, 0 character position conflicts) | P0 delivered | ART-15, ART-17, ART-35, ART-30, ART-60, ART-58, ART-88, ART-89, ART-90, ART-166 (Done) | Now measured as a metric rather than only asserted as an invariant. `continuity.test.ts`, `replay.test.ts`, `validators.test.ts`, `coverageValidation.test.ts`, `portfolio.test.ts`, `longRunHarness.test.ts` assert the zero-target and 100% invariants. **ART-58 adds the measurement:** the Continuity evaluator reports 嚴重 Canon 衝突, Event Replay 一致率, 無來源秘密洩漏, 死者不合理出場 and 角色位置衝突 as rates with published denominators, over both the fixed seed and any live world. **The replay evidence is no longer tautological.** `findings.replay.equal` compared two full replays of the same accepted log until ART-58; one side is now the projection the run carried, folded incrementally per slot, and the continuity evaluator adds a third, independent check — each day's fold must reproduce the daily snapshot the system actually persisted (7 of 7 days on the fixed seed). **重複場景比例 <15% is now MET: 0 of 449 accepted scenes over the 30-day seed, and 0 of 104 over the 7-day seed.** This row previously said the target was "not met by the fixed-seed fake author (61.9% at 30 days)" and was owned by ART-88; **that claim is superseded.** It was a true reading of the old fixture, whose author drew a scene's sentence from 24 combinations and gave every character one dialogue literal — a space too small to satisfy the target at any run length. ART-88 replaced the author and measures the ratio with `convex/quality/narrative.ts` under a *stricter* definition than the 61.9% figure used: exact **or** near-duplicate (Jaccard ≥ 0.8 over identifier-masked 3-grams), over accepted scenes, against a denominator pinned as an absolute count so the ratio cannot be improved by authoring fewer scenes. **高重要度摘要覆蓋率 ≥95% is now MEASURED and MET: 81 of 81 (100%) over the fixed 7-day seed's due days, with the newest day's 15 events excluded as not-yet-due.** It was measured by nothing before ART-89, and the first honest measurement read **85.4%** — 14 of 96 high-importance Accepted Events permanently uncovered. The cause was a completion rule, not a composer: a world day counted as complete the moment ONE accepted event carried the final time slot, and because the post-commit pipeline runs once per accepted event, the first event of a day's final slot triggered that day's Episode and Episodes are idempotent per day, so the rest of the slot reached no Episode, recap or publication for every day of every world. Nothing failed, because the FR-G004 gate obliges an Episode to cite the events of its own day *as the Episode saw them*. A day is now complete only once the world has moved past it (`completedWorldDaysOf`), and the daily snapshot keeps the old condition under its own name (`latestWorldDayFinalSlotStarted`) because a snapshot may only be taken while its day is still the latest. Spoiler violations are 0 over 6 published days on the same seed. **JSON 結構成功率 ≥ 98% is now MEASURED, and MET at 104 of 104 (100%) over the fixed 7-day seed — with an honest caveat that is part of the claim.** Nothing measured it before ART-90: a scene that exhausted its authoring attempts threw and wrote no row anywhere, so a rate over `sceneSimulationRuns` had successes and nothing to divide by and read 100% by construction. ART-90's `recordAuthoringAttempt` writes one `llmTraces` row per authoring attempt, and `convex/quality/operationalQuality.ts` computes the rate over attempts that **received a response to validate** — an attempt that timed out, was refused a credential, exhausted its route chain or was refused by the budget never got an answer, so counting it would report a network outage as a model that cannot follow a schema. Those attempts are excluded, counted and published with their reason. **The caveat:** the fixed-seed 100% is 1.0 **by construction**, because the deterministic author cannot return an invalid output; that reading evidences the wiring, not a model. That the metric can FALL is proven on fixtures (`convex/quality/operationalQuality.test.ts`) and against the live recording path (`convex/simulation/authoringAttemptEvidence.test.ts`). That **this deployment's gateway** holds the contract is measured by the env-gated `npm run test:live-structure` (`ART90_LIVE_STRUCTURE=1`, `convex/simulation/providers/liveStructuredOutputEvidence.test.ts`), which makes 8 real structured calls against a deliberately non-trivial schema, scores them with the same evaluator, prints the denominator and the exclusions, and FAILS if the measured rate misses 98%. Without the flag it is `describe.skip`, and a skipped run is not evidence. Canon Rejection Rate is 0 of 208 judged proposals and Safety Withhold Rate 0 of 104 classified scenes on the same seed, with operational health 1.0. **ART-166 note:** the 81 of 81 reading above was always the long-run harness's, because it was the only caller passing `pendingWorldDays`; the operator query omitted it and therefore reported a lower rate on the same world. The two surfaces now derive the not-yet-due day from the same rule, and the JSON 結構成功率 breakdown now carries the code each attempt actually failed with rather than one constant per dimension |
| §16.3 | Resource metrics (retry tokens <10%, low-importance work >80% on fast model, public traffic adds no LLM call, public content available during model outage, daily token predictable+limitable) | P0 delivered | ART-40, ART-57 (Done), ART-59 (In Progress) | Structure and measurement are both delivered; one clause is honestly unmeasurable offline and is recorded as such. `summarizeResourceUsage` reports all five, and `LongRunFindings.resources` carries them for the fixed-seed 7-day run, produced by the accountant that ENFORCED that run. **Retry tokens <10%:** measured over a non-empty denominator, and enforceable by construction when `maxRetryTokenShare` is configured; not enforced by default because a share ceiling refuses the first retry of every world day (total spend is 0), which would break ART-74 AC#1. A run with a positive numerator is measured under an injected transient provider failure in `tokenBudgetEnforcement.test.ts`. **Low-importance work >80% on the fast model: NOT evidenced by traffic in this deployment.** `routeModelForWork` makes the share 1.0 by construction whenever the sample is non-empty, but no low-importance LLM work exists here — the only LLM call path is whole-scene simulation and the Director plans only MAJOR scenes — so the denominator is empty and the report returns `null` with a stated reason rather than a fabricated 0 or 1. The mechanism is proven over a non-empty synthetic sample, including that the assertion fails at 70% and at exactly 80%. **Public traffic adds no LLM call:** proven by audit I-3, and now additionally by a closed `BUDGET_ORIGINS` enumeration plus a source scan asserting no `convex/publicRead` or `convex/viewer` file names the enforcement surface. **Daily token predictable+limitable:** enforced and reported per world day; compliance is `null` with a reason when no cap is configured |

---

## 20. §19 test strategy

| Clause ID | Summary | Classification | Owning task (status) | Objective verification |
|---|---|---|---|---|
| §19.1 | Unit tests cover structural validation, Canon validation, reducer, replay, idempotency, arc state transition, knowledge permission, memory retrieval, recap event selection, voting rules, safety rules | P0 delivered | All P0 owners, ART-45 (Done) | `validators.test.ts`, `continuity.test.ts`, `reducer.test.ts`, `replay.test.ts`, `proposedEvent.test.ts`, `lifecycle.test.ts`, `knowledgeLedger.test.ts`, `memoryRetrieval.test.ts`, `coverageValidation.test.ts`, `preGeneration/postGeneration/viewerInput.test.ts`, `viewer/environmentVote.test.ts` |
| §19.2 | Integration tests (10 scenarios: secret transfer, rumor spread, dead-character exclusion, unique item ownership across transfers, safe vote injection, provider retry, no-retry double-submit, episode accepted-only, correction→read-model update, sim-failure public readability) | P0 delivered | ART-61, ART-74, ART-76 (Done) | `canonCognitionIntegration.test.ts` (cases 1, 3, 4), `failureIntegration.test.ts` (cases 6–10), `itemOwnership.test.ts`, `episode.test.ts`, `canonCorrection.test.ts`. **All ten scenarios now have an integration suite.** ART-76 closed the last two: `knowledge/rumorPropagationIntegration.test.ts` drives one rumor through four people and asks provenance, version divergence, belief divergence and containment of the SAME accepted log (case 2), and `viewer/voteInjectionIntegration.test.ts` drives ballot → FR-L003 classifier → tally → close → elect → propose → structural → Canon → replay (case 5). The classifier leg had no executable coverage before: it lives in Convex handlers whose bodies never run under jest |
| §19.3 | Long-term sim (7/30/90-day, fixed seed; checks canon conflict, arc bloat, character staleness, dialogue/scene repetition, recap gaps, token anomaly, safety withhold, arc stagnation, replay consistency) | P0 delivered | ART-60 (Done); ART-73 (To Do) | The 90-day half was P1-deferred until ART-73 delivered it, in addition to the 7/30-day P0 gate rather than in place of it. `longRunHarness.test.ts` |
| §19.4 | Newcomer comprehension test (30s: what's happening / why it matters; 3min: 3 core characters / current core question / where to start) | P0 delivered | ART-75 (Done) | `convex/publicRead/newcomerAcceptance.test.ts` |
| §19.5 | Manual narrative content evaluation program (character consistency, action-knowledge alignment, causality, arc progress, arc stalling, dialogue repetition, misleading summary, inappropriate-content interception) | P0 delivered | ART-92 (Done) | `convex/operations/narrativeReviewSample.test.ts` provides the sampling harness; manual evaluation is an operational program, not a code gate |

---

## 21. §20 public-test acceptance criteria (AC#1 .. AC#25)

| AC | Summary | Status | Objective verification |
|---|---|---|---|
| AC#1 | Continuous 30-world-day simulation | Pass | `longRunHarness.test.ts`; offline gate `test:longrun` (ART-60) |
| AC#2 | Replay consistency 100% | Pass | `replay.test.ts` + 30-day long-run. The long-run half was a tautology until ART-58 — `findings.replay.equal` compared a full replay with a second full replay of the same log — and is not one now: one side is the incrementally folded projection the run carried, and the continuity evaluator independently requires each day's fold to reproduce the daily snapshot stage 20 persisted |
| AC#3 | No character position conflict | Pass | `continuity.test.ts` (FR-D004 rule) |
| AC#4 | No unreasonable dead-character appearance | Pass | `continuity.test.ts` |
| AC#5 | No sourceless secret leak | Pass | `knowledgeLedger.test.ts`, `continuity.test.ts` |
| AC#6 | Duplicate event not resubmitted | Pass | `proposedEvent.test.ts` (idempotency key), `scheduler.test.ts` |
| AC#7 | All high-importance events covered by recap | Pass | `coverageValidation.test.ts` (ART-35, PR #115); **now measured rather than only gated** — `storyQuality.test.ts` and `longRunHarness.test.ts` (ART-89) report `recap_coverage` at 81 of 81 (100%) over the fixed 7-day seed's due days, against §16.2's 95% floor, with the newest day's 15 events excluded as not-yet-due. The gate alone could not evidence this clause: it obliges an Episode to cite the events of its own day as the Episode saw them, so an Episode built from a partial day passed it. The first independent measurement read 85.4% (14 of 96 uncovered) and traced to the world-day completion rule, corrected in ART-89 — see §5.1 G8 |
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
| RISK-002 | Boring world content → mitigations: tension readiness, warmup, Director pressure, repetition monitoring, heat score, long-absent character detection, environment injection | P0 delivered | ART-7/8/19, ART-45, ART-88, ART-32 (Done) | **The mitigation list is now complete.** `tensionReadiness.test.ts`, `warmup.test.ts`, `director.test.ts`; viewer environment injection lands via `environmentVoteInjection.test.ts` and end to end via `voteInjectionIntegration.test.ts` (ART-76). Repetition monitoring is ART-88: `narrative.test.ts` and `textSimilarity.test.ts` for the measure, `longRunHarness.test.ts` for the fixed-seed ratio. The heat score was the last item and is delivered by ART-32 (`heat.test.ts`, `docs/arc-heat-score.md`) — which also closed the reason it mattered to this risk: a score that could not decay let a stale arc hold the homepage indefinitely |
| RISK-003 | Infinite arc growth → mitigations: active-arc cap, lifecycle, auto-resolution, merge/archive, old-history compression | P0 delivered | ART-30/64/31/27 (Done) | `portfolio.test.ts`, `lifecycle.test.ts`, `resolution.test.ts`, `memoryCompression.lossless.test.ts`. Compression bounds the *working corpus*, not storage: Canon stays append-only by design, and the fixed-point property means a scheduled pass cannot keep folding the same history |
| RISK-004 | Newcomer cannot understand → mitigations: current situation, 3 backstories, ≤4 core characters, recommended entry, 3-min primer, homepage not showing full world | P0 delivered | ART-37/67/38/41 (Done) | `onboardingSummary.test.ts`, `entryRecommendation.test.ts`, `arcPrimer.test.ts`, `newcomerAcceptance.test.ts` |
| RISK-005 | Model quota high but rate-limit insufficient → mitigations: queue, concurrency control, scene merge, model routing, degradation, rule-based background events | P0 delivered | ART-21 (Done), ART-59 (In Progress), ART-91 (Done) | `sceneGrouping.test.ts` (scene merge reduces call count). Budget and rate control (FR-M003/ART-59) now refuse work that would exceed a configured cap, before any provider is called. Concurrency control is enforced but does not bind on the live path today (sequential per-slot execution). **Ordered degradation and rule-based background events are no longer deferred:** FR-M004/ART-91 delivers both as the same ladder — `convex/simulation/degradation.ts` for the ordering, `convex/simulation/rulesOnlyAuthor.ts` for rung 4's deterministic events, proven against the real pipeline in `convex/operations/degradationIntegration.test.ts` and documented in `docs/model-outage-degradation.md`. `SCENE_BUDGET_REFUSED` and `SCENE_BUDGET_DEFERRED` escalate the ladder, so an insufficient rate limit now reduces what a world generates instead of stopping it, and the public keeps its last known good content throughout. Deterministic fake provider means no live LLM quota exposure during public-test evidence runs |
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

**None.** Every P0 clause (`§5.1` goals G1–G9, G12–G14; `§5.3` all tech/ops goals; UX-001..004, UX-006 + UX-005 principle; FR-A001..A004, FR-B001..B002, FR-C001..C005, FR-D001..D006, FR-E001..E003, FR-F001..F005, FR-G001..G003, FR-H001..H003, FR-I001..I006, FR-K001..K004, FR-K006, FR-L001..L003, FR-M001; the §12 pipeline & failure rules; §10.2 dev/test mode; NFR-003..006, NFR-008..009; §16.2 quality invariants; §19.1/19.2/19.4 + 7/30 of §19.3; RISK-001/003/004/006/007/008/009 and the P0 portions of RISK-002/005) is backed by one or more **Done** tasks. No incomplete task is referenced anywhere in this matrix. ART-32, ART-59, ART-71, ART-73, ART-76, ART-91 and ART-94 were on that list and have since been delivered. ART-28 (FR-E005), ART-36 (FR-G005), ART-39 (FR-H004, §5.1 G10), ART-44 (FR-I007, NFR-002 graph clause), ART-46 (FR-J002), ART-47 (§15, §16.1), ART-52 (FR-M003 configuration clause), ART-58 (FR-M002 continuity half, §16.2 measurement), ART-88 (FR-M002 narrative half, §16.2 重複場景比例 now met at 0 of 449), ART-89 (FR-M002 story/recap/spoiler half, §16.2 高重要度摘要覆蓋率 now met at 81 of 81) and ART-90 (FR-M002 operational half, §16.2 JSON 結構成功率 now measured) have since been delivered and are recorded above. The sub-clause that was recorded as open — **FR-H004 AC#7's second clause** (explicit, authorized, lossless merging) — is closed by ART-71 (FR-J003).

---

## Closure audit (non-goals) — §6

For each of the 17 MVP non-goals, the implemented scope is verified **absent**.

| §6 non-goal | Status | Basis |
|---|---|---|
| 3D world | Absent | Web-only Vite build; no 3D engine dependency (no three.js / babylon / react-three-fiber). Public surfaces are projection-based text/lists |
| High-quality real-time animation | Absent | FR-I002 AC#1 explicitly waives it; live view renders summaries & positions, no animation runtime |
| Real-time voice conversation | Absent | No WebRTC / voice / TTS code; character speech is produced offline via scene simulation, not live voice |
| Viewers freely chat with all characters | Absent | No free-chat surface. The only viewer input path is the daily vote (FR-J001 / ART-45), which submits a CATALOG ID rather than text and is restricted to pre-defined environment events. `viewerWriteBoundary` caps the deployment at one viewer-reachable mutation, so a second input path cannot be added without editing the policy on purpose |
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
| Auto-posting unreviewed content to external social | Absent | Still no external-social API client, no outbound webhook, and `publicFunctionSurface.forbiddenRegistrations` bans `httpAction` repo-wide. ART-36 (FR-G005) delivered the share formats WITHOUT adding a transport: `decideShareRelease` returns `blocked \| manual_release_required` and has no released variant, derived copy rides the FR-K004 lifecycle as `episode_share` whose `publish` is administrator-only, and `shareFormats.boundary.test.ts` sweeps the whole share pipeline plus its import closure for `fetch(`/`httpAction`/`ConvexHttpClient`/`ctx.scheduler`/`runAction`. ART-92 manual evaluation remains the only review path |

**Closure audit verdict (AC#28):** the implemented scope does not include any MVP non-goal. No non-goal is present accidentally.

---

## Notes & uncertainties

- **Live operational metrics (NFR-001 availability, NFR-002 LCP/P95/latency, §16.1 product success metrics):** these are SLOs measurable only against a real deployment. ART-47 has since delivered §16.1's INSTRUMENTATION — the events, the store and the computation, verified from fixtures — so what remains deferred for §16.1 is the traffic, not the ability to measure it. No production deployment exists (audit D-1 — no Vercel link, empty GitHub deployments API), so the figures are recorded as "structural enablers delivered; live SLO verification deferred to post-deploy". This is consistent with AC#23 (production not auto-enabled) and is not a code gap.
- **FR-L003 viewer-input classifier (audit M-1): CLOSED by ART-45.** The classifier had zero production callers while FR-J001 was deferred. It now has two — the ballot slate is classified before a round may open, and every submitted candidate id is classified before it is compared against the catalog — and `viewerWriteBoundary.requiredSymbols` fails the build if the viewer write module stops naming it.
- **FR-H005 spoiler control:** classified as P2 deferred because the PRD itself says "MVP 可不實作". ART-70 (Done) delivers only the data-compatibility constraint the PRD attaches to it ("資料模型不得阻止後續支援"). Functional spoiler UI remains P2.
- **Audit residual items not blocking AC#21:** the Medium/Low findings (M-2 sanitizer denylist-vs-allowlist wording, M-4 denied-attempt audit persistence, M-5 `package.json` SPDX compound expression, M-6 guard-hook deploy-pattern gap, M-7 stale Fly runbook, I-5 audit-leak heuristic, L-1 upstream trademarks in chrome) remain open as tracked follow-ups. None is Critical or High, so AC#21 ("no known Critical/High") is satisfied. They are recorded here for traceability; the recommended follow-up tasks are enumerated in `docs/security-audit-art-62.md` §8.
- **RISK-002 partial:** the P1-deferred heat score (ART-32) leaves part of that risk's mitigation list unimplemented. The novelty and repetition evaluators were on this list until ART-88 delivered them, and RISK-005 was on it until ART-91 delivered the degradation workflow and its rule-based background events — **RISK-005's mitigation list is now complete**, so the only qualifier left on it is that concurrency control does not bind on today's sequential live path. RISK-002 is classified `P0 delivered` because the P0 mitigations already bound the risk (tension readiness + Director pressure); the heat-score refinement is P1 and is tracked on its own row as FR-F006.
