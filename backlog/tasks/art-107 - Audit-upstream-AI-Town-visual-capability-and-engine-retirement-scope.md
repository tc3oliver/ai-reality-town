---
id: ART-107
title: Audit upstream AI Town visual capability and engine retirement scope
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:57'
updated_date: '2026-08-05 02:53'
labels:
  - prd-2.0
  - v2-a
  - epic-n
dependencies: []
priority: high
type: feature
ordinal: 107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N001 (PRD 2.0 §12 Epic N)

**Problem / Context:** PRD 2.0 requires reusing the inherited a16z AI Town PixiJS rendering stack rather than rebuilding a renderer, and requires retiring the a16z server-side simulation engine (PRD 2.0 §10.3). No current inventory exists of which visual assets/components are reusable, which are dead, and which server-side capabilities fall inside the retirement scope.

**Fixture ambiguity (review finding):** The repository has two incompatible Mistwood datasets. `convex/canon/mistwoodSeed.ts` is the production seed — twelve residents (Lin Yingxue, Gao Wenrui, …) across eight real locations (`mistwood-station`, `mistwood-paper`, `mistwood-clinic`, …). `convex/canon/mistwoodFixture.ts` is an unrelated legacy Canon test fixture — two characters (Cassia, Rowan) at `mistwood-market`/`mistwood-grove`, locations that do not exist in the production seed. Nothing currently marks which one a V2 task must use, which risks Visual Binding, ART-119 development and E2E fixtures silently building against the wrong character/location ID set — passing against Cassia/Rowan while failing against the real Mistwood seed.

**Goal:** Produce an authoritative, verified inventory of reusable visual capability and an explicit retirement list, so every downstream V2 task builds on evidence rather than assumption — and resolve the fixture ambiguity before any binding or runtime task consumes character/location IDs.

**Scope:**
- Inventory PixiJS renderer files (PixiGame, PixiStaticMap, Character, PixiViewport), pixi.js / @pixi/react / pixi-viewport versions.
- Inventory tilemap data (data/gentle.js), tileset assets, collision/objmap layers.
- Inventory character spritesheets (data/spritesheets/f1-f8, p1-p3, player) and their animation definitions.
- Inventory viewport drag/pan/zoom and click-to-select behaviour.
- Enumerate every client-triggerable Convex mutation/action reachable from the game UI, with file:line.
- Enumerate a16z server-side engine entry points (convex/aiTown/*, convex/agent/*, aiTown/main:runStep, crons) and mark each against the PRD 2.0 §10.3 retirement list.
- Actually boot the existing game view; record why the current public pages do not use the dynamic renderer.
- Inventory and disambiguate every Mistwood dataset in the repository into exactly three categories: Production Mistwood Seed (`mistwoodSeed.ts`), Legacy Canon Test Fixture (`mistwoodFixture.ts`), and any V2 Visual Runtime Fixture created for this PRD's own tests.
- Either rename `mistwoodFixture.ts` to make its non-production nature unambiguous (for example `legacyCanonTestFixture.ts`), or rebuild it to reuse the production seed's character/location IDs — pick one and record the decision.
- State explicitly, as a rule downstream tasks must follow: V2 Dynamic Live production acceptance (ART-119 production acceptance, ART-137, ART-138) must never use the Cassia/Rowan fixture.

**Out of Scope:** Any code change to renderer, engine, or projection beyond the fixture rename/rebuild decision above. This task is documentation + evidence, plus the one fixture disambiguation action.

**Dependencies:** None (entry point of the V2 graph).

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** Identifies the write-path surface that FR-N002/FR-O009 must prove closed; no behaviour change.

**Test Requirements:** No automated tests beyond the fixture rename/rebuild's own existing test suite continuing to pass. Evidence must include a booted-renderer screenshot or equivalent runtime observation.

**Validation Commands:**
- `npm run check`
- Manual: boot dev server, load the game route, capture evidence.

**Documentation Impact:** New `docs/upstream-visual-capability-audit.md`; referenced by PRD 2.0 FR-N001. Must state the Production Seed / Legacy Fixture / V2 Fixture distinction so later tasks cannot conflate them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A code and asset inventory is produced covering renderer, tilemap, spritesheets, animations, viewport and pathfinding
- [x] #2 Every inventoried item is marked reusable-as-is, needs-modification, dead, or must-not-be-public
- [x] #3 The existing renderer is actually booted and observed, not inferred from source alone
- [x] #4 The reason the current public pages do not use the dynamic renderer is documented
- [x] #5 A minimal restoration path to a rendering public view is documented
- [x] #6 Every a16z server-side capability is classified against the PRD 2.0 section 10.3 retirement list
- [x] #7 Every client-triggerable Convex mutation or action reachable from the game UI is listed with file and line
- [x] #8 Every Mistwood dataset in the repository is classified as Production Mistwood Seed, Legacy Canon Test Fixture, or V2 Visual Runtime Fixture
- [x] #9 mistwoodFixture.ts is either renamed to make its non-production nature unambiguous or rebuilt to reuse the production seed's character and location IDs
- [x] #10 The audit states explicitly that V2 Dynamic Live production acceptance must not use the Cassia/Rowan fixture, and this rule is referenced by ART-119, ART-137 and ART-138
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
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Produced docs/upstream-visual-capability-audit.md covering: (1) full renderer/asset/data inventory with reusable/dead disposition per item, (2) a16z server-side capability classification against PRD 2.0 section 10.3, (3) every client-triggerable Convex mutation/action with file:line (verified via grep -rl "useMutation|useAction" src -- exactly 4 files, plus useSendInput call sites), (4) confirmed via cross-repo grep that zero files under convex/simulation, knowledge, story, canon, publicRead, operations, safety, editorial, recaps, viewer, observability import from agent/, aiTown/, or engine/ -- the ART pipeline is fully decoupled from the a16z engine already, (5) booted the renderer live (localhost:5173/ai-town, after this sessions engine-stop containment) via a real browser, confirmed the canvas renders and the freeze toggle correctly reads Unfreeze, confirmed via npx convex data engines immediately before/after that loading the page does not change generationNumber/running, (6) Mistwood dataset disambiguation.

Fixture decision: renamed (not rebuilt) convex/canon/mistwoodFixture.ts -> convex/canon/legacyCanonTestFixture.ts (plus its test file), updated all 4 importers (reducer.test.ts, replay.test.ts, canonCognitionIntegration.test.ts, its own test file). Chose rename over rebuild because the fixture is used by 3 pre-existing, unrelated PRD 1.0 Canon foundation tests -- rebuilding to reuse production seed IDs would risk perturbing established, passing, unrelated test behavior for no V2 benefit. Verified: grep -rl mistwoodFixture convex now returns zero matches; all 4 affected test files still pass (36/36).

Added the "must never use the Cassia/Rowan legacy fixture" rule to ART-119, ART-137 and ART-138 descriptions (their AC lists were not touched). Also fixed stale prose in ART-138s description that still said "Dependencies: ART-99, ART-139" after ART-139 completed and split into ART-141 -- the structured Dependencies field was already correct (updated during ART-139s finalization) but the description text had not caught up; now both agree.

One false-positive scare during verification: a typecheck run briefly showed ~20 errors across convex/agent/*, convex/aiTown/agent.ts, convex/engine/abstractGame.ts and src/components/Message*.tsx that do not exist on a clean checkout. Root-caused to the background `convex dev` process (already running for this project) transiently regenerating convex/_generated/* mid-typecheck right after the git mv changed the file set convex watches. Confirmed not a real regression: re-ran typecheck twice more with no code changes and got zero errors both times; full npm run check subsequently passed clean (86 suites/1120 tests, typecheck/lint/build all green).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Produced docs/upstream-visual-capability-audit.md: the authoritative inventory of reusable PixiJS renderer capability (PixiViewport, PixiStaticMap, Character, spritesheets, animations, tilemap data -- all confirmed zero-dependency on a16z engine state) versus retiring a16z server-side capability (world execution loop, agent reasoning, chat/conversation, input plumbing, Human Player, heartbeat/crons), classified against PRD 2.0 section 10.3. Verified by cross-repo grep that the entire ART pipeline (canon/simulation/knowledge/story/publicRead/etc.) already has zero imports from agent/aiTown/engine -- retirement is safe. Listed every client-triggerable Convex mutation/action with file:line. Booted the actual renderer in a live browser and confirmed it renders (screenshot evidence) without restarting the just-contained engine. Documented why current public pages do not use the dynamic renderer (they read entirely disjoint data sources) and the minimal restoration path for later tasks.

Resolved the Mistwood fixture ambiguity: renamed convex/canon/mistwoodFixture.ts to legacyCanonTestFixture.ts (4 importers updated, 36/36 affected tests still pass), and added the "never use Cassia/Rowan in production acceptance" rule to ART-119/137/138.

Verified: npm run check passes (86 suites/1120 tests, typecheck/lint/build clean).
<!-- SECTION:FINAL_SUMMARY:END -->
