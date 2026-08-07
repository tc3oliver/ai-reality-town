---
id: ART-115
title: Publish the whitelisted Public Dynamic Projection
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-07 02:13'
labels:
  - prd-2.0
  - v2-d
  - epic-n
dependencies:
  - ART-114
priority: high
type: feature
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N003 (PRD 2.0 §12 Epic N, §10.4)

**Problem / Context:** Public clients must never read full runtime state. PRD 2.0 requires a field-whitelisted projection carrying exactly what rendering and public narration need, expressed as `PublicCharacterMotion`.

**Seed bootstrap gap (review finding):** The existing `convex/publicRead/liveState.ts` builds its character set only from `character_location_changed`, `character_died` and `character_deactivated` accepted events — it has no path from `worldCharacters` seed rows. The twelve Mistwood characters are written to `worldCharacters` with an `initialLocationId` in their seed payload, but nothing emits a `character_location_changed` event at world initialization. A freshly seeded world with zero location/life events therefore publishes an empty or partial character list, which would silently fail PRD 2.0 §22.4 ("all twelve characters have a valid visual binding") and the ART-137 twelve-character E2E requirement — not because binding is wrong, but because the character never appears in the projection at all. This must not be worked around by fabricating a synthetic Canon event at init; the fix is in the projection/runtime layer, not Canon.

**Goal:** A public, read-only, schema-validated projection that publishes motion and active-scene state, leaks nothing private, and reflects every seeded character from the moment the world exists — not only after its first accepted event.

**Scope:**
- Root payload: `worldId`, `runtimeVersion`, `snapshotSequence`, `updatedAt`, `worldStatus`, `characters[]`, `activeScenes[]`.
- Per-character `PublicCharacterMotion` exactly as specified in PRD 2.0 §10.4, including `motionType` of canon | ambient | idle | replay.
- For a character with no accepted location/life event yet, source its initial public position from the `worldCharacters` seed payload's `initialLocationId` (via ART-114's bootstrap), not from event history.
- Once an accepted event exists for a character, event-derived state overrides the seed-derived initial state — the seed value is a bootstrap default, never an override.
- Runtime schema validation on every field.
- Read path with no write side effect.
- Failure handling that retains the last valid published version.
- Extends the existing `convex/publicRead/liveState.ts` projection rather than replacing it.

**Out of Scope:** Snapshot lifecycle and staleness classification (FR-N007); replay payloads (FR-O013); incremental update strategy (ART-100 / FR-Q003); fabricating Canon events to force initial visibility (not permitted).

**Dependencies:** FR-N010 Visual Runtime (ART-114, which supplies the seed-derived initial position).

**Schema Impact:** New public projection payload (PRD 2.0 §14.4); reuses the existing public read-model infrastructure.

**API Impact:** New public read query; additive.

**Security Impact:** Primary private-data boundary — must exclude memories, secrets, prompts, full dialogue and admin data. Requires dedicated leakage tests. The seed-derived bootstrap path must be held to the same field whitelist as the event-derived path.

**Test Requirements:** Field-whitelist contract tests, schema validation tests, a leakage test asserting no private field can appear, a test asserting reads cause no mutation, and a zero-event-world test asserting all twelve seeded characters still appear.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Public dynamic projection contract documentation, including the seed-bootstrap-vs-event-override rule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The projection publishes the PRD 2.0 section 10.4 PublicCharacterMotion shape
- [x] #2 No private memory, secret, prompt, full dialogue or admin data is returned
- [x] #3 No runtime field beyond what public rendering requires is returned
- [x] #4 Every field is covered by runtime schema validation
- [x] #5 Reading the projection causes no write side effect
- [x] #6 A failed update retains the last valid published version
- [x] #7 motionType lets the client distinguish canon, ambient, idle and replay motion
- [x] #8 The projection is independently testable for authorization and data leakage
- [x] #9 The projection includes every seeded active character even when no accepted location or life event exists yet for them, sourced from the seed initialLocationId rather than omitted
- [x] #10 Once an accepted location or life event exists for a character, event-derived state overrides the seed-derived initial state
- [x] #11 A test using a freshly seeded world with zero location or life events still shows all twelve seeded characters in the published projection
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
## ART-115 Implementation Plan

### Key findings
- Consumer contract already exists: src/components/world/worldViewModel.ts:24-43 (ART-113) declares PublicCharacterMotion field-for-field per PRD 10.4 and interpolates from/to via startedAt/arriveAt. It reads no waypoints/mapId/movementPhase/originLocationId -- publish exactly the PRD 10.4 fields, nothing else.
- Two contract mismatches to map: ART-114's motionType is 'bootstrap'|'canon'|'ambient'|'replay' -> PRD wants 'canon'|'ambient'|'idle'|'replay' (bootstrap->idle). ART-114's direction is 8-compass -> PRD wants 4 (up/down/left/right); diagonals resolve to their horizontal component (matches sprite sheets' side-facing cycles).
- AC#6 ("failed update retains last valid version") is already built: convex/publicRead/readModel.ts (commitReadModelVersion, selectServedVersion, invalidateReadModel) already does insert-then-demote-to-isLastKnownGood-serve-LKG-on-failure. Do not build a new mechanism -- publish through this existing path and test the guarantee end-to-end.
- Repo conventions: tests are Jest (no convex-test exists, no test executes a real Convex function; *Functions.ts files are proven by structural source-scan tests + in-memory store fakes). Zero uses of Convex `returns:` validators repo-wide today -- if adding one causes tsc/build friction, drop it; AC#4 is already satisfied by a hand-written assert function layer.
- Data sources verified: worldCharacters table (convex/canon/schema.ts) = {worldId, characterId, payload: v.any()}; initialLocationId is at payload.initialLocationId (convex/canon/characterSeed.ts). No alive/active column -- aliveness/active derived from character_life_changed / character_state_changed{field:'active'} events, baseline true. worldSchedules.status is 'running'|'paused' (convex/simulation/schema.ts). Canon sequenceNumber starts at 0. convex/visualRuntime/fixtures.ts has MISTWOOD_SEED_PLACEMENTS + createZeroEventFixture/createSingleMoveFixture/createMultiHopFixture ready to use as test inputs.
- runtimeVersion/snapshotSequence/ActiveScenePresentation don't exist in code yet -- must be defined here, minimally (see below for activeScenes scope call).

### Phase 1 -- architecture boundary
architecture/module-boundaries.json: add "visualRuntime" (not "visual" -- not needed, types arrive inferred) to publicRead.mayDependOn. No cycle (visualRuntime->visual,shared; visual->canon,shared; neither reaches publicRead). canonWriteBoundary.forbiddenModules does not include publicRead, so liveStateFunctions.ts keeps using internalMutation/ctx.db freely. Verify with npm run check:architecture (expect "policy v1, 15 modules") and npm run test:architecture (12/12).

### Phase 2 -- pure contract module
NEW convex/publicRead/publicDynamicProjection.ts (pure: no Convex import, no clock/randomness read internally -- nowMs passed in):
- Types: PublicMotionType/PublicAnimationState/PublicDirection/PublicPoint/PublicWorldStatus/PublicCharacterMotion/PublicActiveScene/PublicDynamicProjection matching PRD 10.4 field-for-field. PUBLIC_DYNAMIC_RUNTIME_VERSION = 1.
- Whitelist constants: PUBLIC_MOTION_TYPES/PUBLIC_ANIMATION_STATES/PUBLIC_DIRECTIONS/PUBLIC_WORLD_STATUSES/PUBLIC_MOTION_REQUIRED_FIELDS/PUBLIC_MOTION_OPTIONAL_FIELDS(sourceEventIds, omitted not []-when absent)/PUBLIC_DYNAMIC_ROOT_FIELDS/PUBLIC_DYNAMIC_FORBIDDEN_FIELDS (private fields + runtime-only fields: movementPhase, originLocationId, waypoints, problems, per-motion mapId).
- PublicDynamicProjectionError class with codes PUBLIC_DYNAMIC_INVALID_SHAPE/UNKNOWN_FIELD/INVALID_VALUE.
- toPublicMotionType()/toPublicDirection(): total mapping tables (MOTION_TYPE_MAP, DIRECTION_MAP), no defaults/fallthrough.
- seedPlacementsFromCharacterRows(rows): reads payload.initialLocationId defensively, skips rows with missing/non-string value, sorts by characterId (stabilizes output order/contentHash independent of Convex row order).
- excludedCharacterIds(events): folds character_life_changed / character_state_changed{field:'active'} in sequenceNumber order, returns Set of characterIds to exclude (dead or inactive). Applied AFTER planning (post-filter), not by pruning seedPlacements before planning.
- toPublicCharacterMotion(trajectory): maps a MovementTrajectory to PublicCharacterMotion via the two mapping tables.
- buildPublicDynamicProjection(input): calls planCharacterTrajectories() from ../visualRuntime/visualSyncPlanner EXACTLY ONCE with all seedPlacements + all acceptedEvents (the planner already implements seed-vs-event precedence internally -- do not re-implement it). Precedence recap: character with 0 accepted location facts + seed placement -> bootstrap/idle at seed.initialLocationId, motionSequence 0, from===to, sourceEventIds omitted; character with >=1 accepted facts -> canon trajectory from last fact, motionSequence = last.sequenceNumber+1 (always >=1 since Canon starts at 0) -- this numeric separation (0 vs >=1) is defense-in-depth so producer and the client's highest-motionSequence-wins logic agree independently; character with 0 facts and no seed placement -> omitted entirely; unbound destination location -> omitted + not published (no guessed position). Seed placement is NEVER used to override event-derived state -- only as the anchor-chain origin when facts exist.
- Root field derivation: worldId=input.worldId; mapId=runtime.mapId; runtimeVersion=const 1; snapshotSequence = last-event-sequenceNumber+1 or 0; updatedAt = last event's acceptedAt or 0 (NEVER Date.now()/nowMs -- must be derived-from-Canon so identical Canon state produces byte-identical payloads / stable contentHash for readModel dedup); worldStatus = worldSchedules.status or 'unknown'; activeScenes = publishedEpisode.keyScenes mapped to {title, summary, sourceEventIds} only (no new spatial fields -- ActiveScenePresentation's locationId/participantCharacterIds/arcIds don't exist in code and are FR-O003/ART-122's job, not this task's; inventing them would be fabrication).
- assertPublicDynamicProjection(value): throws PublicDynamicProjectionError on ANY field/type deviation; called before publish and again on read.
- selectPublicDynamicProjection(payload): extracts+revalidates the `dynamic` field from a served liveState payload, returns null if absent.

NEW convex/publicRead/publicDynamicProjectionValidators.ts (kept separate so publicDynamicProjection.ts stays free of convex/values): Convex v.object validators mirroring the types exactly (publicPointValidator, publicCharacterMotionValidator, publicActiveSceneValidator, publicDynamicProjectionValidator). Try using this as `returns:` on the new query; if tsc/build objects (repo's first use of returns:), drop it and just export the validator for reuse -- AC#4 is already satisfied by the hand-written assert layer.

### Phase 3 -- extend liveState.ts (not replace)
- convex/publicRead/liveState.ts: add optional `dynamic?: PublicDynamicProjection | null` input to buildLiveProjection, add required `dynamic: PublicDynamicProjection | null` output field (nested, not merged at root -- LiveProjectionPayload.characters is a different existing shape, don't collide). Bump LIVE_PROJECTION_SCHEMA_VERSION 1->2 -- grep src/components/public/ first for any `schemaVersion === 1` guard to fix.
- convex/publicRead/readModelFunctions.ts: export the existing `readStore` function (currently unexported) for reuse by the new query.
- convex/publicRead/liveStateFunctions.ts: in rebuildLiveProjection, add two reads (worldCharacters by_world_id, worldSchedules by_world_id unique) to the existing Promise.all; add a small local `visualRuntimeForWorld(worldId)` resolver returning mistwoodRuntimeContext() for the Mistwood world id or null otherwise; call buildPublicDynamicProjection() and pass result into buildLiveProjection(); extend the mutation's return value with dynamicCharacterCount/dynamicProblemCount for operator visibility (problems never enter the public payload). Add new public query `getPublicDynamicProjection({ worldId })` returning the dynamic projection (or null) by reading through the existing serveReadModel/readStore path -- read-only, no write side effect, inherits the last-known-good fallback automatically.
- src/components/world/worldViewModel.ts: replace the local PublicCharacterMotion-family type declarations (lines ~24-43) with a type-only re-export from convex/publicRead/publicDynamicProjection to kill type drift (type-only import is erased at compile time, stays boundary-legal since clientWorldReadOnly already may depend on publicRead). If this causes friction, fall back to keeping local declarations plus a compile-time conformance assertion in the test file instead.

### Test plan (AC-by-AC, new file convex/publicRead/publicDynamicProjection.test.ts using fixtures from convex/visualRuntime/fixtures.ts)
1: exact PRD 10.4 field set (Object.keys sorted match, sourceEventIds present only for canon motions).
2: recursive key-walk asserts no PUBLIC_DYNAMIC_FORBIDDEN_FIELDS key at any depth; a raw-string-search test for a named character's actual privateProfile/privateGoal/fear values (catches value leakage under an innocent key); a fixed-point test against the existing sanitizeForPublic() helper.
3: assertPublicDynamicProjection throws PUBLIC_DYNAMIC_UNKNOWN_FIELD for movementPhase/waypoints/originLocationId/per-motion mapId/problems/unknown root keys.
4: table-driven validation failure tests (wrong type, missing, NaN/Infinity, empty ids, out-of-enum values, negative/non-integer motionSequence, arriveAt<startedAt, non-finite points, empty-string sourceEventIds); a cross-check test that the hand-written assert and the Convex v validator agree on every accept/reject fixture.
5: structural source-scan test (like src/components/world/readOnlyWorldSurface.test.ts) proving publicDynamicProjection.ts/Validators.ts name no ctx.db/internalMutation/mutation(/.insert(/.patch(/.replace(/.delete(, and that getPublicDynamicProjection is declared with `query(`; plus an in-memory MemoryReadStore test proving serving mutates no stored row.
6: commit v1 -> invalidateReadModel({status:'failed'}) -> serve returns last-known-good with all 12 characters; a second test with store.insertShouldThrow=true proving a mid-write throw leaves v1 still serving.
7: toPublicMotionType over all four inputs (bootstrap->idle); zero-event fixture all 'idle', single-move fixture shows one 'canon'.
8: suite imports nothing from convex/_generated (structural check); getPublicDynamicProjection takes only {worldId}, no identity arg, so there's no auth-dependent branch to leak through.
9: zero-event fixture -> 12 motions, each idle/motionSequence 0/from===to/no sourceEventIds/semanticLocationId matches seed; seedPlacementsFromCharacterRows skip/sort behavior tested directly.
10: single-move fixture -> the moved character shows canon/motionSequence 2/event-derived location, other 11 stay idle at seed; multi-hop fixture -> last hop wins with correct final motionSequence.
11: zero-event fixture -> all 12 seed characterIds present AND snapshot.problems is empty (catches a binding regression that would otherwise pass by omission).
Plus guard tests: dead/deactivated/resurrected character exclusion; updatedAt derived from last event never from clock (two builds with different nowMs past arriveAt produce byte-identical JSON); snapshotSequence never regresses across fixtures; two identical rebuilds dedupe via commitReadModelVersion; all 8 compass directions map correctly; a character whose destination has no active binding is omitted with a problem, never published.
Update convex/publicRead/liveState.test.ts: buildLiveProjection without `dynamic` still returns all existing fields plus dynamic:null (no-regression check for the extension).

### Docs
NEW docs/public-dynamic-projection.md (modeled on docs/visual-runtime-trajectory-planner.md): root+per-character field tables, the seed-bootstrap-vs-event-override rule verbatim, the 4 runtime fields deliberately not published and why, the two contract mappings (bootstrap->idle, 8->4 direction table), why updatedAt/snapshotSequence are Canon-derived not clock-read, the last-known-good failure story, explicit non-goals with task pointers (FR-N007/ART-116 snapshot lifecycle, FR-O013/ART-121 replay, FR-Q003/ART-100 incremental updates, FR-O011/ART-120 ambient, FR-O003/ART-122 scene visualization -- none of these are built here, only the contract accepts their future values).
Update docs/prd-2.0-requirement-matrix.md FR-N003 row to Done with summary; update docs/visual-runtime-trajectory-planner.md with a one-line pointer that the liveState.ts integration reserved for ART-115 has landed.

### Explicit non-goals
Snapshot lifecycle/staleness classification (ART-116). Replay payloads (ART-121) -- motionType 'replay' accepted by validator, never produced. Incremental update strategy (ART-100) -- rebuildLiveProjection stays a full rebuild. Ambient movement semantics (ART-120) -- motionType 'ambient' accepted, never produced. Scene visualization beyond title/summary/sourceEventIds (ART-122). Fabricating Canon events at seed time -- forbidden; convex/canon/** and convex/schema.ts are not touched at all. No changes inside convex/visualRuntime/ -- it stays exactly as ART-114 left it.

### Validation
npm run check (architecture, test:architecture, asset-licenses, typecheck, lint, full test suite, build) must pass. Baseline to beat: 104 suites / 1378 passed / 5 skipped (pre-ART-144 baseline was different; re-check current main's baseline before comparing).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per the recorded plan: new pure module convex/publicRead/publicDynamicProjection.ts (field-whitelisted PublicCharacterMotion/PublicDynamicProjection matching PRD 10.4, total mapping tables for motionType bootstrap->idle and 8-compass->4-direction, seedPlacementsFromCharacterRows, excludedCharacterIds post-filter for dead/inactive characters, buildPublicDynamicProjection calling convex/visualRuntime's planCharacterTrajectories exactly once -- precedence is NOT reimplemented, it's inherited from ART-114's planner) plus convex/publicRead/publicDynamicProjectionValidators.ts (Convex v validators, successfully used as the repo's first `returns:` on a query -- typecheck/build both clean, no need to drop it).

Extended (not replaced) convex/publicRead/liveState.ts (added optional `dynamic` field, bumped LIVE_PROJECTION_SCHEMA_VERSION to 2 -- no schemaVersion===1 guard existed to fix) and liveStateFunctions.ts (added worldCharacters+worldSchedules reads to rebuildLiveProjection's existing Promise.all, visualRuntimeForWorld() resolver, new public query getPublicDynamicProjection reading through the existing serveReadModel/readStore path -- inherits last-known-good fallback automatically, no new mechanism built for AC#6). readModelFunctions.ts's readStore exported for reuse. src/components/world/worldViewModel.ts now re-exports the producer's types instead of duplicating them.

Deliberately untouched: convex/canon/**, convex/schema.ts, convex/visualRuntime/** (stays exactly as ART-114 left it, pure).

Verification evidence (all run and passed on branch feat/ART-115-public-dynamic-projection, which is based on main post-ART-114-merge but pre-ART-144-merge, so the old asset list in dist/ is expected/unrelated):
- npm run check:architecture -> "Architecture boundaries valid (policy v1, 15 modules)."
- npm run test:architecture -> 12/12
- npx tsc --noEmit -> clean
- npm run lint -> clean
- New/updated test files (publicDynamicProjection.test.ts + liveState.test.ts) -> 2 suites, 85/85 passed
- Full test suite (NODE_OPTIONS=--experimental-vm-modules npx jest) -> 105 suites, 1454 passed, 5 pre-existing skips, 0 failed
- npm run build -> success
- npm run check:asset-licenses / test:asset-licenses -> pass (pre-ART-144 baseline on this branch)
Full npm run check gate is green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired ART-114's pure Visual Runtime into the existing public read-model to expose the field-whitelisted PublicCharacterMotion contract (PRD 2.0 section 10.4, FR-N003). New pure module convex/publicRead/publicDynamicProjection.ts derives a PublicDynamicProjection from Canon accepted events plus worldCharacters seed placements by calling ART-114's planCharacterTrajectories exactly once (seed-vs-event precedence is inherited, not reimplemented), maps the runtime's internal motionType/direction vocabulary onto the narrower public contract, excludes dead/inactive characters, and validates every field by allowlist (assertPublicDynamicProjection) both before writing and on read -- a Convex v validator mirrors the same contract and is used as the repo's first `returns:` on a query. Extended (not replaced) convex/publicRead/liveState.ts/liveStateFunctions.ts with a nested `dynamic` field and a new getPublicDynamicProjection query that serves through the existing read-model store, automatically inheriting its last-known-good behavior on a failed rebuild -- no new failure-handling mechanism was built. A zero-event world still shows all twelve seeded characters (bootstrap positions from worldCharacters.initialLocationId, motionSequence 0), and any accepted location event overrides that seed position going forward (motionSequence >= 1) without ever fabricating a synthetic Canon event.

Verified with: architecture check (pass), architecture tests (12/12), typecheck (clean), lint (clean), the new/updated test suites (85/85, covering all 11 acceptance criteria including the zero-event 12-character test and a private-field leakage test), the full test suite (1454/1459 passed, 5 pre-existing skips, 0 regressions), production build (success), and asset-license checks (pass). Full check gate is green. All 11 acceptance criteria are evidenced by the tests above.
<!-- SECTION:FINAL_SUMMARY:END -->
