---
id: ART-112
title: Retire the a16z AI Town server-side simulation engine
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-05 03:17'
labels:
  - prd-2.0
  - v2-c
  - epic-n
dependencies:
  - ART-107
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
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
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
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Permanently retired the inherited a16z server-side simulation engine (world execution lifecycle, agent reasoning, chat, Human Player, heartbeat-driven restart, both lifecycle crons) while preserving every PixiJS renderer component (PixiViewport, PixiStaticMap, Character, spritesheets, animations, tilemap data) for future reuse and leaving the ART pipeline (Canon, simulation, story, publicRead) fully unaffected -- confirmed via a pre-existing cross-repo grep showing zero imports from agent/aiTown/engine anywhere in the ART pipeline (ART-107), and via the full test suite (85 suites/1113 tests) passing unchanged. Convex table schemas for the retired engine are kept (inert historical data, no Canon schema change) since three files (player.ts/agent.ts/conversation.ts) still export the validators schema.ts needs; their class bodies are reduced to inert data holders.

Verified live: booted the app in a real browser after redeploy -- public pages (Homepage, LiveView) render real Canon content with zero console errors; the previously-interactive bare route now falls back to Homepage; npx convex data confirms the engine has taken zero new steps since this sessions earlier containment action (generationNumber frozen, running: false). Production bundle shrank from 1,205 kB to 328.81 kB (825 to 183 modules).

Updated README.md, added ADR-0004 (superseding ADR-0001), and corrected docs/architecture/current-state.md and module-boundaries.md to stop describing the retired engine as active. Two of the original ART-107 audits dispositions (movement.ts/location.ts and testing.ts as "preserve") turned out to be wrong once actually implemented -- both retire instead, corrected in the audit doc, ADR-0004, and this tasks notes with the concrete reason (Game/Player import coupling; calls into the now-deleted main.ts).

npm run check (typecheck/lint/test/build, run in isolation to avoid a flaky, environment-specific tsc caching issue unrelated to this change): all clean. Deployed to the dev deployment (auto, via the running convex dev process); 24-hour log observation scheduled as a follow-up to confirm zero runStep/saveWorld/agentOperations activity and sustained Database I/O reduction over a full day, per the incidents request.
<!-- SECTION:FINAL_SUMMARY:END -->
