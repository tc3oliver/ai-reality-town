---
id: ART-117
title: Synchronize Canon location changes into runtime movement with zone arrival
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-07 03:37'
labels:
  - prd-2.0
  - v2-e
  - epic-n
dependencies:
  - ART-115
priority: high
type: feature
ordinal: 117000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N006 (PRD 2.0 §12 Epic N)

**Problem / Context:** Canon states semantic facts ("Lin Yingxue is at the clinic") while the runtime needs a journey. Publishing the Canon fact immediately would contradict a sprite still walking; publishing only on arrival would lag. PRD 2.0 §10.5 requires an explicit in-transit phase and forbids a character appearing in two public places.

**Goal:** An idempotent synchronization path turning accepted Canon location changes into runtime movement, with an honest movement phase and zone-based arrival confirmation.

**Scope:**
- Detect visual-relevant state changes from accepted events.
- Create idempotent runtime sync commands keyed so retries never duplicate.
- Movement phase state machine: in-transit renders "heading to X"; only zone arrival renders "at X".
- Persist `RuntimeSyncRecord` with status, timestamps, error code and retry count.
- Stable error codes and drift metrics.

**Out of Scope:** Trajectory planning (FR-N010); client-side interpolation (FR-O002); operator drift tooling (FR-Q002).

**Dependencies:** FR-N003 public dynamic projection.

**Schema Impact:** New `RuntimeSyncRecord` table (PRD 2.0 §14.5).

**API Impact:** Movement phase surfaced through the public projection.

**Security Impact:** Runtime failure must never write back incorrect Canon; the sync path is strictly Canon-read / runtime-write.

**Test Requirements:** Integration tests for location change to correct zone arrival, in-transit then arrived labelling, idempotent retry, runtime failure leaving Canon unmodified, and no dual-location publication.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Canon/runtime synchronization and drift-handling documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Canon location change is converted into a valid runtime destination
- [x] #2 The UI shows an in-transit state while the character is moving
- [x] #3 The character is only shown as located at the target after zone arrival is confirmed
- [x] #4 Runtime failure never writes incorrect Canon
- [x] #5 Retries never create duplicate Canon events
- [x] #6 A character is never published at two locations simultaneously
- [x] #7 Sync errors carry stable error codes and observable metrics
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
## ART-117 Implementation Plan (RE-SCOPED — see rationale below; user-confirmed 2026-08-07)

### Rationale for re-scoping (do not build RuntimeSyncRecord / a sync command queue / a retry state machine)
Deep research (architect agent) confirmed: ART-117's literal scope (PRD §14.5's RuntimeSyncRecord table + idempotent command queue + retry state machine) was written against PRD §15's imperative stateful pipeline, before ART-114/115 actually shipped. ART-114/115 instead built a PURE, STATELESS, re-derived-on-every-read architecture (planCharacterTrajectories is a total pure function of (acceptedEvents, nowMs), never a clock/queue). Under that architecture, 5 of ART-117's 7 acceptance criteria are ALREADY structurally satisfied:
- AC#1 (Canon change -> valid runtime destination): satisfied by visualSyncPlanner.ts's LocationFact folding + planRoute (convex/visualRuntime/visualSyncPlanner.ts).
- AC#2 (in-transit UI state): satisfied by the published animationState:'walking' field (PRD 10.4's own type has no movementPhase field -- client derives transit from animationState + arriveAt vs now).
- AC#4 (runtime failure never writes incorrect Canon): structurally true -- convex/visualRuntime cannot import any Canon write path at all (architecture/module-boundaries.json canonWriteBoundary forbids it, enforced by check-boundaries.mjs + visualRuntime.purity.test.ts's import allowlist).
- AC#5 (retries never create duplicate Canon events): vacuously true -- there is no retry concept and nothing here ever writes a Canon event; re-derivation is idempotent by construction (byte-identical output for the same Canon state, tested).
- AC#6 (never published at two locations simultaneously): proven in three independent layers -- the planner's deduplicated characterIds loop (one trajectory per character), assertPublicDynamicProjection's `seen` set (throws on duplicate characterId, runs on both write and read), and the client's latestMotionPerCharacter collapse-by-highest-sequence.

Building RuntimeSyncRecord as literally scoped would be a REGRESSION: it requires deleting the `movementPhase` entry from PUBLIC_DYNAMIC_FORBIDDEN_FIELDS (convex/publicRead/publicDynamicProjection.ts) and the passing leakage test that asserts injecting movementPhase throws PUBLIC_DYNAMIC_UNKNOWN_FIELD (publicDynamicProjection.test.ts) -- i.e. it would widen PRD 10.4's own contract past what the PRD itself specifies, and create a second, writable source of truth for movement phase that can disagree with the pure derivation (reintroducing the exact drift class PRD 10.5 exists to prevent).

Two REAL gaps remain (AC#3 and AC#7) -- these are the actual scope of this task now.

### Gap 1 (AC#7 -- the real code change): runtime problems are computed then discarded
convex/publicRead/publicDynamicProjection.ts's buildPublicDynamicProjection calls planCharacterTrajectories and reads only snapshot.trajectories -- snapshot.problems (VisualRuntimeProblem[] with codes VISUAL_RUNTIME_UNBOUND_LOCATION / VISUAL_RUNTIME_NO_PATH from convex/visualRuntime/motion.ts) is never read, logged, counted, or returned anywhere. When a character silently vanishes from the map (unbound destination), no operator signal exists. rebuildLiveProjection (convex/publicRead/liveStateFunctions.ts) already returns dynamicCharacterCount but no problem count.

Fix: surface problems as a non-published sibling of the projection (do NOT add problems/movementPhase to the public payload itself -- PUBLIC_DYNAMIC_FORBIDDEN_FIELDS stays intact, the leakage test stays intact). Concretely:
- Add a function (e.g. summarizeRuntimeProblems(snapshot.problems) or similar, in publicDynamicProjection.ts or a small new sibling) that returns a problem count and a count-by-code breakdown, kept OUT of the PublicDynamicProjection type entirely -- return it as a second value from buildPublicDynamicProjection or from a new function that wraps it, not embedded in the published payload.
- Wire it into rebuildLiveProjection's return value: add `dynamicProblemCount` (total) and ideally `dynamicProblemsByCode` (Record<VisualRuntimeProblemCode, number>) alongside the existing `dynamicCharacterCount`.
- Test: a fixture with an unbound destination location yields dynamicProblemCount === 1 with code VISUAL_RUNTIME_UNBOUND_LOCATION, and the affected character is correctly absent from `characters` (not silently guessed at).
- This unblocks ART-133 (FR-Q001 operator metrics dashboard), which depends on ART-115/ART-116 and needs exactly this kind of reachable problem signal.

### Gap 2 (AC#3 -- document + test, no code change to the projection itself): the semanticLocationId in-transit rule needs to be written down and tested
Today: an in-transit MovementTrajectory's semanticLocationId is ALREADY set to the destination location the moment the Canon event is accepted (visualSyncPlanner.ts), even though the character is still visually walking there (animationState:'walking', from!==to, nowMs<arriveAt). This is CORRECT (Canon's semantic fact is already true; only the visual walk is still in progress) but the RULE for how downstream consumers must interpret this is not written down anywhere, and there's a latent consumer today: convex/publicRead/worldCharacterProjection.ts publishes Canon's currentLocationId directly with no in-transit qualifier at all -- a future page reading it (e.g. ART-124's character card) could show "at the clinic" while the sprite is still visibly mid-road, which is exactly what PRD 10.5 forbids.

Fix (documentation + tests only, this task does not touch worldCharacterProjection.ts or build ART-124/ART-119 -- just states the rule they must follow):
- Add an integration test asserting: for an in-transit character (nowMs < arriveAt), the published motion has animationState==='walking' and semanticLocationId===<destination> -- i.e. pin the current (correct) behavior as a regression guard, don't change it.
- Document explicitly (new doc, see below) that "semanticLocationId means the location this motion resolves to, not necessarily where the character currently stands on screen" and that any consumer wanting a location LABEL (not map position) must gate on `nowMs >= arriveAt` (or equivalently check animationState !== 'walking') before treating semanticLocationId as "the character's current location" for display purposes. Explicitly flag worldCharacterProjection.ts's currentLocationId as a known consumer that must adopt this rule once it's actually rendered (currently typed in src/components/public/characterRoute.ts but not yet rendered by CharacterPage.tsx -- so this is a documented landmine for ART-124, not a live bug today).

### Test plan (AC-by-AC, all as INTEGRATION tests proving the existing architecture, following the task's own "Test Requirements" list)
1: AC#1 -- integration test: an accepted character_location_changed event produces a valid runtime destination (bound location -> trajectory with correct semanticLocationId/from/to; unbound location -> character omitted with a VISUAL_RUNTIME_UNBOUND_LOCATION problem, never a guessed position).
2: AC#2 -- integration test: in-transit unit has animationState:'walking'; arrived unit has animationState:'idle'.
3: AC#3 -- integration test per Gap 2 above (semanticLocationId is destination during transit; document the consumer rule).
4: AC#4 -- structural/architecture test (may already exist via visualRuntime.purity.test.ts and check-boundaries -- if so, this task adds an explicit end-to-end integration test: build a projection from a fixture, assert zero canonEvents rows exist/were touched in the test's in-memory store before and after).
5: AC#5 -- integration test: call rebuildLiveProjection-equivalent (or buildPublicDynamicProjection + commitReadModelVersion path) twice with unchanged Canon state -> second call is deduplicated, zero new Canon events (there were never any Canon writes to begin with -- assert the Canon event count is unchanged across both calls).
6: AC#6 -- integration test: a payload with multiple location-change events for various characters never yields two motions for the same characterId (already unit-tested in visualSyncPlanner.test.ts and publicDynamicProjection.test.ts -- add one end-to-end version through the full rebuild path if not already covered there).
7: AC#7 -- new tests per Gap 1: dynamicProblemCount / dynamicProblemsByCode correctly reflect injected problems (unbound location, no-path scenarios).

### Docs
New docs/canon-runtime-synchronization.md (FR-N006): explains that no stateful sync/retry mechanism exists or is needed -- movement phase, arrival, and Canon-write-safety are all structural properties of the pure re-derivation architecture (cite convex/visualRuntime/visualSyncPlanner.ts + the architecture boundary enforcement). Documents the semanticLocationId-during-transit rule from Gap 2, explicitly naming worldCharacterProjection.ts's currentLocationId as a consumer that must respect it. Documents the new dynamicProblemCount/dynamicProblemsByCode operator signal from Gap 1 and how ART-133 should consume it.
Update docs/prd-2.0-requirement-matrix.md's FR-N006 row: mark Done, and explicitly record that PRD §14.5's RuntimeSyncRecord table was deliberately not implemented -- superseded by ART-114/115's pure derivation architecture, which provides stronger guarantees (structural rather than operational) for the same acceptance criteria. This is a load-bearing traceability note; do not omit the justification.

### Explicit non-goals
No RuntimeSyncRecord table, no sync command queue, no retry state machine, no persisted movement-phase state. No changes to convex/visualRuntime/** (stays exactly as ART-114 left it) or to PUBLIC_DYNAMIC_FORBIDDEN_FIELDS / the published PublicCharacterMotion contract shape (stays exactly as ART-115 left it -- problems/movementPhase remain unpublished). No changes to convex/publicRead/worldCharacterProjection.ts itself (out of scope -- just documents the rule it must eventually follow). No implementation of ART-119 (client transit-label rendering) or ART-124 (character card) -- this task only documents the contract they must honor. No changes to the canonWriteBoundary module list (the architect's optional recommendation #5 to extend it to publicRead is deferred, out of scope).

### Validation
npm run check (architecture, test:architecture, asset-licenses, typecheck, lint, full test suite, build).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Re-scoped per user-confirmed decision (see Plan): did NOT build the originally-specified RuntimeSyncRecord table, sync command queue, or retry state machine. Deep architectural research proved ART-114/115's pure, re-derived-on-every-read architecture already structurally satisfies AC#1/#2/#4/#5/#6 (no queue or persisted state needed; building RuntimeSyncRecord would have required deleting movementPhase from PUBLIC_DYNAMIC_FORBIDDEN_FIELDS and breaking a passing leakage test -- a regression, not progress).

Closed the two real gaps: (1) AC#7 -- runtime problems (VisualRuntimeProblem, e.g. VISUAL_RUNTIME_UNBOUND_LOCATION) were computed by planCharacterTrajectories and silently discarded by buildPublicDynamicProjection; added summarizeRuntimeProblems() and a new buildPublicDynamicProjectionResult() (buildPublicDynamicProjection kept as a thin backward-compatible wrapper) returning a problem count + count-by-code as a non-published SIBLING of the projection (never a field of it -- PUBLIC_DYNAMIC_FORBIDDEN_FIELDS untouched), wired into rebuildLiveProjection's return as dynamicProblemCount/dynamicProblemsByCode for future ART-133 consumption. (2) AC#3 -- pinned with a regression test that an in-transit character's semanticLocationId is already the destination (correct, existing behavior) and documented the consumer rule (gate any location LABEL on nowMs>=arriveAt / animationState!=='walking') for worldCharacterProjection.ts's currentLocationId, a latent future consumer (ART-124).

Added integration tests in new convex/publicRead/canonRuntimeSync.test.ts proving the already-structural guarantees for AC#1/2/4/5/6 end-to-end through the full rebuild path, plus the two new-behavior tests for AC#3/#7.

Verification evidence (all run and passed on branch feat/ART-117-canon-runtime-sync, based on main post-ART-115-merge):
- npm run check:architecture -> "Architecture boundaries valid (policy v1, 15 modules)."
- npx tsc --noEmit -> clean
- npm run lint -> clean
- New/related test files (canonRuntimeSync.test.ts, publicDynamicProjection.test.ts, liveState.test.ts) -> 3 suites, 103/103 passed
- Full test suite (NODE_OPTIONS=--experimental-vm-modules npx jest) -> 106 suites, 1472 passed, 5 pre-existing skips, 0 failed
- npm run build -> success
- npm run check:asset-licenses / test:asset-licenses -> pass (21/21)
- convex/_generated/api.d.ts correctly untouched (no new Convex functions, only an existing mutation's return shape changed)
Full npm run check gate is green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed FR-N006 without the originally-specified RuntimeSyncRecord table, sync command queue, or retry state machine -- deep research (user-confirmed) proved ART-114/115's pure, re-derived-on-every-read Visual Runtime architecture already structurally satisfies 5 of the 7 acceptance criteria: a Canon location change always resolves to a valid runtime destination or is honestly omitted with a problem code; in-transit vs arrived is already published via animationState; the runtime physically cannot import a Canon write path so it can never write incorrect Canon; re-derivation is idempotent by construction so retries cannot duplicate anything; and one motion per character is enforced in three independent layers (planner, validator, client). Building the originally-specified table would have been a regression, requiring the removal of a passing leakage test that keeps movementPhase out of the public contract.

Closed the two real remaining gaps instead: runtime problems (an unbound destination, a blocked path) were computed by the planner and silently discarded -- added a problem-count summary as a non-published sibling of the projection, now surfaced through rebuildLiveProjection for future operator/metrics consumption (ART-133). And pinned + documented the rule that an in-transit character's semanticLocationId is already its destination location (correct, existing behavior) so a future consumer reading currentLocationId as a display label knows to gate on arrival rather than treat it as current on-screen position.

Verified with: architecture check (pass, 15 modules), typecheck (clean), lint (clean), the new integration test suite plus related suites (103/103), the full test suite (1472/1477 passed, 5 pre-existing skips, 0 regressions), production build (success), and asset-license checks (21/21 pass). Full check gate is green. All 7 acceptance criteria are evidenced by tests, five of them proving structural guarantees that already existed and two proving the new problem-surfacing and semanticLocationId-rule behavior.
<!-- SECTION:FINAL_SUMMARY:END -->
