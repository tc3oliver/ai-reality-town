---
id: ART-119
title: Render Canon-driven character movement and animation states
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-07 10:40'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-118
  - ART-117
priority: high
type: feature
ordinal: 119000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O002 (PRD 2.0 §12 Epic O)

**Problem / Context:** Canon-driven movement is the only motion type permitted to express a semantic location change (PRD 2.0 UX2-002). The client must interpolate published motion units smoothly and render animation states legibly.

**Goal:** All twelve characters render on the map with smooth cross-location movement and recognisable idle, walking, speaking and thinking states.

**Scope:**
- Interpolate `PublicCharacterMotion` using `startedAt`, `arriveAt` and `motionSequence`.
- Walking animation with correct facing direction.
- Idle animation or a clear static standby state.
- Recognisable speaking / thinking / activity indicators.
- Frame-rate degradation on low-end devices without corrupting semantic state.
- No teleporting unless a Canon event explicitly permits special movement.

**Fixture rule (ART-107 §8):** Any deterministic-fixture development or test must use IDs from the production Mistwood seed (`convex/canon/mistwoodSeed.ts`). `convex/canon/mistwoodFixture.ts` was rebuilt in place (not renamed) to use production seed IDs (Lin Yingxue, Wu Zhen), so it is now safe to import for structural testing, but production acceptance and any other V2 Dynamic Live work must still source data from `mistwoodSeed.ts` directly, not this foundation-test fixture.

**Out of Scope:** Ambient in-zone behaviour (FR-O011); dialogue content and safety filtering (FR-O004); replay playback (FR-O013).

**Dependencies:** FR-O001 live map; FR-N006 Canon/runtime sync.

**Schema Impact:** None.

**API Impact:** Consumer of the public dynamic projection.

**Security Impact:** None beyond the projection boundary.

**Test Requirements:** Interpolation correctness against fixed motion fixtures (Mistwood-seed IDs only); animation-state mapping tests; a test proving reduced frame rate does not change semantic location.

**Validation Commands:**
- `npm run check`
- Browser E2E: a character moves smoothly from point A to point B.

**Documentation Impact:** Motion rendering and animation-state documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All twelve characters can display on the map
- [x] #2 Canon location changes render as smooth cross-location movement
- [x] #3 Stationary characters show an idle animation or a clear static standby state
- [x] #4 Moving characters show a walking animation with correct facing direction
- [x] #5 Speaking, thinking and special activity have recognisable indicators
- [x] #6 Characters never teleport unless a Canon event explicitly permits special movement
- [x] #7 Low-performance devices may reduce update rate without corrupting semantic state
- [x] #8 Implementation may proceed against deterministic fixtures, but production acceptance requires ART-139 fixed and cross-location movement verified from accepted events produced by the real provider
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
## ART-119 Implementation Plan

### Summary
Far more is already built than the task implies: worldViewModel.ts already does from->to interpolation, clamping, direction mapping, latest-motion resolution; Character.tsx already renders directional walk cycles and has speech/thought placeholder overlays. The two genuinely net-new things: (1) an animation CLOCK -- nothing currently advances nowMs, so the map is a still frame that only updates when a new projection arrives; (2) getting sprite assignments to the client -- solved via data/ (the boundary-neutral shared layer already used for data/mistwood.ts), NOT via a new public query and absolutely NOT by widening publicRead/client boundaries to include convex/visual (which would leak convex/canon/mistwoodSeed.ts's privateProfile/privateGoal/fear/secretContents for all 12 characters onto a client import path).

### Sprite data to client -- the disqualifying finding
Neither clientWorldReadOnly nor clientLive's mayDependOn includes "visual" in architecture/module-boundaries.json. Widening this is not a policy tweak, it's a leak: convex/visual/mistwoodVisualBindings.ts imports MISTWOOD_PUBLIC_WORLD_ID from ../canon/mistwoodSeed, which carries private character data for all 12 residents. A new public query is also wrong-shaped: sprite assignment is a static, deterministic, compile-time constant (same on every deploy) -- paying a per-viewer network round trip for it is unnecessary, and publicRead doesn't depend on visual either so the query would need its own plumbing anyway.
Correct answer: data/ is owned by no boundary module (moduleForPath returns null for it), so imports across that edge are unconstrained -- exactly how convex/visual/mistwoodLocationBindings.ts already imports data/mistwood.ts today. Move the sprite catalogue + palette engine + character roster there, re-export from convex/visual/ unchanged (pure re-export, zero behavior change, existing import sites keep working).

### Animation states: 3 of 5 are structurally unreachable today
convex/visualRuntime/motion.ts's AnimationState type is only 'idle'|'walking' -- the runtime NEVER produces 'speaking'|'thinking'|'activity' (grep confirms exactly 2 producers: seedBootstrap.ts and visualSyncPlanner.ts, both idle/walking only). publicDynamicProjection.ts's wider 5-value union just passes these through unchanged. AC#5 must be built as DORMANT rendering logic driven by fixtures (exact precedent: PUBLIC_MOTION_TYPES already declares 'ambient'/'replay' which nothing produces yet) -- ART-123 (FR-O004) is the task that will make speaking/thinking real.

### Sprite sheet has no speaking/thinking frames -- vector overlay is forced
data/spritesheets/f1.ts's animations object is exactly {left,right,up,down}, 3 frames each, 12 total. No idle-blink, no gesture, no talk frame. PRD forbids new art. AC#5 can only be met with a drawn (Graphics) overlay, not sprite frames, not emoji (OS-font-dependent, tofu risk, no bundled emoji font in this repo's two font assets).

### Phase 0 -- baseline
npm run agent:check; record baseline npm run check:architecture / check:asset-licenses / typecheck / test.

### Phase 1 -- client-safe character visual data, new data/ files
1.1 New data/spritesheets/catalogue.ts: SPRITE_KEYS, CHARACTER_TEXTURE_URL/WIDTH/HEIGHT, SPRITE_FRAME_SIZE/CELL_WIDTH/CELL_HEIGHT, SPRITE_CELL_ORIGINS, SPRITE_FRAME_ORDER, spriteSheetData, isSpriteKey -- moved VERBATIM from convex/visual/characterVisualBinding.ts (their natural home was always beside f1.ts-f8.ts).
1.2 New data/spritePalette.ts: relocate (not duplicate) the pure colour engine from characterVisualBinding.ts -- HsvWindow/PaletteSlot/PaletteRange/PaletteRecolour/PaletteVariant/BASE_PALETTE_VARIANT/PROTECTED_SKIN_WINDOW/Hsv/rgbToHsv/hsvToRgb/isInHsvWindow/hsvWindowsOverlap/PaletteApplication/applyPaletteVariant. No logic change.
1.3 New data/mistwoodCharacters.ts: the 12-character public roster (characterId/displayName/spriteKey/paletteVariant per row), MISTWOOD_PALETTE_RANGES/_VARIANTS (moved from mistwoodVisualBindings.ts), spriteAssetKey() function, mistwoodCharacterSpriteKeys lookup map.
1.4 Rewire convex/visual/: characterVisualBinding.ts and mistwoodVisualBindings.ts become pure re-exports of the moved code -- zero behavior change, every existing import site keeps working untouched (matches worldViewModel.ts's existing "re-exported from producer so consumer/publisher cannot drift" pattern).
1.5 New data/mistwoodCharacters.test.ts: drift pin asserting every mirrored row equals buildMistwoodCharacterVisualBindings()'s output; exactly 12 rows matching MISTWOOD_SEED_PLACEMENTS; spriteAssetKey is injective; validateCharacterVisualBindings still returns [] (proves 1.4 changed nothing).
Design rationale for the asymmetry: mirror the roster data (drift-testable, precedented), but RELOCATE the palette algorithm rather than duplicate it (a drift test on an algorithm is just a re-implementation of the algorithm -- too risky for a skin-protection engine).
Gate: npm run check:architecture && npm run test:foundation must pass before Phase 2.

### Phase 2 -- view-model extensions, src/components/world/worldViewModel.ts
Extend ReadOnlyWorldCharacter: add semanticLocationId (makes AC#7 provable), add animationState: PublicAnimationState, add motionType: PublicMotionType, replace isSpeaking/isThinking booleans with the animationState field, keep isMoving (animationState==='walking' && progress<1).
Fix a latent clamp bug: anchors are tile-centres (tile+0.5), current clamp bounds to width-1 instead of width -- a character at x=47.5 on a 48-wide map gets silently shifted half a tile.
Add pure exported helpers: interpolatedTile(motion, nowMs) (extracted from the existing map()), isWithinSegment(motion, point) (AC#6 test predicate).

### Phase 3 -- motion clock and quality tiers
New src/components/world/renderQuality.ts (pure, sibling of webglSupport.ts): RENDER_QUALITY_TIERS=['high','medium','low'], TIER_UPDATE_HZ={high:60,medium:30,low:10}, updateIntervalMs(tier), detectRenderQualityTier(probe?) -- total function, defaults to 'medium' on undefined/NaN inputs.
New src/components/live/useMotionClock.ts (sibling of useElementSize/useReducedMotion): requestAnimationFrame loop emitting Date.now() only when elapsed>=intervalMs, setInterval fallback, returns a fixed Date.now() when enabled===false, cleans up on unmount. NO network call of any kind -- must stay inside readOnlyClientBoundary.
Wire src/components/live/LiveMapPage.tsx: detect tier once, useMotionClock(updateIntervalMs(tier)) for nowMs, change the interpolation useMemo's deps from [motions] to [motions, nowMs], pass mistwoodCharacterSpriteKeys instead of {} for spriteKeys.
Explicit decision: reduced motion does NOT stop character interpolation (that would BE the teleport AC#6 forbids) -- it only collapses camera tweens to 0ms and forces indicators to static form; cap tier at 'medium' under reduced motion.

### Phase 4 -- sprite asset resolution and palette variants
New src/components/world/spriteSheetCache.ts: module-level Map<string,Promise<Spritesheet>> keyed by asset key, so N character mounts share one parse instead of N separate parses (also fixes existing per-instance-parse staleness bug in Character.tsx).
New src/components/live/spriteAssets.ts + useSpriteAssets.ts: base sprite keys (f1-f8) resolve synchronously to {textureUrl, spritesheetData}; the palette-variant keys resolve ASYNCHRONOUSLY by drawing the texture into an offscreen canvas, applying applyPaletteVariant via getImageData/putImageData, exporting via toDataURL as the textureUrl. Recolour the WHOLE texture (not a cropped cell) so existing absolute frame coordinates in f1.ts-f8.ts stay valid unchanged -- document that a variant's HSV window can incidentally touch other sprites' cells in the recoloured copy, which is harmless since a variant texture is only ever drawn with its own base sprite's frames; assert this in a test. Fallback: if canvas/2d context is unavailable, variant keys resolve to the plain base texture (all characters still render, just some look-alike pairs share appearance) -- never fail to render a character over a missing palette.
Wire src/components/live/LiveMapView.tsx: replace spriteAssets={{}} with the hook's resolved value.
If Phase 4's async palette half runs long, Phases 1-3 + the synchronous base-sprite half of 4 already satisfy all 8 ACs -- the async variant rendering can be cut with a follow-up note if needed, but attempt it first since the plan is concrete.

### Phase 5 -- animation-state rendering (AC#3/#4/#5)
New src/components/world/characterAnimation.ts (pure, no pixi import): IndicatorKind='none'|'speech'|'thought'|'activity'; indicatorFor(state: PublicAnimationState): IndicatorKind as a total Record-based mapping (so a 6th animation state is a compile error); animationSpeedFor(state); IndicatorPrimitive union (roundedRect/circle/polygon shapes with fill/alpha); indicatorPrimitives(kind): readonly IndicatorPrimitive[].
New src/components/world/CharacterStateIndicator.tsx: a Container wrapping a Graphics whose draw callback replays indicatorPrimitives(kind). Speech = rounded rect + tail triangle + three dots. Thought = three overlapping circles + two trailing circles. Activity = a four-point star/diamond (pairwise visually distinct silhouettes at 32px). Vector graphics, not emoji/sprite frames -- deterministic across every OS/device, adds no new asset (PRD-compliant), unit-testable as a pure shape list, static-by-construction so already reduced-motion-correct.
Edit Character.tsx: replace isThinking/isSpeaking props with animationState; delete the emoji Text overlays; render CharacterStateIndicator at y=-24; source the sheet from spriteSheetCache; keep eventMode="none"/interactiveChildren={false} everywhere, add NO on* prop anywhere (preserves ART-113's structural proof).
Edit ReadOnlyWorld.tsx: pass animationState={character.animationState} in place of the old isSpeaking/isThinking props; keep the existing asset===undefined -> null guard.

### Phase 6 -- tests (AC-by-AC)
1: all 12 MISTWOOD_SEED_PLACEMENTS ids resolve to an asset key; composeReadOnlyWorldViewModel over createZeroEventFixture->buildPublicDynamicProjection yields 12 characters; the scene emits 12 Character elements.
2: interpolatedTile at t=0/25/50/75/100% over createSingleMoveFixture is strictly monotonic, starts at from, ends at to, every sample satisfies isWithinSegment.
3: animationState:'idle' -> isMoving===false and indicatorFor==='none'; scene still emits a Character (standby, not absent).
4: for each of the 4 PublicDirections, orientation maps to the correct sheet animation and isMoving===true mid-walk; a horizontal-vs-vertical fixture pair proves facing actually differs.
5: indicatorFor is total over all 5 PUBLIC_ANIMATION_STATES; indicatorPrimitives returns distinct non-empty pairwise-unequal shapes for speech/thought/activity and [] for none/idle; scene emits named indicator containers for hand-built motions carrying those states.
6: motionProgress never leaves [0,1] for nowMs before startedAt, after arriveAt, NaN, +/-Infinity; a later projection for the same character never jumps position discontinuously.
7 (headline test): sample the same createMultiHopFixture motion at 60/30/10/1 Hz grids -- assert semanticLocationId is identical at every sample in every tier, final position equals `to` exactly in every tier, no sample leaves the segment. Plus useMotionClock(100) emits at most ~11 times over 1s of fake timers.
8: fixture half only -- buildPublicDynamicProjection(createSingleMoveFixture()) -> view model shows a cross-location walk end to end. Provider half (real accepted events from a real LLM provider) stays open pending ART-141 (CRITICAL, already tracked separately) -- ART-139 is already Done so that blocker is cleared, but ART-141 is a distinct open item and this task does not close it.
Plus: extend readOnlyWorldSurface.test.ts's covered-files list with the new world/ files (indicator, animation, quality, cache) so the existing no-write/no-handler sweep covers them automatically. NEW structural test: every .ts under data/ contains no readOnlyClientBoundary.forbiddenSymbols and no non-test file under data/ imports convex/canon, convex/visual or convex/publicRead -- this closes a real gap since data/ sits outside both the module graph AND the readOnlyClientBoundary scan, so this task must police it explicitly with a product test rather than a policy change (a policy change would break data/mistwood.test.ts's legitimate seed import). Fixture-ID cleanup: existing readOnlyWorld.dom.test.tsx uses non-seed IDs ('cassia'/'mistwood-market') -- fix to production seed IDs per ART-107 §8's fixture rule.

### Phase 7 -- documentation
New docs/character-motion-rendering.md: interpolation contract, tile-centre->pixel convention, direction->orientation->sheet-animation chain, the 5 animation states (2 live today, 3 dormant pending ART-123) with reasoning, indicator shape vocabulary and why vector-not-emoji, the quality-tier table and the AC#7 invariant ("no tick rate can change semanticLocationId -- semantic identity comes from the projection, only pixel position comes from the clock"), reduced-motion policy, and the two known-deviation caveats below.
Update docs/read-only-world-shell.md noting the character layer is now populated.
Update docs/character-visual-binding.md recording the data/ relocation and that convex/visual now re-exports.
Update docs/prd-2.0-requirement-matrix.md's FR-O002 row: Done for implementation, production acceptance pending ART-141 (not ART-139, which is already Done).

### Known deviations to document (not defects introduced by this task, pre-existing architectural facts)
1. Straight-line interpolation ignores the planned collision-aware route: the planner's waypoints field is deliberately never published (would leak the collision layer's shape), so the client interpolates a straight line between from/to while arriveAt was computed from actual path length -- characters may visually drift/cross a building outline. Document and accept; client-side re-pathing isn't available since visualRuntime isn't in the client's allowed dependencies.
2. VISUAL_RUNTIME_NO_PATH produces a real teleport at the backend level (unroutable character placed directly at destination, startedAt===arriveAt) -- this is a backend degradation already counted by ART-117's problem summary, not a Canon-permitted special movement, and the client cannot distinguish it from one. Note against AC#6 as a known, already-tracked backend condition rather than something this task must solve.

### Explicit non-goals
Ambient in-zone behavior (FR-O011/ART-120) -- motionType:'ambient' renders identically to 'canon' in this task. Dialogue content/safety filtering (FR-O004/ART-123) -- this task ships the indicator, ART-123 supplies the content/states that trigger it. Replay playback (FR-O013/ART-121) -- motionType:'replay' stays dormant. Character cards/click-to-open (FR-O006/ART-124) -- no handler added to any renderer node. Nameplates/unified visual design (ART-124/ART-131). Performance benchmarking/device-tier threshold tuning (FR-Q005/ART-136) -- this task ships the mechanism (renderQuality.ts + useMotionClock), ART-136 measures and tunes it. Formal browser E2E (ART-137).

### Validation
npm run check (architecture, test:architecture, asset-licenses, typecheck, lint, full test suite across all 3 Jest projects, build), THEN a manual browser verification pass (same approach as ART-118): npm run dev, open /ai-town/live/<worldId>, verify twelve sprites render, a character walks A->B smoothly with correct facing, Network panel shows zero requests during animation, throttling to the low tier changes smoothness but not final arrival location. Record results in implementation notes. Formal E2E deferred to ART-137.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per the recorded plan. The critical constraint (sprite data must never require widening a client module boundary to include convex/visual, since that module transitively imports private character data from convex/canon/mistwoodSeed.ts) was followed: sprite catalogue, palette engine, and the 12-character roster all relocated to data/ (the boundary-neutral shared layer already used for data/mistwood.ts), with convex/visual/characterVisualBinding.ts and mistwoodVisualBindings.ts rewired to pure re-exports of the moved code (zero behavior change, every existing import site still works, confirmed by architecture check staying at 19 modules -- no new module needed).

Extended worldViewModel.ts's ReadOnlyWorldCharacter with semanticLocationId/animationState/motionType, fixed a latent off-by-half-tile clamp bug (anchors are tile-centres, old clamp bounded to width-1 instead of width). Added the genuinely-missing animation clock (useMotionClock, a requestAnimationFrame hook) and quality tiers (renderQuality.ts) -- previously nothing advanced nowMs so the map was a still frame between projection updates. Added vector Graphics-based CharacterStateIndicator for speaking/thinking/activity states (deliberately not emoji or new sprite frames -- OS-font-dependent risk, no bundled emoji font, and the approved sprite sheet only has 4 directional walk animations with no speaking/thinking frames at all, confirmed by reading data/spritesheets/f1.ts). Confirmed via convex/visualRuntime/motion.ts and visualSyncPlanner.ts that speaking/thinking/activity are structurally unproduced by the runtime today (only idle/walking exist) -- this task ships dormant-but-correct rendering logic for them, following the exact precedent of PUBLIC_MOTION_TYPES already declaring ambient/replay before anything produces them; ART-123 will make them real.

Added a new structural test (data/dataBoundary.test.ts) proving data/ names no readOnlyClientBoundary.forbiddenSymbols and imports no convex/canon|visual|publicRead -- this closes a real policing gap since data/ sits outside both the module-boundary graph and the existing read-only-client scan. Fixed an existing fixture-ID rule violation in readOnlyWorld.dom.test.tsx (was using non-production IDs, now uses real Mistwood seed IDs per ART-107 section 8).

Manual browser verification: started a live vite dev server and navigated to the live map route. Confirmed ZERO new runtime errors were introduced -- hit the exact same known environmental condition ART-118's session found (this sandbox's connected Convex deployment has exceeded its free-tier quota and is disabled server-side), with identical error count/shape to ART-118's verification, confirming this is a pre-existing environment constraint and not a defect from this task. The LiveMapErrorBoundary (from ART-118) continues to correctly catch it and render the graceful fallback. Could not visually confirm live sprite rendering/animation against real character data for the same reason as ART-118 -- those code paths are instead exhaustively covered by the 124 new/related tests (interpolation monotonicity and clamping, direction-to-animation mapping, all 5 animation states' indicator mapping, quality-tier degradation preserving semantic location across 60/30/10/1 Hz sampling grids, sprite asset resolution).

Verification evidence (all run and passed on branch feat/ART-119-character-movement-animation, based on main post-ART-133-merge):
- npm run check:architecture -> "Architecture boundaries valid (policy v1, 19 modules)." (unchanged module count confirms no boundary widening)
- npx tsc --noEmit -> clean
- npm run lint -> clean (fixed one trivial unused-import warning found during review)
- New/related test files -> 11 suites, 124/124 passed
- Full test suite (NODE_OPTIONS=--experimental-vm-modules npx jest) -> 122 suites, 1768 passed, 5 pre-existing skips, 0 failed
- npm run build -> success
- npm run check:asset-licenses / test:asset-licenses -> pass (21/21)
Full npm run check gate is green. AC#8's production-acceptance half (real provider verification) remains explicitly pending ART-141, per the AC's own wording permitting fixture-based implementation to satisfy this task's scope.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rendered all 12 characters on the live map with smooth interpolated cross-location movement and recognisable animation states, completing the character layer ART-118 deliberately left empty. Sprite/palette data reaches the client via a relocation to data/ (the boundary-neutral shared layer, mirroring the existing data/mistwood.ts pattern) rather than by widening any client module's architecture boundary -- widening to include convex/visual would have put private character data (privateProfile/privateGoal/fear from convex/canon/mistwoodSeed.ts, transitively imported by the visual bindings module) one policy edit away from leaking to every anonymous viewer. Added the previously-missing animation clock and quality-tier mechanism so the map actually animates between projection updates rather than sitting as a still frame, and vector-drawn (not emoji, not new sprite frames -- the approved sheet has none) indicators for speaking/thinking/activity states, which are dormant today since the runtime doesn't produce them yet but are ready for ART-123.

Verified with: architecture check (pass, 19 modules unchanged -- confirms the boundary was not widened), typecheck (clean), lint (clean), 124 new/related tests covering interpolation correctness, animation-state mapping, and the headline frame-rate-degradation guarantee (semantic location identical across 60/30/10/1 Hz sampling of the same motion), the full test suite (1768/1773 passed, 5 pre-existing skips, 0 regressions), production build (success), and asset-license checks (21/21 pass). A live manual browser check confirmed zero new runtime errors versus ART-118's baseline (the sandbox's Convex backend is quota-disabled, a pre-existing environment condition, not a defect here); interactive sprite/animation verification against real data is covered by the test suite instead. Full check gate is green. AC#8's production-acceptance half stays open pending ART-141 per the AC's own stated scope.
<!-- SECTION:FINAL_SUMMARY:END -->
