---
id: ART-114
title: Build the lightweight Visual Runtime and movement trajectory planner
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-07 01:14'
labels:
  - prd-2.0
  - v2-d
  - epic-n
dependencies:
  - ART-110
  - ART-111
priority: high
type: feature
ordinal: 114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N010 (PRD 2.0 §12 Epic N)

**Problem / Context:** With the a16z engine retired, nothing converts Canon semantic locations into on-map coordinates and paths. PRD 2.0 §10.3 requires a replacement runtime that contains no LLM path and cannot mutate Canon.

**Seed bootstrap gap (review finding):** `convex/publicRead/liveState.ts` derives its character set only from `character_location_changed`/`character_died`/`character_deactivated` events. Mistwood's twelve seeded characters have an `initialLocationId` in their `worldCharacters` payload but no location event is emitted at world init, so a freshly seeded world publishes no position for them until their first accepted event. This runtime owns producing that initial position — read the seed payload's `initialLocationId`, resolve it through the Location Visual Binding, and emit a static (non-moving) initial position. This must not be done by writing a synthetic Canon event.

**Goal:** A deterministic Visual Runtime that derives movement trajectories from Canon/Public Read Model plus the visual bindings, and produces the motion units the projection publishes — including an initial position for characters with no motion history yet.

**Scope:**
- Visual Sync Planner: resolve a semantic location change into a start anchor, a target entry anchor and a walkable path over the Mistwood collision layer.
- Trajectory production: `from`, `to`, `startedAt`, `arriveAt`, `direction`, `animationState`, `motionSequence`.
- Seed bootstrap: for a character with no accepted location/life event, derive a static initial position from its `worldCharacters` seed `initialLocationId`, without creating a Canon event.
- Deterministic ambient anchor selection seeded by characterId + locationId + worldDay + timeBucket (consumed by FR-O011).
- Deterministic fixtures for testing without any provider.

**Out of Scope:** The published projection contract (FR-N003, which consumes this runtime's bootstrap output); the Canon sync state machine (FR-N006); ambient behaviour semantics (FR-O011); client interpolation (FR-O002).

**Dependencies:** FR-N005 location bindings; FR-N004 character bindings.

**Schema Impact:** May persist derived trajectory state; must not write Canon.

**API Impact:** Internal producer for the public projection.

**Security Impact:** Must contain no LLM call path and no Canon write path — both asserted by test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Movement trajectories are derived from Canon or the Public Read Model plus visual bindings
- [x] #2 The runtime module graph contains no LLM call path
- [x] #3 The runtime never writes to the Canon event store
- [x] #4 Character coordinates are never written back to the backend per frame
- [x] #5 Ambient anchor selection is deterministic given characterId, locationId, worldDay and timeBucket
- [x] #6 The runtime is testable with deterministic fixtures and no external API
- [x] #7 New Convex modules are registered in architecture/module-boundaries.json with dependency rules that forbid the visual runtime from importing any Canon write path, and npm run check:architecture passes
- [x] #8 For a character with no accepted character_location_changed or life-change event yet, the runtime produces an initial static position derived from that character's worldCharacters seed payload initialLocationId, without fabricating any Canon event
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## ART-114 Implementation Plan

### Key findings
- Mistwood collision data already exists: `data/mistwood.ts` (`mistwoodCollision`, [x][y], 1=blocked/0=walkable, 48x36).
- ART-110/111 bindings already exist: `convex/visual/locationVisualBinding.ts`, `convex/visual/mistwoodLocationBindings.ts` (entryAnchors/ambientAnchors/zonePolygon, ambientAnchors BFS-reachable), `convex/visual/characterVisualBinding.ts`.
- a16z pathfinding (`convex/aiTown/movement.ts`) was deleted in ART-112; rewrite A* fresh, do not resurrect old code (git show 893961f^:convex/aiTown/movement.ts as reference only).
- `worldCharacters` seed payload: `convex/canon/mistwoodSeed.ts` / `convex/canon/characterSeed.ts`, `initialLocationId` flat in payload.
- Purity-test pattern to copy: `convex/canon/reducer.purity.test.ts`.
- Boundary checker (`scripts/architecture/check-boundaries.mjs`) only checks direct relative imports between declared module roots; unowned dirs (e.g. convex/util) are NOT checked — so the module must avoid `convex/util/**` entirely, not just `convex/canon/**`.
- Decision: do NOT touch `convex/publicRead/liveState.ts` in this task — that seam belongs to ART-115. ART-114 ships a pure `planCharacterTrajectories()` fn; ART-115 wires worldCharacters + liveState into it.

### New module: convex/visualRuntime/ (100% pure — no convex/_generated, convex/server, convex/values, ctx, Date.now(), Math.random(), fetch, convex/util/*, convex/canon/*)
- `motion.ts` — types: TilePoint, MotionType, AnimationState, Direction, MovementPhase, TrajectoryWaypoint, MovementTrajectory (from/to/startedAt/arriveAt/direction/animationState/motionSequence + semanticLocationId/movementPhase/originLocationId/mapId/waypoints/sourceEventIds), VisualRuntimeSnapshot/Problem types; MOVEMENT_SPEED_TILES_PER_SECOND=0.75; deriveDirection(); travelDurationMs().
- `seededRandom.ts` — FNV-1a32 (fnv1a32), ambientSeedKey (NUL-delimited characterId+locationId+worldDay+timeBucket), ambientSeedValue, createSeededPrng (xorshift32), timeBucketForSlot/timeBucketForInstant, local TIME_SLOT_ORDER mirror (pinned by test against convex/canon/eventTypes.ts TIME_SLOTS).
- `ambientAnchor.ts` — selectAmbientAnchor(binding, seed) = binding.ambientAnchors[ambientSeedValue(seed) % length]; selectAmbientAnchorSequence() for future ART-120 use. Only anchor *selection*, no ambient semantics (out of scope).
- `walkableGrid.ts` — WalkableGrid abstraction, createCollisionGrid(mistwoodCollision), tileCentre/tileOfPoint.
- `pathPlanner.ts` — 4-connected A*, Manhattan heuristic, inline binary heap (no convex/util/minheap dependency), total tie-break ordering (f,h,y,x) for cross-machine determinism, compressCollinear(), pathLengthTiles(), node budget = width*height.
- `seedBootstrap.ts` — bootstrapAnchor()/bootstrapTrajectory(): derive initial static position from seed initialLocationId via location binding, computed on read, never persisted, no Canon event written (AC#8). Fixed BOOTSTRAP_WORLD_DAY/BOOTSTRAP_TIME_BUCKET seed so position is stable pre-first-event.
- `visualSyncPlanner.ts` — entry point planCharacterTrajectories(input). Input uses structurally-typed AcceptedEventLike (not imported from canon) + SeedPlacement[] + WalkableGrid + LocationVisualBinding[] + explicit nowMs. Algorithm: fold accepted events per character sorted by sequenceNumber -> walk anchor chain (bootstrap anchor or first fact's fromLocationId, then selectAmbientAnchor per fact using the fact's own worldDay/timeSlot) -> path only last fact via A* -> emit exactly one MovementTrajectory per character (bootstrap/in-transit/arrived cases per spec). Unbound location -> skip + VISUAL_RUNTIME_UNBOUND_LOCATION problem. Path failure -> retry via entryAnchors (bounded 4 attempts) else arrived-at-target + VISUAL_RUNTIME_NO_PATH problem, never teleport. Invariants: exactly one unit/character, motionSequence monotonic non-regressing, arriveAt>=startedAt, `to` always satisfies hasArrivedAtLocation.
- `mistwoodRuntime.ts` — only file importing `data/mistwood` + mistwoodLocationBindings; exports mistwoodWalkableGrid, MISTWOOD_RUNTIME_MAP_ID, mistwoodRuntimeContext().
- `fixtures.ts` — MISTWOOD_SEED_PLACEMENTS (mirrors mistwoodCharacterSeed.characters, pinned by test), createZeroEventFixture/createSingleMoveFixture/createMultiHopFixture (deterministic, no external API) — non-test source so downstream tasks can import.
- Colocated `*.test.ts` per file + `visualRuntime.purity.test.ts` (import allowlist + forbidden-symbol/regex scan + transitive import-graph walk to prove no LLM/Canon-write reachability).
- No new Convex/DB table; trajectory state is computed on read, not persisted (avoids a second stale source of truth and a write path in a module meant to be write-free).

### Architecture boundary registration (AC#7)
- `architecture/module-boundaries.json`: add `"visualRuntime": { "roots": ["convex/visualRuntime"], "mayDependOn": ["visual", "shared"] }` (canon omitted entirely — stronger than "no write path"; publicRead omitted so ART-115 can later add visualRuntime to publicRead.mayDependOn without a cycle). Add new `"canonWriteBoundary"` section: `writePaths` (the write-capable canon files: commit.ts, characterSeed.ts, worldConfig.ts, snapshotOperations.ts, snapshotManager.ts, inMemoryStore.ts, tensionReadiness.ts, queries.ts, schema.ts), `forbiddenModules: ["visualRuntime","clientPublic","clientWorldReadOnly"]`, `forbiddenSymbols` (internalMutation, ctx.db.insert/patch/replace/delete, canonEvents, commitProposedEvent, validateAndCommitProposedEvent, reduceWorldEvent, seedWorldCharacters, importWorld).
- `architecture/module-boundaries.schema.json`: add required `canonWriteBoundary` object schema (writePaths/forbiddenModules/forbiddenSymbols arrays, additionalProperties:false).
- `scripts/architecture/check-boundaries.mjs`: add 'visual','visualRuntime' to REQUIRED_MODULES; validatePolicy requires canonWriteBoundary and validates its module/path references resolve; validateImport blocks forbiddenModules importing writePaths targets; new validateCanonWriteBoundarySource() (copy of validateReadOnlyClientSource pattern, regex-escaped) scanning forbidden-module-root files for forbiddenSymbols; checkRepository runs it over forbidden modules' roots.
- `scripts/architecture/check-boundaries.test.mjs`: add 3 node:test cases (visualRuntime may import visual bindings not canon; may not import a canon write path; source-level symbol rejection).
- `package.json` lint script: add `convex/visualRuntime` to the linted directory list.
- Verify with `npm run check:architecture` and `npm run test:architecture`.

### Test plan (AC-by-AC)
1. visualSyncPlanner.test.ts — from/to inside correct zone polygons, sourceEventIds/motionSequence match input event, idempotent re-derivation.
2. visualRuntime.purity.test.ts — import allowlist exact match (copy reducer.purity.test.ts pattern) + forbidden regexes (util/llm, simulation/providers, openai/anthropic/generative-ai, fetch(), convex/_generated, internalMutation, mutation(, ctx., ctx.db, insert('canonEvents, commitProposedEvent, reduceWorldEvent) + transitive import-graph BFS walker.
3. Same file covers AC#3 (no Canon writes) — plus repo-wide enforcement via check:architecture.
4. visualSyncPlanner.test.ts — no Convex function/ctx param defined; calling repeatedly across an arriveAt boundary yields only in-transit/arrived states, proving trajectory planning not per-frame ticking.
5. seededRandom.test.ts + ambientAnchor.test.ts — same-seed determinism across 1000 calls, any-field-change changes key, golden vectors pinning fnv1a32/xorshift32 outputs, chosen anchor always in binding.ambientAnchors and passes hasArrivedAtLocation, TIME_SLOT_ORDER equals canon TIME_SLOTS.
6. fixtures.test.ts — deterministic double-call equality, no network/Date.now/convex/_generated imports.
7. scripts/architecture/check-boundaries.test.mjs + `npm run check:architecture` green.
8. seedBootstrap.test.ts + mistwoodRuntime.test.ts — zero-event fixture (12 seeds) yields 12 bootstrap trajectories with from===to, sourceEventIds:[], motionSequence:0, position inside seed's initialLocationId binding; MISTWOOD_SEED_PLACEMENTS pinned equal to mistwoodCharacterSeed.characters; adding one accepted event for one character leaves other 11 bootstrapped (seed is default, not override).
Plus supporting tests: pathPlanner.test.ts (optimality, obstacle detour, unreachable case, cross-run determinism, compressCollinear idempotence), walkableGrid.test.ts (out-of-bounds, [x][y] orientation), motion.test.ts (deriveDirection all octants+tie+zero, travelDurationMs), mistwoodRuntime.test.ts (all 8 Mistwood zones pairwise path-reachable).

### Explicit non-goals (scope boundary)
Published projection contract / new public query (FR-N003, ART-115) — no change to convex/publicRead/liveState.ts or liveStateFunctions.ts. Canon/Runtime sync state machine (FR-N006, ART-117). Ambient behaviour semantics beyond anchor selection (FR-O011, ART-120). Client interpolation/rendering (FR-O002, ART-119). Visual Replay semantics (ART-121) — 'replay' motionType exists in the union but is never produced here. Persisted trajectory table (declined by design, noted as a possible future optimization).

### Docs
- New `docs/visual-runtime-trajectory-planner.md` describing the trajectory contract, anchor-chain algorithm, seeded-anchor algorithm w/ golden vectors, bootstrap rule, and rationale for the import restrictions.
- Update `docs/prd-2.0-requirement-matrix.md` FR-N010 row to Done with module path.

### Validation
`npm run check` (check:architecture, test:architecture, typecheck, lint, test, build) must pass before finalization.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented convex/visualRuntime/ (9 source files + 9 colocated tests + visualRuntime.purity.test.ts, 135 tests) per the recorded plan: motion.ts, seededRandom.ts, ambientAnchor.ts, walkableGrid.ts, pathPlanner.ts (fresh A* rewrite, not the deleted a16z movement.ts), seedBootstrap.ts, visualSyncPlanner.ts (entry point planCharacterTrajectories), mistwoodRuntime.ts, fixtures.ts. Module imports neither convex/canon nor convex/util; AcceptedEventLike is a structural type, not imported from canon.

Architecture: added visualRuntime module + canonWriteBoundary section to architecture/module-boundaries.json and .schema.json; extended scripts/architecture/check-boundaries.mjs (+3 tests in check-boundaries.test.mjs) to enforce it; added convex/visualRuntime to package.json lint globs.

Docs: added docs/visual-runtime-trajectory-planner.md; updated docs/prd-2.0-requirement-matrix.md FR-N010 row to Done.

Deliberately untouched (per plan's non-goals): convex/publicRead/liveState.ts, convex/publicRead/liveStateFunctions.ts, convex/canon/**, convex/schema.ts, data/mistwood.ts.

Verification evidence (all commands run and passed on branch feat/ART-114-visual-runtime-trajectory-planner):
- npm run check:architecture -> "Architecture boundaries valid (policy v1, 15 modules)."
- npm run test:architecture -> 12/12 passed
- npx tsc --noEmit -> clean, no output
- npm run lint -> clean, no output
- NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern=visualRuntime -> 10 suites / 135 tests passed
- NODE_OPTIONS=--experimental-vm-modules npx jest (full suite) -> 104 suites, 1378 passed, 5 skipped, 0 failed (no regressions)
- npm run build -> vite build succeeded
- npm run check:asset-licenses -> 24 assets verified
- npm run test:asset-licenses -> 13/13 passed
Full npm run check gate is green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the pure, deterministic Visual Runtime and movement trajectory planner (FR-N010) under convex/visualRuntime/: a fresh A* path planner over the Mistwood collision grid, a seeded deterministic ambient-anchor selector keyed by characterId+locationId+worldDay+timeBucket, and a visualSyncPlanner entry point (planCharacterTrajectories) that folds accepted Canon location-change facts into exactly one motion trajectory per character, including a seed-derived static bootstrap position for characters with no accepted event yet (no synthetic Canon event written). The module imports neither convex/canon nor convex/util and defines no Convex function, so it is structurally free of any Canon write path or per-frame backend write. Registered the new module plus a canonWriteBoundary policy in architecture/module-boundaries.json (and its schema), enforced by an extended scripts/architecture/check-boundaries.mjs.

Verified with: npm run check:architecture (pass), npm run test:architecture (12/12), npx tsc --noEmit (clean), npm run lint (clean), the visualRuntime test suite (135/135) and the full repo test suite (1378/1383 passed, 5 pre-existing skips, 0 regressions), npm run build (success), and the asset-license checks (pass). Full npm run check gate is green. All 8 acceptance criteria are evidenced by the tests above; liveState.ts/liveStateFunctions.ts, convex/canon/**, convex/schema.ts and data/mistwood.ts were deliberately left untouched, as that integration work belongs to ART-115.
<!-- SECTION:FINAL_SUMMARY:END -->
