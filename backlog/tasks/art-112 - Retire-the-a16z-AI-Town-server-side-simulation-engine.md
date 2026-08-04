---
id: ART-112
title: Retire the a16z AI Town server-side simulation engine
status: To Do
assignee: []
created_date: '2026-08-04 15:58'
updated_date: '2026-08-04 17:16'
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
- [ ] #1 The a16z world execution lifecycle and agent reasoning no longer run
- [ ] #2 aiTown/main:runStep is no longer scheduled or triggerable
- [ ] #3 The restart-dead-worlds and stop-inactive-worlds crons are removed or disabled
- [ ] #4 Human Player, joinWorld, moveTo, sendWorldInput and chat/interact entry points are unreachable from any public surface
- [ ] #5 No LLM call originates from the retired engine
- [ ] #6 All preserved visual modules listed in PRD 2.0 section 10.3 remain intact and importable
- [ ] #7 The ART pipeline (Canon, simulation, story, publicRead) shows no regression
- [ ] #8 Every client-side caller of a retired mutation is removed or neutralized in the same change, so typecheck, lint and build stay green
- [ ] #9 The interactive game route and its player controls (Interact, Freeze, join/move/chat UI and the join-the-town help copy) are removed or gated off the public surface
- [ ] #10 README.md no longer describes convex/aiTown/ or convex/engine/ as retained active components
- [ ] #11 README.md and architecture documentation state which specific src/ modules are retained (renderer, assets) versus what is retired (world lifecycle, agent reasoning, join/move/chat)
- [ ] #12 Startup/deployment docs and environment variable examples no longer reference retired a16z engine configuration
- [ ] #13 Documentation states explicitly that Canon Simulation is the sole narrative source, the Visual Runtime has no agent/LLM/Canon-mutation path, and public visitors never start or sustain the simulation
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
