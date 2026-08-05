---
id: ART-112
title: Retire the a16z AI Town server-side simulation engine
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-05 05:30'
labels:
  - prd-2.0
  - v2-c
  - epic-n
dependencies:
  - ART-142
priority: high
type: feature
ordinal: 112000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** PRD 2.0 §10.3, decision §24.20 (enables FR-N002, FR-O009, RISK2-002)

**Problem / Context:** The inherited a16z engine runs its own world lifecycle and agent reasoning, makes its own LLM calls, and is kept alive by crons and client heartbeats. Leaving it running would create a second narrative source competing with Canon (violating PRD 2.0 §10.5 "Canon is the sole authority") and would burn LLM budget independently of viewers.

**Documentation drift (review finding):** `README.md` currently describes `convex/aiTown/` as "upstream AI Town game logic (retained)" and `convex/engine/` as "upstream AI Town engine (retained)", and `src/` as "upstream PixiJS client (retained)". These statements will be false the moment this task lands — the server-side lifecycle inside `aiTown/`/`engine/` is retired, only specific renderer/asset modules from `src/` are retained. Prior task drafts left "documentation impact" as a vague one-liner; this revision names the exact files so the mismatch cannot silently persist past this task's merge.

**Goal:** Decommission the a16z server-side simulation lifecycle while preserving all client-side visual capability for reuse, and leave every reader-facing document consistent with the new split.

**Scope (retire):** `convex/aiTown/` world execution lifecycle, `convex/agent/` agent reasoning, `aiTown/main:runStep`, heartbeat-driven world start/resume, Human Player, `joinWorld`, `moveTo`, `sendWorldInput`, chat/interact inputs, the `restart dead worlds` and `stop inactive worlds` crons.

**Scope (preserve):** PixiJS renderer, PixiViewport, tilemap renderer, character sprite renderer, idle/walking/speaking/thinking animation, spritesheets, collision data, independently usable pathfinding utilities, map and environment assets.

**Scope (documentation, must be updated in this task, not deferred):**
- `README.md` — remove "(retained)" framing for `convex/aiTown/`, `convex/engine/`; state which specific modules under `src/` are retained (renderer/assets) versus what is retired (world lifecycle, agent reasoning, join/move/chat).
- Any architecture document under `docs/architecture/` that lists `aiTown`/`agent` as active simulation components.
- Startup/deployment documentation and any environment-variable examples that reference a16z engine configuration no longer in effect.
- The Convex function/cron list in documentation (`restart dead worlds`, `stop inactive worlds`) must be removed or marked retired.
- State explicitly in the updated docs: Canon Simulation is the sole narrative source; the Visual Runtime contains no agent, no LLM call, and cannot mutate Canon; public visitors never start or sustain the simulation.

**Out of Scope:** Building the replacement Visual Runtime (FR-N010); the read-only client shell (FR-N002).

**Dependencies:** FR-N001 audit (authoritative retirement list).

**Schema Impact:** a16z engine tables become inert; no Canon schema change. Data removal is not required by this task.

**API Impact:** Removal of public-reachable world mutation/action entry points.

**Security Impact:** Directly closes the RISK2-002 surface — no viewer-reachable path can start, resume or drive the simulation.

**Test Requirements:** Tests asserting the retired entry points are unreachable or rejected; assertion that no cron restarts a world; regression proof that Canon/simulation pipelines are unaffected.

**Validation Commands:**
- `npm run check`
- Confirm no `aiTown` step activity appears in deployment logs after retirement.
- Grep README.md and docs/architecture/ for "retained"/"aiTown"/"agent" references and confirm none describe retired capability as active.

**Documentation Impact:** `README.md`, architecture documentation under `docs/architecture/`, startup/deployment docs, environment variable examples, and the Convex function/cron list — all updated to describe the retained-visual / retired-engine split, not left as a vague follow-up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The a16z world execution lifecycle and agent reasoning no longer run
- [x] #2 aiTown/main:runStep is no longer scheduled or triggerable
- [x] #3 The restart-dead-worlds and stop-inactive-worlds crons are removed or disabled
- [x] #4 Human Player, joinWorld, moveTo, sendWorldInput and chat/interact entry points are unreachable from any public surface
- [x] #5 No LLM call originates from the retired engine
- [x] #6 All preserved visual modules listed in PRD 2.0 section 10.3 remain intact and importable
- [x] #7 The ART pipeline (Canon, simulation, story, publicRead) shows no regression
- [x] #8 Every client-side caller of a retired mutation is removed or neutralized in the same change, so typecheck, lint and build stay green
- [x] #9 The interactive game route and its player controls (Interact, Freeze, join/move/chat UI and the join-the-town help copy) are removed or gated off the public surface
- [x] #10 README.md no longer describes convex/aiTown/ or convex/engine/ as retained active components
- [x] #11 README.md and architecture documentation state which specific src/ modules are retained (renderer, assets) versus what is retired (world lifecycle, agent reasoning, join/move/chat)
- [x] #12 Startup/deployment docs and environment variable examples no longer reference retired a16z engine configuration
- [x] #13 Documentation states explicitly that Canon Simulation is the sole narrative source, the Visual Runtime has no agent/LLM/Canon-mutation path, and public visitors never start or sustain the simulation
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
Full file-by-file disposition (built empirically via grep-based importer tracing, not assumption -- see docs/upstream-visual-capability-audit.md corrections):

RETIRED (deleted): convex/aiTown/main.ts, game.ts, agentInputs.ts, agentOperations.ts, inputHandler.ts, inputs.ts, insertInput.ts, location.ts, movement.ts; convex/agent/conversation.ts, memory.ts, embeddingsCache.ts; convex/engine/abstractGame.ts, historicalObject.ts (+ its test); convex/world.ts, messages.ts, testing.ts (entire files -- every remaining export was only reachable from retiring callers); the restart-dead-worlds / stop-inactive-worlds crons; src/components/Game.tsx, PixiGame.tsx, Player.tsx, PlayerDetails.tsx, Messages.tsx, MessageInput.tsx, DebugPath.tsx, PositionIndicator.tsx, DebugTimeManager.tsx, FreezeButton.tsx, buttons/InteractButton.tsx; src/hooks/useWorldHeartbeat.ts, sendInput.ts, serverGame.ts, useHistoricalTime.ts, useHistoricalValue.ts; data/characters.ts.

REDUCED, not deleted: convex/aiTown/player.ts, agent.ts, conversation.ts -- schema.ts still needs their serialized* validators for historical-row compatibility (a16z tables become permanently inert, not removed; no Canon schema change, no data migration). Each now contains only the validator + a minimal inert class (constructor + serialize, no tick/join/leave/reasoning methods).

PRESERVED unchanged: aiTown/worldMap.ts, ids.ts, playerDescription.ts, agentDescription.ts, conversationMembership.ts, all three schema.ts files; the PixiJS renderer (PixiViewport.tsx, PixiStaticMap.tsx, Character.tsx) and its assets (data/spritesheets/*, animations/*, gentle.js, convertMap.js) -- currently unreferenced by any route, held for a future Visual Runtime (FR-N010, out of scope here); convex/util/geometry.ts + minheap.ts (generic, zero Game/Player coupling, unlike movement.ts).

Two corrections to the merged ART-107 audit discovered only at implementation time (documented inline in docs/upstream-visual-capability-audit.md with a correction note, and in ADR-0004): (1) movement.ts/location.ts import Game/Player directly and cannot compile standalone -- retired, not preserved as originally audited; (2) testing.ts (stop/resume/kick, this session incidents own containment mechanism) calls stopEngine/startEngine/kickEngine from the now-deleted main.ts and would crash if kept -- retired in full. "Preserve: admin emergency controls" in the task brief refers to ARTs own FR-K006 kill switch (simulation/emergencyStopOperations.ts), a separate unaffected system, not this file.

App.tsx: the bare (no-hash) route, which used to render the interactive Game, now renders the existing public Homepage -- same fallback as every other entry point. No new read-only shell was built (FR-N002/FR-N010 explicitly out of scope).

convex/init.ts (run by predev on every `npm run dev`) used to bootstrap the a16z demo world; reduced to a no-op that keeps only the still-relevant misconfigured-LLM-provider check, so predev keeps working unmodified. convex/music.ts had one broken reference (api.world.defaultWorldStatus, an existence-check with zero real effect, function itself has zero callers) -- removed the check, not the function.

Verification (isolated runs -- npm run check as one chain intermittently hit a flaky tsc TS2589 "excessively deep" error in this dev environment, root-caused to the live `convex dev` backgrounds interaction with tsc --incremental and NOT a real code defect: identical code typechecks clean on a fresh tsconfig.tsbuildinfo every time tested in isolation; recommend clearing tsconfig.tsbuildinfo if this recurs):
- npm run check:architecture + test:architecture: pass (11 modules, 6/6)
- npm run typecheck: clean
- npm run lint: clean
- npm test: 85 suites / 1113 passed, 5 skipped (2 pre-existing FR-K006 source-reading tests in emergencyStopControls.test.ts updated to assert the retired files no longer exist, a strictly stronger property than their old "guarded" assertion)
- npm run build: clean; production bundle 1,205 kB -> 328.81 kB, 825 -> 183 modules
- Live browser verification (after redeploy): bare route falls back to Homepage cleanly (zero console errors); #home/mistwood and #live/mistwood render real Canon content correctly; npx convex data confirms engines.generationNumber stayed frozen at 44446 (this sessions containment value) and worldStatus.status stayed stoppedByDeveloper throughout -- no engine activity, before or after.
- Canon spot-checked intact: canonEvents (80 rows through world-day 4) and canonSnapshots unaffected.

Documentation: README.md (repository layout + core-concepts section rewritten, no more "(retained)" framing), docs/architecture/adr/ADR-0001 marked Superseded with an inline note, new ADR-0004 recording this decision, docs/architecture/current-state.md banner-flagged as historical-baseline-only, docs/architecture/module-boundaries.md corrected. .env.example already had zero a16z-specific vars (only ART-own LLM/Clerk/ops vars) -- no change needed there. docs/prd-2.0-requirement-matrix.md §10.3 row marked Done.

CORRECTION (2026-08-05, after further verification): the "npm run lint: clean" and "flaky tsc caching, not a real defect" claims above are WRONG. They were based on a locally-warm node_modules/TS-server cache that gave a false-clean result. A genuinely fresh `git clone` + `npm ci` (the only reliable way to verify this class of issue, confirmed empirically in this session) reproducibly shows 78 real ESLint no-unsafe-* errors in convex/operations/postCommitLiveFunctions.ts (~16 distinct internal.*Functions/Operations submodule references, lines ~180-435), convex/simulation/worldDayLiveFunctions.ts (directorFunctions/characterIntentFunctions/sceneGroupingFunctions/sceneSimulationFunctions/schedulerOperations x3), and convex/operations/canonCorrectionFunctions.ts (one reference).

Root cause (now confirmed deterministic via multiple independent fresh-clone reproductions, not flaky): this repos generated Convex internal/api type is large enough that TypeScripts type-instantiation depth limit gets crossed by ANY sufficiently large change to the Convex module count -- confirmed reproducible from BOTH ART-107s single file rename (reverted, see ART-107s own history) AND independently from this tasks ~20-file deletion. Two hard tsc TS2589 errors (convex/music.ts, ArcDetailPage.tsx) were found and fixed with a narrowly-scoped, correctly-placed @ts-ignore (the directive must be the LITERAL line immediately before the failing expression -- a multi-line explanatory comment block above it does NOT suppress the error, confirmed by trial). Fixing those two did NOT relieve the separate ESLint no-unsafe-* cascade in the three operations/simulation files -- confirmed by a second independent fresh-clone run after the fix, contradicting an earlier (wrong) assumption that the two failure modes shared enough of a "budget" that fixing one would fix both.

Given the remaining fix requires touching ~21 distinct internal.X.Y references across two sensitive production pipeline files (the post-commit and world-day-live orchestrators), each needing individual, carefully-verified suppression or extraction, this is disproportionate to fix reactively within this tasks scope. Split out as ART-142 (blocks this task). ART-112s own retirement logic is complete, correct, and verified at the runtime/business-logic level (full test suite, live browser checks, Canon integrity) -- only the pre-existing, unrelated TypeScript/ESLint tooling fragility blocks a clean CI pass. Status set to Blocked, pending ART-142.

ART-142 is Done and merged into this branch (PR #154, fast-forwarded into
feat/art-112-retire-aitown-engine-v2). The blocking CI failure (78 ESLint no-unsafe-*
errors after this task's own file deletions) is resolved at the root: every raw
internal/api union property-access chain in the codebase now goes through a typed
FunctionReference helper instead. Fresh-clone `npm run check` passes end to end.
This task's own retirement logic and documentation were unchanged by ART-142 -- only
the CI blocker is lifted. Re-running PR #153's CI against the updated branch tip now
that ART-142 is merged in.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Update: the CI blocker (78 ESLint no-unsafe-* errors from ART-142's root cause) is
resolved by ART-142 (merged into this branch via PR #154). PR #153 re-ran CI on the updated
branch tip -- both required checks (Bootstrap, Offline checks: typecheck/lint/test/build) passed
-- and merged into main via the enabled auto-merge. lint now passes clean on a fresh clone; all
acceptance criteria and Definition of Done items are satisfied. The retirement work itself
(engine lifecycle removed, visual runtime preserved, docs updated, live-browser and Canon
integrity verified) was already complete and correct prior to this -- only the tooling blocker
needed lifting. See ART-142 for the fix's own details and verification evidence.
<!-- SECTION:FINAL_SUMMARY:END -->
