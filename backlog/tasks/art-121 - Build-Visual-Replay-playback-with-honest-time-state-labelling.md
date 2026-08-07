---
id: ART-121
title: Build Visual Replay playback with honest time-state labelling
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-07 15:10'
labels:
  - prd-2.0
  - v2-g
  - epic-o
dependencies:
  - ART-119
priority: high
type: feature
ordinal: 121000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O013, FR-O014 (PRD 2.0 §12 Epic O, §9.1.4, §10.4)

**Problem / Context:** A viewer arriving between Canon slots sees a world where nothing recently happened. PRD 2.0 §9.1.4 replays the most recent completed scenes from existing data. RISK2-009 warns that replay mistaken for live would corrupt the product's core honesty promise.

**Ownership boundary (review correction):** This task owns the replay schema, construction and playback mechanics only. It does **not** own publication lifecycle integration — withhold/supersede detection and replay invalidation/rebuild triggered by a safety or publication status change is **ART-132's** responsibility (ART-132 depends on this task's schema). This task's scope ends at defining the reference-only payload shape (`publicExcerptId`/`publicSummaryId` + `publicationVersion`) that makes ART-132's invalidation possible.

**Goal:** On entering `/live`, replay the most recent important scenes from existing Canon data, then return to the current ambient state, with the time state always unambiguous.

**Scope:**
- Build `VisualReplay` (PRD 2.0 §10.4) from accepted events, start/end positions, scene summaries, participants, public dialogue highlights and arc progress.
- Playback of 1–3 recent important scenes, roughly 20–60 seconds each, then return to ambient.
- Auto-play at most once per viewing session; manual "replay today" control; always skippable; never loops.
- Persistent time-state labelling distinguishing replay, earlier and now, not by colour alone.
- `dialogue`/`eventCard` steps reference `publicExcerptId`/`publicSummaryId` plus `publicationVersion` — no free-text copies.

**Out of Scope:** Generating any new narrative content; scene visualization of the live active scene (FR-O003); publication-status change detection and invalidation/rebuild triggering (ART-132).

**Dependencies:** FR-O002 Canon-driven movement rendering (ART-119).

**Schema Impact:** New `VisualReplay` derived payload (PRD 2.0 §14.7).

**API Impact:** Public read of replay payloads; strictly derived from already-published data.

**Security Impact:** Replay may only include already-published, safety-approved text; it must trigger no LLM call and no Canon write. The reference-only shape is what makes ART-132's invalidation possible — storing free text would defeat it.

**Test Requirements:** Replay construction tests from fixed event fixtures; an integration test asserting replay adds no LLM trace and no accepted event; session auto-play-once tests; skip and manual-trigger tests; a test that no step stores literal dialogue or summary text.

**Validation Commands:**
- `npm run check`
- Browser E2E: replay auto-plays once, then the view enters the ambient state.

**Documentation Impact:** Replay semantics and time-state labelling documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Entering /live replays one to three recent important scenes of roughly twenty to sixty seconds each
- [x] #2 Playback finishes by returning to the current ambient state
- [x] #3 Replay uses only existing accepted events and already-published summaries
- [x] #4 Replay triggers no LLM call, no re-simulation, no new event and no Canon change
- [x] #5 A given replay auto-plays at most once per viewing session
- [x] #6 Viewers can manually trigger a replay of today events
- [x] #7 Replay never loops or repeats automatically
- [x] #8 Replay can be skipped at any time to reach the current state
- [x] #9 The screen always distinguishes replay, earlier and now, and not by colour alone
- [x] #10 Replay dialogue and eventCard steps reference publicExcerptId or publicSummaryId plus publicationVersion and never store a free-text copy
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
## ART-121 Implementation Plan

### Real dependency correction
Backlog lists ART-121's dependency as ART-119 only, but this task genuinely depends on ART-122 (convex/publicRead/activeScenePresentation.ts's scene-grouping machinery must be reused, not rebuilt). ART-122 is now merged to main -- this branch has already been synced with it, so proceed.

### Drive-by fix while touching convex/publicRead/activeScenePresentation.ts (Phase 1 below touches this file anyway)
Found: `const KEY_SEPARATOR = '<a literal raw NUL byte>'` on line 127 -- a literal NUL byte was embedded directly in the source file instead of the `\0` escape sequence. This is functionally identical (same character) but makes the file register as "binary" to git/file tools, breaking diff readability. Since this task's Phase 1 already edits this exact file, replace the raw byte with the `\0` escape sequence as a trivial one-line drive-by fix. Do not touch anything else about the key-separator design (it correctly mirrors ART-114's NUL-delimited ambientSeedKey pattern to prevent id-component collision).

### Summary
Build ONE new pure server module (convex/publicRead/visualReplay.ts) storing a text-FREE VisualReplay structure under a new read-model kind, plus ONE new anonymous public query resolving text references at READ time (never stored), plus a CLIENT playback state machine that synthesizes ephemeral PublicCharacterMotion units with motionType:'replay' and feeds them through the already-built composeReadOnlyWorldViewModel (ART-119/120) -- no parallel rendering path.

### Two genuine design decisions, both resolved
1. motionType:'replay' CANNOT flow through the live public projection contract: (a) one-motion-per-character is enforced there and replay needs several motions per character over time; (b) the live contract uses absolute timestamps but replay needs relative durationMs (playback start is per-viewer, client-local); (c) publishing replay positions into the live `characters` array would be the exact RISK2-009 failure (replay mistaken for live). Resolution: the CLIENT synthesizes PublicCharacterMotion-shaped units locally (relative durationMs + local playbackStartMs -> absolute startedAt/arriveAt) and feeds them to the existing renderer. Ambient motion is ALREADY suppressed during replay with zero new code (ART-120's ambientMotion.ts already excludes 'replay'/'canon' motion types from ambient overlay).
2. AC#10's reference scheme needs NO new versioned-content subsystem -- convex/editorial/schema.ts's publicationRecords table already IS exactly that (addressable contentRef, monotonic version, withheld/superseded statuses, driven automatically by the existing post-commit pipeline). publicRead already may depend on editorial (already imports parseArcProjectionFields-adjacent story data). What does NOT exist: any versioned unit for dialogue text specifically -- that's ART-123's (FR-O004) job. So: eventCard steps are producible today; dialogue steps are declared in the type/validators but never produced, following the exact same "declared but dormant" pattern this codebase already uses for motionType:'replay' and 'ambient' before their owning tasks landed.

### Phase 1 -- export ART-122's scene machinery for reuse (do not rebuild it)
In convex/publicRead/activeScenePresentation.ts: change groupEvents from module-private to exported groupSceneEvents(events); export the SceneGroup type. Export narrationFor as narrationForEvents (replay needs the same "which key scene covers these events" join -- duplicating the rule would let the two drift). Extend SceneArcMembership with an optional importance field (already derivable from storyArcEventClassifications the same way rebuildLiveProjection already reads it). No behavior change -- activeScenePresentation.test.ts must still pass unmodified. Plus the KEY_SEPARATOR drive-by fix noted above.

### Phase 2 -- pure VisualReplay derivation module, new file convex/publicRead/visualReplay.ts
No Convex import, no clock, no randomness (same three-property contract as publicDynamicProjection.ts/activeScenePresentation.ts/runtimeSnapshot.ts).

Constants: VISUAL_REPLAY_SCHEMA_VERSION=1, REPLAY_MIN_SCENES=1, REPLAY_MAX_SCENES=3, REPLAY_SCENE_MIN_MS=20_000, REPLAY_SCENE_MAX_MS=60_000, REPLAY_EVENT_CARD_MS=4_000, REPLAY_STEP_TYPES=['move','wait','dialogue','eventCard'], REPLAY_TEXT_REF_KINDS=['episodeScene','canonEventSummary','publicExcerpt'].

Types: ReplayPoint, ReplayParticipant{characterId,startPosition,endPosition}, ReplayMoveStep{type:'move',characterId,to,durationMs}, ReplayWaitStep{type:'wait',durationMs}, ReplayDialogueStep{type:'dialogue',characterId,refKind:'publicExcerpt',publicExcerptId,publicationVersion,durationMs} (declared, never produced by this task), ReplayEventCardStep{type:'eventCard',refKind:'episodeScene'|'canonEventSummary',publicSummaryId,publicationVersion,durationMs}, ReplayStep = union of the four, ReplayScene{sceneId (reuses ART-122's `worldDay:timeSlot:locationId` format), worldDay, timeSlot, locationId, sourceEventIds, participants, steps, durationMs (clamped to [MIN,MAX])}, VisualReplay{schemaVersion, replayId (`replay:<worldId>:<lastSourceSequenceNumber>`, deterministic), worldId, worldDay, timeSlot, sourceEventIds (sorted union), scenes, totalDurationMs}.

Address formats for AC#10: episodeScene -> publicSummaryId=`episode:<worldId>:<worldDay>#scene:<index>`, publicationVersion = the current publicationRecords version for that contentRef; emitted ONLY when the episode is ready AND the publication record status is ready/published. canonEventSummary -> publicSummaryId=`canonEvent:<eventId>`, publicationVersion=1 constant (Canon events are append-only/never edited, so this is immutable by construction -- record this as a documented partial-lifecycle limitation, with the upgrade path noted as ART-132's to build if it ever needs withhold support for individual canon-event summaries). publicExcerpt (dialogue) -- reserved, never produced; ART-123 owns building the excerpt store this would reference.

Builder buildVisualReplay(input): 
1. Group accepted events via groupSceneEvents; DROP groups whose (worldDay,timeSlot) equals the LATEST accepted event's -- replay only shows COMPLETED slots, never the current one (this is what prevents RISK2-009 at the data-selection level).
2. Score each surviving group by max(importance) across its events, tie-broken by descending max sequenceNumber then ascending sceneId (deterministic).
3. Take the top REPLAY_MAX_SCENES groups; replay them in ASCENDING chronological order (must read forwards, not present most-recent-first).
4. Return null when zero groups survive (per PRD: replay build failure means skip straight to ambient state, not an error state).
5. Per scene: resolveSceneSpatials (reused from ART-122) gives participants/arcs/sourceEventIds. Fold character_location_changed events to find each participant's position immediately before the scene's first event (startPosition, via the existing bootstrapAnchor helper from convex/visualRuntime/seedBootstrap.ts resolved against the pre-scene location) and immediately after the last event (endPosition). A participant with no resolvable binding is DROPPED, never guessed.
6. Steps: one 'move' step per participant that actually moved (durationMs from the existing travelDurationMs helper over tile distance), then one 'eventCard' step per event whose text reference resolves, REPLAY_EVENT_CARD_MS each.
7. Duration fitting: if total < MIN, append one 'wait' step for the remainder; if total > MAX, drop trailing wait steps first, then proportionally scale every move/eventCard duration (rounded) -- NEVER drop an eventCard, that would silently drop content.
8. assertVisualReplay(replay) before returning -- field-allowlist validation in the exact style of assertPublicDynamicProjection, with a REPLAY_FORBIDDEN_FIELDS list containing text/summary/title/content/excerpt/dialogue/body/caption PLUS every name already in PUBLIC_DYNAMIC_FORBIDDEN_FIELDS.

### Phase 3 -- validators, read-model kind, rebuild wiring
New convex/publicRead/visualReplayValidators.ts mirroring publicDynamicProjectionValidators.ts (visualReplayValidator, a v.union replayStepValidator over the four step shapes).
Add 'visualReplay' to the modelKind union in convex/publicRead/schema.ts and convex/publicRead/readModel.ts's READ_MODEL_KINDS. Rationale for a SEPARATE model kind rather than nesting inside liveState: isolates replay-build failure from the live map per PRD's failure-handling spec, keeps contentHash dedup tight for both (replay changes only when a slot completes; the live projection changes on every commit), and gives ART-132 a one-call invalidation hook via the existing invalidateReadModel function.
In liveStateFunctions.ts's rebuildLiveProjection (reusing already-collected canonRows/episodeRows/classificationRows, no extra reads beyond a parallel publicationRecords query by the by_world_and_status index folded into a contentRef->{version,status} map): wrap buildVisualReplay in a try/catch yielding null on any throw (matching the existing failure-isolation idiom already used elsewhere in this function); if non-null, commitReadModelVersion with modelKind:'visualReplay', modelRef:`replay:<worldId>`, sourceEventIds from the replay. Add replaySceneCount/replayVersion/replayBuildFailed to the mutation's return for observability.

### Phase 4 -- public query and read-time text resolver
New convex/publicRead/visualReplayFunctions.ts: getPublicVisualReplay query({worldId}) -> serveReadModel through the visualReplay model kind (inherits last-known-good fallback automatically), re-validate via selectVisualReplay (a payload from an older contract yields null, never throws). RESOLVE TEXT AT READ TIME, NEVER AT BUILD TIME: collect distinct text refs from the replay (a pure helper), then for episodeScene refs point-read the current publicationRecords row and the dailyEpisodes row, emitting text ONLY if the record's version matches the step's publicationVersion exactly AND its status is ready/published AND the episode itself is ready; for canonEventSummary refs, point-read the CURRENT liveState read model (not raw canonEvents -- no table scan from the public read path) and look the eventId up in its already-published recentEvents array. Return {replay, texts: [{publicSummaryId, publicationVersion, text}]} -- an unresolved ref is simply ABSENT from texts (client renders a safe generic placeholder), never a stored/cached copy. This absence-on-mismatch behavior is what makes ART-132's future invalidation actually work without this task building the invalidation itself.
Register in architecture/module-boundaries.json's publicFunctionSurface.allowed as {kind:'query', gate:'anonymous'}. Add the module to the static MODULES map in convex/publicRead/publicReadOnlyGuarantee.test.ts (required or that suite's registered() helper throws) -- this automatically brings the new query under ART-128's enumeration and visibility-flag assertions.

### Phase 5 -- client pure playback modules (no React, no DOM, no clock reads inside the pure logic)
New src/components/live/replayPlayback.ts: ReplayPlaybackState{phase:'idle'|'playing'|'finished', playbackStartMs, replayId}; beginReplay/skipReplay/advanceReplay total transition functions (advanceReplay: playing->finished at the end, NEVER finished->playing on its own -- only beginReplay can restart); replayFrame(replay, state, nowMs) synthesizing the current PublicCharacterMotion[] for whichever scene/step is active, with motionType:'replay', semanticLocationId=scene.locationId, animationState 'walking' during a move step else 'idle', motionSequence strictly increasing per character across the whole replay so the existing latestMotionPerCharacter picks the right unit, reusing interpolatedTile/motionProgress UNCHANGED. NO NEW TIMERS -- auto-advance is derived from nowMs against cumulative scene-boundary offsets, driven by the EXISTING useMotionClock rAF tick (keeps the existing "mounts no polling timer" structural test true).
New src/components/live/replaySession.ts (AC#5, client-only, must never touch the server): sessionStorage-backed (not localStorage -- a browser tab session IS the "viewing session" the AC means, and there is no server-side session/identity concept anywhere in this read-only architecture, confirmed). Keyed by replayId (which embeds the last source sequence number, so a new completed Canon slot produces a new replayId and legitimately auto-plays again). hasAutoPlayed/markAutoPlayed take an injectable StorageLike parameter for unit-testability. FAIL CLOSED: a throwing or absent storage is treated as "already played" so "at most once" can never be violated by a storage failure (Safari private mode, jsdom, etc).

### Phase 6 -- client wiring
New src/components/live/publicVisualReplayRef.ts mirroring the existing publicDynamicRef.ts pattern.
In LiveMapPage.tsx: add a second useQuery for the replay ref (this will need liveMapSurface.test.ts's "exactly one useQuery" assertion updated to two, with both refs named explicitly -- keep the "no other file reads anything" sweep intact). Add replay playback state. Auto-play effect fires once when a replay exists, reducedMotion is false, and hasAutoPlayed is false -- then marks it played. REDUCED MOTION DISABLES AUTO-PLAY (the manual "replay today" button stays available regardless). advanceReplay is called inside the EXISTING interpolation useMemo on nowMs, no new effect/timer. When a replay frame is active, pass its synthesized motions to composeReadOnlyWorldViewModel IN PLACE OF the live projection's characters, and force the camera focus to the replay's current scene location. When it returns to null, motions and camera revert to the live projection automatically -- this satisfies AC#2 with no new rendering path.
New src/components/live/ReplayControls.tsx: real `<button>` elements only ("跳過重播" during playback, "重播今日事件" when idle/finished), each a plain useState setter one level up, no href, no request API -- same pattern as the existing CameraControls.tsx.
Update LiveMapView.tsx to accept and render the replay frame/texts/controls alongside the existing canvas -- ReadOnlyWorld's own props stay unchanged (still no on* prop anywhere, keeping the canvas-is-mute assertion intact).

### Phase 7 -- time-state labelling (AC#9, not by colour alone)
New src/components/live/timeStateLabel.ts (pure): TIME_STATES=['replay','earlier','now']; TimeStateBadge{state, label (visible text: '重播'/'稍早'/'現在'), glyph (aria-hidden shape symbol, distinct per state), detail (contextual text), announcement (full sentence for screen readers)}; composeTimeStateBadges() as a total function of the current replay frame (or its absence) plus world-day/time-slot context.
New src/components/live/TimeStateBanner.tsx: a `<section role="status" aria-live="polite">` rendering all three rows during replay (per PRD's three-line spec), collapsing to just the "現在" row otherwise. Each row carries a data-time-state attribute, the visible label text, an aria-hidden glyph, and detail text -- text and shape both carry the distinction, never colour alone. Add a distinct border style per state (solid/dashed/double) in CSS in addition to any hue, so it remains distinguishable in greyscale.
Follow the existing accessibility conventions this session already established (ART-116's live/delayed/paused/stale vocabulary, ART-119's reduced-motion patterns) -- check docs/accessibility.md for the established test-project split and non-colour-state conventions before designing new patterns.

### Phase 8 -- tests (AC-by-AC, Mistwood-seed IDs only, no Playwright)
#1: fixtures produce 1-3 scenes, each duration within [20000,60000]ms; clamps to 3 with more candidate groups available; null with no completed slot available.
#2: advanceReplay at start+totalDuration -> finished; replayFrame returns null once finished; the composed view model at that point equals the live (non-replay) one exactly.
#3: import-closure test (modelled on ART-120's ambientMotion.boundary.test.ts) proving visualReplay.ts's dependency closure touches nothing under convex/simulation/, convex/safety/, convex/observability/; a scene whose publication record is withheld/superseded/version-mismatched yields NO episodeScene text reference resolving (tested at the read-time resolver, not the builder).
#4: source-scan proving visualReplay.ts names no canonWriteBoundary.forbiddenSymbols, no ctx.db, no fetch, no provider import; an integration test running rebuildLiveProjection twice over a fixture leaves canonEvents count and llmTraces count identical.
#5: false->markAutoPlayed->true; a different replayId is false; a throwing storage setItem yields hasAutoPlayed===true (fail-closed); no localStorage reference anywhere in the module.
#6: beginReplay from 'finished' transitions to 'playing' with a fresh start time; the session flag is untouched by a manual replay (still counts toward auto-play-once bookkeeping per the plan's design -- verify against the exact PRD wording during implementation); a button labelled "重播今日事件" exists and is clickable.
#7: exhaustive transition-table test -- no input other than beginReplay ever leaves the 'finished' state; advancing far past the end stays 'finished', never wraps.
#8: skipReplay from every (sceneIndex, elapsed) combination transitions to 'finished'; the skip button is present and interactive throughout playback.
#9: all three time-state badges have non-empty, mutually distinct label text AND distinct glyph AND distinct data-time-state attribute; a test stripping all class/style from rendered markup still shows the three rows distinguishable by text alone; axe-clean; role="status" present.
#10: deep-walk every step in every built replay fixture asserting no string value anywhere equals or contains any fixture's summary/dialogue source text; dialogue/eventCard steps carry exactly their allowlisted keys and nothing else; REPLAY_FORBIDDEN_FIELDS names appear at no depth in any built replay; a dedicated test asserting buildVisualReplay never emits a 'dialogue'-type step (since ART-121 never produces one).
Surface tests: extend publicReadOnlyGuarantee.test.ts to enumerate the new query, confirm isQuery&&isPublic, confirm it's in the public function surface allowlist. Update liveMapSurface.test.ts for the two-useQuery reality, still no setInterval, ReadOnlyWorld still takes no on* prop.

### Phase 9 -- documentation
New docs/visual-replay.md: scene-selection rule, duration-fitting algorithm, the reference-only contract in full (address formats, why canonEventSummary's publicationVersion is constant, why dialogue is declared-but-dormant, the resolver's version-and-status gate), the client playback state machine, the session-once mechanism, the time-state vocabulary, and an explicit hand-off list naming what ART-132 still needs to build (per-scene withhold/supersede invalidation).
Update docs/accessibility.md (the time-state banner + reduced-motion auto-play suppression), docs/live-view-navigation.md (replay controls + camera behavior during playback), docs/public-dynamic-projection.md (record that motionType:'replay' is now produced client-side only, still unreachable from the server publisher), docs/prd-2.0-requirement-matrix.md (FR-O013/FR-O014 rows).

### Explicit non-goals
Generating any new narrative content -- no LLM call anywhere on this path, enforced structurally and tested (AC#4). Live active-scene visualization -- FR-O003/ART-122, already done, only its grouping helpers are reused. Publication-status change detection, replay invalidation/rebuild on withhold or supersede -- FR-P004/ART-132's job; this task ships only the reference shape and version-gate that make that future work possible. Dialogue presentation and any published dialogue-excerpt store -- FR-O004/ART-123. Replay play/skip-rate metrics -- ART-133's observability lane, not this task. Formal browser E2E -- ART-137.

### Validation
npm run check (architecture, test:architecture, asset-licenses, typecheck, lint, full test suite, build), THEN a manual browser verification pass (same approach as prior tasks this session): confirm a replay auto-plays once on first visit, shows the three time-state labels, can be skipped, never loops, and returns cleanly to the ambient/live state; confirm the manual "replay today" button works after auto-play has already fired; confirm the Network panel shows zero mutation traffic throughout.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Session resumed after a prior executor exhausted its budget mid-implementation. On resume, all core modules (Phases 1-7 of the implementation plan) were already present and typechecked cleanly, but `npm run check` had two failures fixed in this session:

1. Lint: `visualReplay.test.ts` used `JSON.parse(JSON.stringify(...))` (typed `any`) to mutate a built replay for the "smuggled text" and "durations don't add up" tests, tripping `@typescript-eslint/no-unsafe-assignment`/`no-unsafe-member-access`. Fixed by introducing a local `MutableReplay` type and casting the parsed JSON to it (same pattern `readModel.test.ts` already used with `as JsonValue`).
2. Test: `publicReadOnlyGuarantee.test.ts`'s exhaustive client-reachable-surface assertion (AC#1 of FR-O009/ART-128) still listed only the two pre-existing public refs; the new `publicRead/visualReplayFunctions:getPublicVisualReplay` ref (already correctly wired into the MODULES map and the public function surface allowlist) was missing from the expected list. Added it plus an `isQuery` assertion.

After those two fixes, `npm run check` was fully green (architecture, test:architecture, asset-licenses, typecheck, lint, full jest suite, build).

Gap found during finalization: AC#5 (session auto-play-once) and AC#9 (time-state banner, not by colour alone) had shipped implementation but no dedicated behavioural test evidence -- `replaySession.ts` and `timeStateLabel.ts`/`TimeStateBanner.tsx`/`ReplayControls.tsx` were only touched by `liveMapSurface.test.ts`'s structural source-scan, not by a test that exercises their actual behaviour. Per the finalization workflow ("check only ACs the verification evidence proves"), added:
- `src/components/live/replaySession.test.ts` -- hasAutoPlayed/markAutoPlayed round-trip, per-replayId independence, fail-closed on throwing/read-only/absent storage.
- `src/components/live/timeStateLabel.test.ts` -- pure badge composition: live-only single badge, three-badge playback state, mutually distinct label/glyph/state, text-only distinguishability after stripping.
- Extended `src/components/live/liveMap.a11y.test.tsx` with rendered-markup, axe-clean coverage for `ReplayControls` (AC#6/#8: correct button per phase, accessible name) and `TimeStateBanner` (AC#9: role=status/aria-live=polite, three distinct rows during playback with distinct label+glyph+data-time-state, and a stripped-markup check that the rows stay distinguishable by text alone).

Wrote the Phase 9 documentation the implementation plan called for: new `docs/visual-replay.md` (scene selection, duration fitting, the reference-only contract and its address formats, the read-time resolver's version-and-status gate, the client playback state machine, session-once mechanism, time-state vocabulary, and the explicit ART-132 hand-off list); added FR-O013/FR-O014 sections to `docs/accessibility.md` (§4.7) and `docs/live-view-navigation.md`; corrected the now-stale "motionType:'replay' is never produced" and "exactly one useQuery" claims in `docs/public-dynamic-projection.md` and `docs/live-view-navigation.md` respectively; updated the FR-O013/FR-O014 rows and the ART-133 pending_feature footnote in `docs/prd-2.0-requirement-matrix.md`.

Verification: `npm run check` green end to end (architecture boundaries, architecture unit tests, asset licenses, typecheck, lint, full jest suite -- 135 suites / 2011 tests passed, 5 pre-existing skips unrelated to this task -- and production build). No browser E2E was performed (out of scope per the task's own Validation Commands note and ART-137's ownership of that deliverable); the Convex deployment was not reachable in this environment to do a manual `/live` pass, consistent with the same limitation recorded in prior ART-118/ART-119/ART-121-planning session notes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built Visual Replay (FR-O013) and honest time-state labelling (FR-O014): on entering /live, the map replays the 1-3 most recent completed important scenes from already-accepted Canon events and already-published summaries, then returns to the live ambient state, with a persistent role=status banner that always distinguishes replay/earlier/now by text+glyph+border-style, never colour alone.

Server: convex/publicRead/visualReplay.ts derives a text-free VisualReplay (dialogue/eventCard steps carry only publicSummaryId/publicExcerptId + publicationVersion, never literal text); convex/publicRead/visualReplayFunctions.ts resolves text at read time behind a version-and-status gate (a withheld/superseded/re-versioned reference resolves to nothing, never a stale copy); wired into rebuildLiveProjection as an isolated 'visualReplay' read-model kind. Client: replayPlayback.ts synthesizes PublicCharacterMotion units locally from relative durations and feeds them through the existing renderer (no parallel rendering path, no new timers); replaySession.ts fails closed for the once-per-session auto-play guarantee; timeStateLabel.ts/TimeStateBanner.tsx/ReplayControls.tsx complete the client wiring in LiveMapPage.tsx.

Verified: `npm run check` green end to end (architecture, architecture tests, asset licenses, typecheck, lint, full jest suite -- 135 suites / 2011 tests -- and production build). All 10 acceptance criteria have direct automated test evidence, including AC#5 and AC#9 which needed new dedicated tests (replaySession.test.ts, timeStateLabel.test.ts, and an extension to liveMap.a11y.test.tsx) added during finalization since they had shipped code but only structural surface-scan coverage. Documentation updated: new docs/visual-replay.md, plus accessibility.md/live-view-navigation.md/public-dynamic-projection.md/prd-2.0-requirement-matrix.md. No browser E2E performed -- out of scope (ART-137) and the Convex deployment was not reachable in this environment for a manual pass.
<!-- SECTION:FINAL_SUMMARY:END -->
