---
id: ART-116
title: 'Persist public runtime snapshots with live, delayed, paused and stale states'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-07 03:11'
labels:
  - prd-2.0
  - v2-d
  - epic-n
dependencies:
  - ART-115
priority: high
type: feature
ordinal: 116000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N007 (PRD 2.0 §12 Epic N)

**Problem / Context:** Simulation runs only five slots per real day and can be paused or fail. Without a durable last-valid snapshot the public view would go blank, and without honest staleness labelling it would silently imply live updates.

**Goal:** A sequenced, timestamped public runtime snapshot readable with no simulation running, plus an explicit freshness classification the client can display.

**Scope:**
- Persist `PublicRuntimeSnapshot` with `snapshotSequence`, `status`, `createdAt`, `sourceRuntimeSequence`, character and active-scene states.
- Readable while no simulation is executing.
- Classify freshness as Live, Delayed, Paused or Stale and expose it publicly.
- Guarantee sequence never regresses after reconnect.
- Snapshot failure must not affect the Canon event store.

**Out of Scope:** Renderer degradation ladder (FR-O010); operator pause controls (FR-Q002).

**Dependencies:** FR-N003 public dynamic projection.

**Schema Impact:** New `PublicRuntimeSnapshot` table (PRD 2.0 §14.3).

**API Impact:** Public read surface exposes snapshot sequence, timestamp and freshness status.

**Security Impact:** Snapshot contents inherit the FR-N003 whitelist; no additional exposure permitted.

**Test Requirements:** Snapshot selection tests, sequence monotonicity across reconnect, readability with no simulation running, and proof that snapshot failure leaves the Canon event store intact.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Snapshot and freshness semantics documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Snapshots carry a sequence number and timestamp
- [x] #2 A snapshot is readable when no simulation is executing
- [x] #3 The client can tell whether data is Live, Delayed, Paused or Stale
- [x] #4 A stale snapshot is never presented as continuously updating
- [x] #5 Snapshot failure does not affect the Canon event store
- [x] #6 Sequence never regresses after a client reconnect
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
## ART-116 Implementation Plan

### Key findings
- publicRead may not import simulation (architecture/module-boundaries.json); boundary checker skips *.test.* files so a test may import convex/simulation/scheduler.ts to pin a constant, matching how ART-115's liveStateFunctions.ts already reads worldSchedules by table name without importing simulation.
- Real slot cadence: convex/simulation/scheduler.ts PUBLIC_SLOT_START_MS = [0,6,11,15,19]h -> gaps 6h,5h,4h,4h,5h -> longest normal gap is 6h. PRD has no numeric staleness threshold anywhere -- thresholds must be derived from this observed cadence as named constants, not invented magic numbers.
- PRD 14.3 lists TWO distinct sequence fields: snapshotSequence AND sourceRuntimeSequence. This means the snapshot needs its OWN counter separate from the Canon-derived runtime sequence (PublicDynamicProjection.snapshotSequence from ART-115 maps to sourceRuntimeSequence here).
- rebuildLiveProjection only runs per accepted Canon event (convex/operations/postCommitLiveFunctions.ts) -- no heartbeat exists today. A world paused with no further events would never re-observe its own status without a new cron.
- commitReadModelVersion dedupes on contentHash excluding timestamps; a snapshot needs a wall-clock observedAt that updates without content changing -- this doesn't fit the existing publishedReadModels generic store cleanly.

### Phase 0 -- decision: NEW dedicated table, not a new modelKind
Reasons: (1) freshness clock (observedAt) can't live in a contentHash-deduped payload without either polluting the hash (unbounded rows) or being silently dropped; (2) PRD's two sequence fields don't fit a single per-target version counter; (3) task's own Schema Impact says "New PublicRuntimeSnapshot table" and docs/prd-2.0-requirement-matrix.md line 73 says "獨立公開快照" (independent snapshot) vs FR-N003's explicit "extend liveState.ts" wording -- the matrix distinguishes the two cases on purpose; (4) convex/canon/schema.ts's canonSnapshots is the in-repo precedent for "a snapshot gets its own table". Reuse without duplication: the payload is the already-validated PublicDynamicProjection from ART-115, narrowed -- no second projection pipeline.

### Phase 1 -- schema
convex/publicRead/schema.ts: add publicRuntimeSnapshots table: schemaVersion(literal 1), worldId, runtimeVersion, snapshotSequence (this table's own monotonic counter, starts at 1, never regresses), sourceRuntimeSequence (Canon-derived, from dynamic.snapshotSequence), status (union 'live'|'paused' ONLY -- delayed/stale must never be persisted, they're read-time derivations, this is what makes AC#4 structurally true), mapId, characterStates (reuse publicCharacterMotionValidator), activeSceneStates (reuse publicActiveSceneValidator), contentUpdatedAt (= dynamic.updatedAt), contentHash, createdAt, observedAt, isCurrent (bool, exactly one true row per worldId). Indexes: by_world_and_current[worldId,isCurrent], by_world_and_sequence[worldId,snapshotSequence]. Do NOT add to TablesToVacuum in convex/crons.ts (vacuum-by-_creationTime would delete a paused world's head).

### Phase 2 -- pure module convex/publicRead/runtimeSnapshot.ts (no Convex import, no clock/randomness read internally)
Constants: RUNTIME_SNAPSHOT_SCHEMA_VERSION=1; PUBLIC_SLOT_MAX_GAP_MS = 6h (mirrors scheduler cadence, duplicated not imported per boundary rule, pinned by a test importing the real scheduler constant); RUNTIME_SNAPSHOT_LIVE_MAX_AGE_MS = 6h; RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS = 12h; RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS = 12h; RUNTIME_SNAPSHOT_STATUSES=['live','paused']; RUNTIME_FRESHNESS=['live','delayed','paused','stale']; RuntimeSnapshotError class.

classifyRuntimeFreshness(input): ordered first-match-wins decision tree:
1. status==='paused' -> 'paused' (intentional state, age irrelevant, paused beats stale)
2. observationAgeMs >= OBSERVATION_MAX_AGE_MS -> 'stale' (heartbeat hasn't run in >=12h, we don't know current status, must not claim live)
3. contentAgeMs < LIVE_MAX_AGE_MS -> 'live'
4. contentAgeMs < DELAYED_MAX_AGE_MS -> 'delayed'
5. else -> 'stale'
Where observationAgeMs = max(0, nowMs-observedAt); effectiveContentAt = sourceRuntimeSequence>0 ? contentUpdatedAt : createdAt (fallback needed because PublicDynamicProjection.updatedAt is 0 for a zero-event world -- without this fallback a freshly-seeded world would wrongly report stale); contentAgeMs = max(0, nowMs-effectiveContentAt).

Types: PublicRuntimeSnapshot, StoredRuntimeSnapshot, RuntimeSnapshotReadStore/RuntimeSnapshotStore interfaces (insertSnapshot/demote/touchObservedAt), PublicRuntimeSnapshotEnvelope (includes freshness, contentAgeMs, observationAgeMs, and a `thresholds` object so the client can re-derive freshness locally as its own clock advances -- required since a Convex query doesn't re-run on the mere passage of time).

Functions:
- hashRuntimeSnapshotContent(input): stable hash over (sourceRuntimeSequence, status, mapId, characterStates, activeSceneStates) -- EXCLUDES all timestamps so a heartbeat on unchanged content dedupes.
- buildRuntimeSnapshot(...): narrows a PublicDynamicProjection into snapshot fields; maps PublicWorldStatus->PublicRuntimeSnapshotStatus: paused->'paused', running->'live', unknown->'paused' (fail-closed: never advertise an unreadable schedule as live).
- commitRuntimeSnapshot(store, {worldId, dynamic, worldStatus, now}): the AC#6 enforcement point. Load current head. Regression guard: if head exists and dynamic.snapshotSequence < head.sourceRuntimeSequence -> return unchanged, reason 'source_regressed' (stops a last-known-good fallback from publishing a backwards runtime sequence). Compute contentHash; if equals head's hash -> touchObservedAt only (heartbeat path, no new row), reason 'deduplicated'. Otherwise nextSequence = (head?.snapshotSequence ?? 0) + 1 (strictly increasing, can never regress); insert new row with isCurrent:true FIRST, then demote old head -- same insert-before-demote ordering as commitReadModelVersion so an insert failure leaves the old head serving.
- serveRuntimeSnapshot(store, worldId, nowMs): loads head, runs classifyRuntimeFreshness, assembles envelope. Read-only.
- assertPublicRuntimeSnapshot(value): field-exact validation mirroring assertPublicDynamicProjection, run on write and read.

### Phase 3 -- convex/publicRead/runtimeSnapshotValidators.ts
Reuses publicCharacterMotionValidator/publicActiveSceneValidator from ART-115's publicDynamicProjectionValidators.ts. Keeps convex/values out of the pure module (same rationale as ART-115).

### Phase 4 -- Convex wiring, new file convex/publicRead/runtimeSnapshotFunctions.ts
- runtimeSnapshotReadStore/WriteStore adapters over ctx.db using the by_world_and_current index.
- getPublicRuntimeSnapshot query({worldId, nowMs?}): reads only publicRuntimeSnapshots (zero canonEvents reads, zero provider calls), returns the envelope or null. nowMs optional-with-Date.now()-default (repo convention).
- captureAllPublicRuntimeSnapshots (internalMutation, no args, cron target): mirrors tickAllPublicSchedules pattern -- query worldSchedules by mode:'public' (both running AND paused), for each world read the live dynamic projection via serveReadModel+selectPublicDynamicProjection, skip if null, call commitRuntimeSnapshot. Returns {worldCount, captured, deduplicated}.

Edit convex/publicRead/liveStateFunctions.ts: at the tail of rebuildLiveProjection (after commitReadModelVersion), when dynamic!==null, call commitRuntimeSnapshot directly (not via ctx.runMutation, so a snapshot failure rolls the whole rebuild back atomically within the same transaction rather than leaving partial writes -- Canon is untouched either way since this transaction writes no Canon at all). Add snapshotSequence to the mutation's return value.

Edit convex/crons.ts: register captureAllPublicRuntimeSnapshots on an hourly interval (12x margin under the 12h observation threshold; costs one touchObservedAt patch per idle world per hour, not a new row, due to content dedup).

Two triggers and why both needed: rebuildLiveProjection capture = content changes (new Canon event); cron = status changes + liveness proof (a pause with no Canon event would otherwise be invisible forever). Neither alone satisfies AC#3+AC#4 together.

### Test plan (AC-by-AC, new file convex/publicRead/runtimeSnapshot.test.ts)
Conventions: Jest ambient globals, in-memory MemoryRuntimeSnapshotStore with insertShouldThrow toggle (copy readModel.test.ts's fake pattern), structural source-scan tests (copy publicDynamicProjection.test.ts's pattern), fixtures from convex/visualRuntime/fixtures.ts fed through buildPublicDynamicProjection.
1: first capture -> snapshotSequence 1, createdAt===observedAt===now, contentUpdatedAt===dynamic.updatedAt, sourceRuntimeSequence===dynamic.snapshotSequence; second distinct capture -> 2; assertPublicRuntimeSnapshot rejects a row missing either field.
2: serveRuntimeSnapshot returns a full envelope from a store with only one committed row, no event log/schedule/runtime context in scope; structural scans of runtimeSnapshot.ts/Validators.ts (no 'canonEvents'/'worldSchedules'/'_generated'/"from 'convex/") and runtimeSnapshotFunctions.ts's getPublicRuntimeSnapshot slice (contains query(, no 'canonEvents'/'mutation'/'identity'/'viewer').
3: table-driven classifyRuntimeFreshness over every branch AND every boundary (paused at age 0 and 10 days both ->paused; observationAge exactly 12h ->stale even at content age 0; contentAge 6h-1ms->live, exactly 6h->delayed, 12h-1ms->delayed, exactly 12h->stale); worldStatus 'unknown'->status 'paused'; sourceRuntimeSequence===0 measures from createdAt not contentUpdatedAt; RUNTIME_FRESHNESS has exactly the 4 PRD values.
4: commit at t0 status:'live', serve at t0+13h -> freshness 'stale' while persisted status is still 'live' (proves classification is read-time never persisted); schema union status:'live'|'paused' cannot express delayed/stale so no write path can persist a lie; envelope always carries thresholds+contentAgeMs+observationAgeMs for client-side re-derivation.
5: structural scans of all 3 new files for canonWriteBoundary.forbiddenSymbols (canonEvents, commitProposedEvent, validateAndCommitProposedEvent, reduceWorldEvent); insertShouldThrow=true -> commitRuntimeSnapshot rejects and pre-existing head still serves unchanged; npm run check:architecture covers the import graph.
6: ten captures mixed distinct/duplicate -> served snapshotSequence non-decreasing after every step; a failed capture between two good ones never drops the served sequence; regression guard test (commit sourceRuntimeSequence 42, then attempt from a stale dynamic with snapshotSequence 7 -> captured:false reason:'source_regressed', head unchanged); duplicate-content heartbeat patches observedAt but leaves snapshotSequence equal.
Guard tests: pin PUBLIC_SLOT_MAX_GAP_MS against the real convex/simulation/scheduler.ts PUBLIC_SLOT_START_MS gaps (test-only import, boundary checker skips test files) so a schedule change fails this test instead of silently mis-classifying; validator/assertion parity test (assertPublicRuntimeSnapshot vs publicRuntimeSnapshotEnvelopeValidator) same pattern as ART-115.

### Docs
New docs/public-runtime-snapshot.md (model on docs/public-dynamic-projection.md): field table, freshness decision tree with exact thresholds and derivation, why status persists only live|paused, the two capture triggers, client-side re-derivation requirement + Convex query reactivity caveat, the new-table-vs-modelKind decision with reasoning.
Update docs/prd-2.0-requirement-matrix.md FR-N007 row (line ~73) to Done.
Update docs/public-dynamic-projection.md with a short cross-reference noting snapshotSequence becomes sourceRuntimeSequence downstream.
Update docs/world-scheduler.md (if it exists -- check first) with a line about the new hourly cron and worldSchedules.status being the sole source of the paused tier.

### Explicit non-goals
Renderer degradation ladder (FR-O010) -- publishes the freshness verdict only, doesn't implement any dimming/badging. Operator pause controls (FR-Q002) -- read-only input, nothing here writes worldSchedules.status. Analytics emission (PRD 17, live_runtime_stale_seen) -- client-side, different task. Spatial ActiveScenePresentation fields (FR-O003/ART-122) -- activeSceneStates carries exactly ART-115's {title,summary,sourceEventIds}, nothing invented. Backfill of historic snapshots -- table starts empty, getPublicRuntimeSnapshot returns null until first capture (same contract as getPublicDynamicProjection).

### Validation
npm run check (architecture, test:architecture, asset-licenses, typecheck, lint, full test suite, build). Regenerate convex/_generated/api.d.ts for the new module and commit the real regeneration (distinguish from stale local codegen drift seen on prior branches).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per the recorded plan: new dedicated Convex table publicRuntimeSnapshots (convex/publicRead/schema.ts) rather than reusing the generic publishedReadModels store -- the freshness clock needs a wall-clock observedAt that updates without content changing, which doesn't fit contentHash-based dedup, and PRD 14.3's two distinct sequence fields (snapshotSequence + sourceRuntimeSequence) don't fit a single per-target version counter. Only 'live'/'paused' are ever persisted as status; 'delayed'/'stale' are computed entirely at read time by classifyRuntimeFreshness() in the new pure module convex/publicRead/runtimeSnapshot.ts, using an ordered decision tree with thresholds (6h live, 12h delayed, 12h observation) derived from and pinned by a test against the real convex/simulation/scheduler.ts PUBLIC_SLOT_START_MS cadence.

Two capture triggers: rebuildLiveProjection (convex/publicRead/liveStateFunctions.ts) now calls commitRuntimeSnapshot directly in-transaction after building the dynamic projection, capturing content changes; a new hourly cron (captureAllPublicRuntimeSnapshots, convex/crons.ts) sweeps all public worldSchedules rows (running and paused) to capture status changes and prove liveness even when no Canon event fires. commitRuntimeSnapshot enforces AC#6 (sequence never regresses) via a regression guard against sourceRuntimeSequence, content-hash dedup that patches observedAt without a new row on unchanged content, and insert-before-demote ordering matching readModel.ts's existing pattern so a write failure leaves the previous head serving. publicRuntimeSnapshots was deliberately NOT added to convex/crons.ts's TablesToVacuum, since vacuum-by-_creationTime would delete a paused world's only row.

Verification evidence (all run and passed on branch feat/ART-116-public-runtime-snapshot, based on main post-ART-115-merge):
- npm run check:architecture -> "Architecture boundaries valid (policy v1, 15 modules)."
- npx tsc --noEmit -> clean
- npm run lint -> clean
- New test file runtimeSnapshot.test.ts -> 79/79 passed (all 6 ACs plus threshold-pinning and content-digest guard tests)
- Full test suite (NODE_OPTIONS=--experimental-vm-modules npx jest) -> 106 suites, 1533 passed, 5 pre-existing skips, 0 failed
- npm run build -> success
- npm run check:asset-licenses / test:asset-licenses -> pass (21/21)
Full npm run check gate is green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Persisted a durable public runtime snapshot (PRD 2.0 section 14.3, FR-N007) on top of ART-115's dynamic projection, with an honest freshness classification the client can display. A new publicRuntimeSnapshots table (its own monotonic sequence, distinct from the Canon-derived sourceRuntimeSequence) is captured from two triggers -- inline after every liveState rebuild for content changes, and an hourly cron sweeping all public worlds (running and paused) for status changes -- so a paused world is still re-observed even with no new Canon event. Freshness (live/delayed/paused/stale) is computed entirely at read time from elapsed-time thresholds derived from the real public-slot cadence; only 'live'/'paused' are ever persisted, so a stored row can never claim to be continuously updating when it is not. Sequence monotonicity across reconnects is enforced by a regression guard plus insert-before-demote commit ordering, mirroring the existing read-model store's failure-safety pattern.

Verified with: architecture check (pass, 15 modules), typecheck (clean), lint (clean), the new test suite (79/79, covering all 6 acceptance criteria plus a guard test pinning the freshness thresholds to the real scheduler cadence), the full test suite (1533/1538 passed, 5 pre-existing skips, 0 regressions), production build (success), and asset-license checks (21/21 pass). Full check gate is green.
<!-- SECTION:FINAL_SUMMARY:END -->
