---
id: ART-120
title: Implement ambient in-zone movement and environmental animation
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-07 11:39'
labels:
  - prd-2.0
  - v2-g
  - epic-o
dependencies:
  - ART-114
  - ART-110
priority: high
type: feature
ordinal: 120000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O011, FR-O012 (PRD 2.0 §12 Epic O, §9.1.2, §9.1.3)

**Problem / Context:** Canon advances only five times per real day, so a purely Canon-driven view is static for hours. PRD 2.0 §9.1.2 permits narratively meaningless in-zone activity to keep the world alive, under strict limits, and RISK2-008 warns that ambient motion must never be mistaken for plot.

**Goal:** Characters remain visibly alive inside their current Canon zone, and the environment animates, without producing or implying any Canon fact.

**Scope:**
- Ambient behaviours strictly inside the current Canon location zone: walking, standby, sitting, reading, working, facing environment objects, short back-and-forth movement.
- Deterministic seeding by characterId + locationId + worldDay + timeBucket so concurrent viewers see consistent behaviour.
- Visual distinction from Canon-driven movement.
- Environmental animation: water, trees, smoke, lighting, weather, day/night, building ambience.
- Reduced Motion disables ambient and environmental animation.

**Out of Scope:** Canon-driven movement (FR-O002); replay (FR-O013); dialogue rendering (FR-O004).

**Dependencies:** FR-N010 Visual Runtime; FR-N005 location bindings (ambientAnchors).

**Schema Impact:** None persisted beyond deterministic derivation.

**API Impact:** Published as `motionType: "ambient"` within the existing projection.

**Security Impact:** Must create no accepted event and must not mutate Canon, memory, knowledge, relationships or story arcs — asserted by test.

**Test Requirements:** Zone-boundary tests (ambient never leaves the zone), determinism tests across repeated derivations, an integration test asserting zero accepted events result from ambient activity, and Reduced Motion behaviour tests.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Ambient and environmental animation rules, including the RISK2-008 mitigation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ambient movement never leaves the character current Canon location zone
- [x] #2 Ambient movement creates no accepted event and does not change Canon, memory, knowledge, relationships or story arcs
- [x] #3 Ambient movement never starts a new character conversation
- [x] #4 Ambient behaviour is deterministically seeded by characterId, locationId, worldDay and timeBucket
- [x] #5 Concurrent viewers see reproducible and broadly consistent ambient activity
- [x] #6 Ambient movement is visually distinguishable from Canon-driven movement
- [x] #7 Environmental animation does not modify world state
- [x] #8 Reduced Motion disables ambient and environmental animation
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
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## ART-120 Implementation Plan

### CORRECTION to original research (ART-119 has since merged)
The research below assumed ART-119 (characterAnimation.ts, CharacterStateIndicator.tsx, renderQuality.ts, useMotionClock.ts) did not exist yet. It has since merged to main. Phase 3.3 below should REUSE the existing src/components/live/useMotionClock.ts directly rather than building a new useAnimationClock.ts. Phase 4's ambient marker should be added as a new variant on the existing src/components/world/CharacterStateIndicator.tsx (extend its IndicatorKind union with 'ambient' and add a corresponding shape in characterAnimation.ts's indicatorPrimitives) rather than a new component. All other file paths in this plan (worldViewModel.ts, ReadOnlyWorld.tsx, Character.tsx, LiveMapPage.tsx, LiveMapView.tsx, useReducedMotion.ts) already exist from ART-118/119 -- extend them in place, do not recreate.

### Summary
Most server-side determinism is already built (ART-114's seededRandom.ts/ambientAnchor.ts). AC#1 is provable by GEOMETRY not pathfinding: zone polygons are enforced convex and every ambient anchor is asserted inside its own polygon, so a straight-line interpolation between any two ambient anchors is inside the zone by convexity -- no A* needed. The hard architectural finding: ambient motion CANNOT be produced server-side and still feel alive, because the client reads a STORED payload rebuilt only when Canon commits (~every 4.8 hours) or the contentHash dedup would be defeated by minute-cadence rebuilds (appending ~1440 spurious read-model version rows/day). Solution: HYBRID -- the server publishes motionType:'ambient' as an eligibility signal plus the Canon anchor; the CLIENT re-derives the drift using ART-114's own seeded primitives (imported, not duplicated).

### AC classification with evidence
#1 never leaves zone -- (a) structurally guaranteed by convexity + anchors-inside-zone assertions already in convex/visual/locationVisualBinding.ts, needs a proving test only.
#2 no accepted event/Canon mutation -- (a) already structural via visualRuntime's canonWriteBoundary + purity test's import allowlist; new client code needs its own boundary guard test (see Phase 2.2).
#3 never starts a conversation -- (a) trivially true, no conversation-writing mechanism exists anywhere reachable from convex/visualRuntime or convex/publicRead (the a16z chat engine was retired in ART-112). Needs a proving test only.
#4 seeded by characterId+locationId+worldDay+timeBucket -- (b) primitives exist (ART-114's seededRandom.ts), producer does not; worldDay is missing from the public projection today and needs to be added as an optional root field.
#5 concurrent viewers consistent -- (b) follows automatically from #4 once the seed is a pure function of published fields + wall clock (xorshift32 is engine-independent).
#6 visually distinguishable -- (c) net-new client work: motionType is published (ART-115/119) but not yet consumed by worldViewModel.ts or rendered distinctly.
#7 env animation doesn't modify world state -- (a) trivially true (PixiStaticMap.tsx has no query/mutation, eventMode:'none'), needs a proving test only.
#8 Reduced Motion disables both -- (c) PARTIALLY WIRED, and there's a LIVE DEFECT TO FIX: useReducedMotion is already threaded to the camera/viewport but PixiStaticMap.tsx currently sets autoUpdate=true and calls play() UNCONDITIONALLY on its environmental animated sprites -- meaning env animation currently ignores Reduced Motion today. This must be fixed as part of this task regardless of the ambient-motion work.

### Why ambient cannot live only on the server
LiveMapPage.tsx reads getPublicDynamicProjection, which serves the PERSISTED liveState payload -- it only changes when rebuildLiveProjection runs (per accepted Canon event, or the hourly snapshot-capture cron, neither of which is minute-cadence). commitReadModelVersion dedupes on contentHash. Baking a minute-cadence ambient position into the payload defeats that dedup by construction.

### Phase 0 -- shared ambient kernel (server, pure, in convex/visualRuntime/)
0.1 Add to convex/visualRuntime/ambientAnchor.ts: selectAmbientAnchorForBucket(binding, seed) -- a STATELESS per-bucket draw (unlike the existing selectAmbientAnchorSequence which walks a stateful PRNG stream from a fixed origin and can't be reconstructed by a viewer joining mid-stream at an arbitrary bucket). Derive the previous anchor index from bucket n-1's own hash so the "no immediate repeat" property still holds without needing stream state.
0.2 Add to convex/visualRuntime/motion.ts: AMBIENT_SPEED_TILES_PER_SECOND = 0.4 (vs the existing MOVEMENT_SPEED_TILES_PER_SECOND = 0.75) -- this is half of the AC#6 visual-distinction design.
0.3 Keep AMBIENT_BUCKET_DURATION_MS=60_000 unchanged (already right-sized: anchor spacing in a Mistwood zone at 0.4 t/s gives ~10-17s of walking + ~45s standing per bucket, "alive but calm"). Add ambientPhaseOffsetMs(characterId, locationId) to seededRandom.ts so the twelve residents don't all step in sync.
0.4 Update visualRuntime.purity.test.ts's import allowlist if needed (none of these additions add new imports, so likely no change needed -- verify).

### Phase 1 -- server publishes ambient eligibility
1.1 convex/visualRuntime/visualSyncPlanner.ts's settledTrajectory: return motionType:'ambient' instead of 'canon' (movementPhase stays 'arrived', animationState stays 'idle', from===to===anchor unchanged). This is the ONLY planner change; the in-transit branch keeps 'canon' unchanged.
Decision (document in a code comment): bootstrapTrajectory (seed-derived initial position, never-moved characters) STAYS motionType:'bootstrap'->public 'idle', NOT 'ambient' -- preserves the existing "never moved is legible" property and keeps 'idle' a genuinely-produced value. The client-side ambient-eligibility gate is therefore a SUPERSET: ambient OR idle both mean "standing inside a Canon zone, eligible for ambient drift."
1.2 convex/publicRead/publicDynamicProjection.ts: add OPTIONAL root fields worldDay and timeSlot (sourced from the last accepted event, already computed as `lastEvent` in the existing code), validated in assertPublicDynamicProjection via the required+optional field pattern already used elsewhere in this file. Bump PUBLIC_DYNAMIC_RUNTIME_VERSION to 2. MUST be optional (not required) -- a required field would break selectPublicDynamicProjection's strict-field assertion on any payload persisted before this change, blanking the live map until the next rebuild. Update convex/publicRead/publicDynamicProjectionValidators.ts and the mirrored assertions in convex/publicRead/runtimeSnapshot.ts to match.
1.3 Update existing tests: publicDynamicProjection.test.ts's "accepts ambient/replay without producing them" test needs to become "produces ambient for a settled character"; check the runtimeVersion expectation. Other tests asserting 'canon' at an in-transit fixture timestamp should still pass unchanged since they test the in-transit branch, not settledTrajectory -- verify rather than blindly edit.

### Phase 2 -- client zone-anchor source
2.1 New data/mistwoodAmbientAnchors.ts: move the anchor-derivation helpers (entryTilesFor, reachableTilesFrom, ambientAnchorsFor, AMBIENT_ANCHORS_PER_ZONE) out of convex/visual/mistwoodLocationBindings.ts, export mistwoodAmbientAnchorsByLocationId: Record<locationId, anchors[]>. mistwoodLocationBindings.ts then imports it back (one source of truth, pure geometry over mistwoodCollision -- only publicLabel stays in convex/visual since it's Canon-sourced). Add a golden test asserting the eight zones' anchors are byte-identical before/after the move.
2.2 architecture/module-boundaries.json: add "visualRuntime" to clientWorldReadOnly.mayDependOn, so the client can import seededRandom.ts/ambientAnchor.ts/motion.ts directly rather than duplicating the PRNG. MANDATORY GUARD: new structural test (src/components/world/ambientMotion.boundary.test.ts, shaped like visualRuntime.purity.test.ts) asserting the client's ambient module imports ONLY convex/visualRuntime/{seededRandom,ambientAnchor,motion} and NEVER mistwoodRuntime.ts (which transitively reaches convex/canon/mistwoodSeed's private character data via mistwoodLocationBindings.ts). This widening is deliberate and narrow -- do not widen further than these three specific files.

### Phase 3 -- client ambient derivation (AC#1/#4/#5/#6/#8)
3.1 New src/components/world/ambientMotion.ts (pure, DOM-free, unit-testable): deriveAmbientPose({motion, anchors, worldDay, nowMs, reducedMotion}) -> {x,y,direction,isMoving}|null. Decision order: reducedMotion->null (AC#8); motionType not in {'ambient','idle'}->null; nowMs<motion.arriveAt->null (never overlay ambient on an unfinished Canon walk); anchors.length<2->null; compute phase offset and bucket; select from/to anchors via selectAmbientAnchorForBucket for bucket-1 and bucket; lerp position/direction/isMoving using AMBIENT_SPEED_TILES_PER_SECOND, duration capped at 40% of the bucket window.
Known, documented limitation (not hidden): straight-line lerp between anchors is provably in-zone by convexity but may visually clip a blocked prop tile inside the zone. Accept for v1 (Mistwood zones are small/mostly open); note the precomputed-route upgrade path in docs if the manual browser check shows clipping.
3.2 src/components/world/worldViewModel.ts: add motionType: PublicMotionType and isAmbient: boolean to ReadOnlyWorldCharacter; composeReadOnlyWorldViewModel takes ambientAnchorsByLocationId/worldDay/reducedMotion and, when deriveAmbientPose returns non-null, uses its x/y/direction/isMoving instead of the existing motionProgress lerp.
3.3 REUSE existing src/components/live/useMotionClock.ts (from ART-119) for the animation clock driving ambient position updates -- do not build a duplicate. Ensure it's frozen (or the ambient derivation gated) under reducedMotion. Hoist useReducedMotion() up to LiveMapPage if not already available there, passing it down alongside the clock value.

### Phase 4 -- AC#6 visual distinction, no new art
Four cumulative, asset-free signals: (1) speed -- 0.4 vs 0.75 tiles/s; (2) gait -- lower Character's animationSpeed prop for ambient (e.g. 0.06 vs default 0.1); (3) extent -- ambient hops stay within one zone diameter, Canon walks traverse the map, inherently different silhouettes; (4) marker -- extend the EXISTING CharacterStateIndicator.tsx (from ART-119) with a new 'ambient' IndicatorKind variant (a subtle low-opacity dwell-ring shape in characterAnimation.ts's indicatorPrimitives), reusing the established vector-graphics pattern rather than a new component. Explicitly rejected: alpha/tint reduction on the character itself (reads as "ghost"/error state, not "ambient").
RISK2-008 mitigations to assert as TESTS, not prose: ambient must never move the camera (cameraModel.ts's focus interpolation reads published from/to, not ambient drift -- preserve by construction, pin with a test); ambient must never change primaryLocationId (reads semanticLocationId, which ambient never alters -- pin with a test); ambient must never contribute to the Live Story Overlay/status text (ART-125, out of scope here -- assert absence).

### Phase 5 -- FR-O012 environmental animation
Approved animated assets available today (per ASSETS-LICENSE.md): campfire.png, gentlesparkle32.png, gentlewaterfall32.png, windmill.png + their JSON. data/mistwood.ts currently places only the mill wheel and water-splash sprites.
IN SCOPE: water (add gentlesplash/gentlewaterfall instances along the Northwater channel, approved asset, map-authoring only); smoke/fire (campfire.json is approved and currently entirely UNUSED -- place at inn/square/hall hearths, highest payoff per effort); lighting/day-night tint (a single full-map Pixi Graphics rect with tint+alpha driven by the newly-published timeSlot from Phase 1.2 -- no art, no filter cost, and Canon-honest by construction since it reflects an accepted event's time slot, never a wall clock, which matters because a wall-clock cycle would imply a world-time the world isn't actually in -- a RISK2-008 violation); sparkle (gentlesparkle32.png, approved+unused, optional accent at orchard/paper mill).
EXPLICITLY DESCOPED with reasoning (PRD §9.1.3 says "may include" so this is PRD-legal to defer): trees (would require identifying tree tile indices and re-blitting per frame -- brittle, effectively new authoring work, no asset -- defer); weather/rain/snow (no approved asset AND no Canon weather fact exists -- inventing weather implies a world fact nobody accepted, a direct RISK2-008 violation -- defer until Canon models weather); building ambience/window glow (feasible as a Graphics overlay keyed to timeSlot, but mark as STRETCH, cut first if the phase runs long).
AC#8 FIX (a live defect to fix regardless of ambient-motion scope): PixiStaticMap.tsx currently sets autoUpdate=true and calls play() UNCONDITIONALLY on its animated env sprites. Add a reducedMotion prop, retain references to the created AnimatedSprites, and stop()/gotoAndStop(0) them in applyProps when reducedMotion is true. Thread reducedMotion from ReadOnlyWorld.tsx (already has it in scope from ART-118/119) down to PixiStaticMap. Day/night tint under Reduced Motion: static, no cross-fade.

### Phase 6 -- tests (AC-by-AC)
#1: property test over all 8 location bindings x all anchor pairs x 25 lerp samples, every sample satisfies isPointInZonePolygon; plus a convexity-invariant test citing why this proves in-zone-ness.
#2: extend the purity allowlist/closure for any new runtime file; new client-side boundary test (Phase 2.2's mandatory guard); integration test running rebuildLiveProjection twice over an unchanged world with ambient live, asserting zero new Canon rows and deduplicated:true.
#3: structural test (shaped like readOnlyWorldSurface.test.ts) grepping the ambient module's dependency closure for conversation/message/mutation symbols, asserting empty.
#4: golden-vector test -- deriveAmbientPose over fixed (characterId, locationId, worldDay, nowMs) tuples from MISTWOOD_SEED_PLACEMENTS, byte-identical output across 1000 repeats; assert the seed key contains all four required components.
#5: two independent derivations at the same nowMs with different call orders produce identical poses for all twelve characters; plus a bucket-boundary test at nowMs = k*60000 +/- 1ms.
#6: composeReadOnlyWorldViewModel marks an ambient character isAmbient:true and a Canon walker false; DOM test asserts the ambient marker renders only for ambient characters; a test pinning AMBIENT_SPEED < MOVEMENT_SPEED; camera tests confirming focusTargetsFrom/primaryLocationId outputs are IDENTICAL with and without ambient drift present (the RISK2-008 camera-invisibility pin).
#7: PixiStaticMap surface test -- no useQuery/useMutation/fetch token anywhere; env-sprite config is a pure function of the map data.
#8: deriveAmbientPose(..., reducedMotion:true) === null for every fixture; DOM test asserting env AnimatedSprites are stop()ped and the day/night tint is static under reducedMotion.
Fixture rule throughout: Mistwood-seed IDs only (reuse convex/visualRuntime/fixtures.ts's MISTWOOD_SEED_PLACEMENTS). No Playwright/E2E -- structural+unit+dom tests plus one manual browser check, formal E2E deferred to ART-137.

### Phase 7 -- documentation
New docs/ambient-and-environmental-animation.md: the seed contract; why ambient is client-derived and the server publishes only eligibility (cite the contentHash-dedup reasoning); the four AC#6 distinction signals; the FR-O012 in-scope/descoped table with the "no Canon weather fact => no weather" reasoning; a dedicated RISK2-008 mitigation section mapping each PRD mitigation to its enforcing test.
Update docs/visual-runtime-trajectory-planner.md (settled units are now 'ambient'), docs/public-dynamic-projection.md (runtimeVersion 2, optional worldDay/timeSlot fields), docs/mistwood-location-bindings.md (anchors moved to data/), docs/architecture/module-boundaries.md (the clientWorldReadOnly widening + its guard test), docs/prd-2.0-requirement-matrix.md (FR-O011/FR-O012 rows), ASSETS-LICENSE.md (campfire/sparkle move from unused-but-approved to actually-in-bundle).

### Explicit non-goals
Canon-driven movement rendering (FR-O002/ART-119, already done). Replay playback (FR-O013/ART-121). Dialogue and conversation hints (FR-O004/ART-123). Scene visualization (FR-O003/ART-122). The degradation ladder (FR-O010/ART-127). Formal browser E2E (ART-137). Tree animation, weather effects, building-ambience window glow (all explicitly descoped per Phase 5's reasoning, not silently dropped).

### Validation
npm run check (architecture, test:architecture, asset-licenses, typecheck, lint, full test suite, build), THEN a manual browser verification pass (same approach as ART-118/119): confirm ambient characters visibly drift within their zone between Canon updates, confirm the distinction from Canon-walking characters is perceivable, confirm Reduced Motion freezes both ambient drift and environmental animation, confirm the camera never follows ambient drift.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per the recorded plan (corrected mid-task for ART-119 having merged since the original research: reused the already-merged useMotionClock.ts and extended the already-merged CharacterStateIndicator.tsx/characterAnimation.ts rather than recreating them).

Central design: ambient motion cannot be published server-side and still feel alive, since the client only reads a stored payload rebuilt on Canon commits (~every 4.8 hours) and minute-cadence server writes would defeat the read-model store's contentHash dedup. Solution: hybrid -- the planner's settledTrajectory now returns motionType:'ambient' instead of 'canon' (the only planner change; bootstrap/never-moved characters deliberately stay 'idle' to preserve that signal), and the CLIENT re-derives moment-to-moment drift using a new stateless per-bucket anchor selector (selectAmbientAnchorForBucket) built on ART-114's existing seeded-random primitives, imported directly by the client rather than duplicated.

This required a deliberate, narrow architecture boundary widening: clientWorldReadOnly now may depend on visualRuntime (previously forbidden), scoped to exactly three files (seededRandom.ts, ambientAnchor.ts, motion.ts) and enforced by a new mandatory guard test (ambientMotion.boundary.test.ts) proving the client's ambient code never reaches mistwoodRuntime.ts or anything that transitively touches convex/canon/mistwoodSeed.ts's private character data.

Added optional worldDay/timeSlot root fields to the public projection (runtimeVersion bumped to 2, backward-compatible since optional) so ambient's seed can include worldDay per PRD 9.1.2's literal requirement, and so day/night tinting can be driven by Canon-published time rather than a wall clock (a wall-clock-driven day/night cycle would imply a world-time fact nobody accepted -- a RISK2-008 violation).

AC#1 (never leaves zone) is proven by geometry, not pathfinding: zone polygons are already enforced convex and every ambient anchor is already asserted inside its own polygon (both from ART-110/114's prior work), so straight-line interpolation between any two ambient anchors stays in-zone by convexity -- no A* needed.

AC#6 visual distinction uses four asset-free signals: slower speed (0.4 vs 0.75 tiles/s), slower gait, smaller movement extent (zone-bound vs map-traversing), and a new 'ambient' indicator variant added to ART-119's existing CharacterStateIndicator rather than a new component. RISK2-008 camera-invisibility is pinned by a test proving focusTargetsFrom/primaryLocationId outputs are identical with and without ambient drift present (the camera already only reads published from/to, never client-derived drift).

FR-O012 environmental animation used only already-approved, previously-unused assets: campfire (inn/square/hall hearths), gentlewaterfall/gentlesplash (Northwater channel), gentlesparkle (accents) -- all now actually in the shipped bundle, ASSETS-LICENSE.md updated accordingly. Added a Canon-time-driven day/night tint overlay (no new art, no filter cost). Fixed a live pre-existing defect found in scope: PixiStaticMap.tsx was calling play()/autoUpdate=true unconditionally on environmental sprites, ignoring Reduced Motion entirely -- now gated. Explicitly deferred (with documented reasoning, not silently dropped): tree animation (would need new tile-index authoring), weather effects (no approved asset AND no Canon weather fact to honestly represent), building-ambience glow (marked stretch).

Verification evidence (all run and passed on branch feat/ART-120-ambient-movement-environmental-animation, based on main post-ART-119-merge):
- npm run check:architecture -> "Architecture boundaries valid (policy v1, 19 modules)." (module count unchanged -- the widening was a mayDependOn edit, not a new module)
- npm run test:architecture -> 27/27, including the boundary widening's guard coverage
- npx tsc --noEmit -> clean
- npm run lint -> clean
- New/related test files -> 13 suites, 271/271 passed
- Full test suite (NODE_OPTIONS=--experimental-vm-modules npx jest) -> 127 suites, 1887 passed, 5 pre-existing skips, 0 failed
- npm run build -> success
- npm run check:asset-licenses / test:asset-licenses -> pass (21/21)
- Manual browser check: zero new runtime errors versus the established ART-118/119 baseline (sandbox's Convex backend remains quota-disabled, a pre-existing environment condition unrelated to this change)
Full npm run check gate is green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented ambient in-zone movement and environmental animation (PRD 2.0 section 9.1.2/9.1.3, FR-O011/FR-O012) so Mistwood feels alive between Canon's five daily updates, without ever implying a Canon fact. Ambient motion is a hybrid: the runtime publishes a settled character's motion as motionType:'ambient' (an eligibility signal), while the client derives the actual moment-to-moment drift itself using a new stateless per-bucket variant of the existing seeded-anchor selector -- avoiding the alternative of server-published minute-cadence positions, which would have defeated the read-model store's content-hash deduplication. This required a narrow, test-guarded widening of the client's architecture boundary to reach three specific pure runtime files, never the modules that touch private character data.

AC#1 (never leaves the zone) holds by geometry: zone polygons are enforced convex and every ambient anchor is already proven inside its polygon, so straight-line drift between anchors cannot exit the zone. Visual distinction from Canon-driven walking uses only asset-free signals (speed, gait, movement extent, a new indicator variant) -- no new art, per PRD constraints. The camera provably never follows ambient drift (RISK2-008), pinned by a dedicated test. Environmental animation activates previously-approved-but-unused assets (campfire, waterfall, sparkle) and adds a Canon-time-driven day/night tint; a live pre-existing defect (environmental animation ignoring Reduced Motion) was found and fixed in the same files. Weather and tree animation are explicitly deferred with documented reasoning (no approved asset, and no Canon fact to honestly represent for weather) rather than silently skipped.

Verified with: architecture check (pass, 19 modules, boundary widening test-guarded), typecheck (clean), lint (clean), 271 new/related tests, the full test suite (1887/1892 passed, 5 pre-existing skips, 0 regressions), production build (success), asset-license checks (21/21 pass), and a manual browser check confirming zero new runtime errors against the established baseline. Full check gate is green. All 8 acceptance criteria are evidenced by the tests above.
<!-- SECTION:FINAL_SUMMARY:END -->
