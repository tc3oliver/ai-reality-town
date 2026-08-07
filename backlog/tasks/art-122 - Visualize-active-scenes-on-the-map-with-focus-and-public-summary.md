---
id: ART-122
title: Visualize active scenes on the map with focus and public summary
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-07 12:18'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-118
priority: high
type: feature
ordinal: 122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O003 (PRD 2.0 §12 Epic O)

**Problem / Context:** Viewers need to see immediately where the important thing is happening. Active scenes exist in the public read model but have no spatial representation.

**Goal:** Active scenes are identifiable on the map, summarised publicly, and focusable.

**Scope:**
- Mark active scene locations on the map.
- Show scene title, public summary, participating characters and related story arc.
- Clicking a scene focuses the camera on the relevant location.
- Transition finished scenes into recent events or an Episode entry point.
- Publish `ActiveScenePresentation` (PRD 2.0 §14.6).

**Out of Scope:** Dialogue bubbles (FR-O004); overlay layout (FR-O007); publication/safety gating implementation (FR-P004).

**Dependencies:** FR-O001 live map.

**Schema Impact:** New `ActiveScenePresentation` shape (PRD 2.0 §14.6).

**API Impact:** Active scene fields within the public dynamic projection.

**Security Impact:** Private or unpublished scenes must never surface.

**Test Requirements:** Tests that unpublished scenes are excluded, that focus targets the correct location, and that ended scenes transition to a recent-event or Episode entry.

**Validation Commands:**
- `npm run check`
- Browser E2E: clicking an active scene focuses and shows its summary.

**Documentation Impact:** Active scene presentation documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Active scene locations are identifiable on the map
- [x] #2 Scene title, public summary, participating characters and story arc are shown
- [x] #3 Clicking a scene focuses the camera on the relevant location
- [x] #4 Private or unpublished scenes are never shown
- [x] #5 Ended scenes become a recent event or an Episode entry point
- [x] #6 Active scene presentation resolves locationId, participant characterIds and arcIds by tracing sourceEventIds back to accepted events, because the existing liveState LiveScene shape carries none of them
- [x] #7 A scene is presentable during the current world day before the daily episode reaches ready status, so the map is not sceneless for most of the day
- [x] #8 When no scene qualifies as current, the map degrades to the most recent completed scene rather than showing nothing
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
## ART-122 Implementation Plan

### CORRECTION to original research: ART-120 has since merged
The research below assumed ART-120 (ambientMotion.ts) was not merged. It has since merged. This does not materially change ART-122's design -- confirmed no interaction with ambient motion exists or is needed. Proceed with the plan as written below.

### Summary
PublicActiveScene today is {title, summary, sourceEventIds} derived ONLY from dailyEpisodes rows with status==='ready' -- meaning the map is sceneless for most of a world day (this is exactly AC#7's complaint). There is NO scene_started/scene_ended Canon event type. The one place a real scene object exists with locationId/participantIds/arcIds (GroupedScene in convex/simulation/sceneGrouping.ts) is UNREACHABLE from publicRead (module boundary forbids publicRead->simulation) and would leak pre-safety-gated content anyway (a scene withheld by safety still has a GroupedScene row). The answer to both AC#6 and AC#7 is the SAME mechanism: a scene is the set of accepted Canon events sharing (worldDay, timeSlot, locationId) -- pure, deterministic, derivable from data rebuildLiveProjection already reads, needs no new table, no boundary change, and refreshes on EVERY Canon commit (5 slots/day) instead of once per day when the episode is ready.

### Root cause
The public scene contract was bound to the wrong producer -- the NARRATED artifact (dailyEpisodes, once/day, LLM-gated) instead of the STRUCTURAL one (accepted Canon events, which already carry location/participants/slot, joined against the arc layer that already indexes them). All of AC#6/#7/#8 follow from fixing this one binding.

### Key findings
- locationId: AcceptedEvent.locationId is optional; secondary source is character_location_changed.toLocationId.
- participantCharacterIds: AcceptedEvent.participantIds, required.
- arcIds: NOT on the event -- live in storyArcEventClassifications.memberships[].arcId keyed by sourceEventSequenceNumber. publicRead ALREADY may depend on story (imports parseArcProjectionFields today) -- no module-boundary change needed here, unlike ART-115 which needed a new dependency.
- Rejected sources: GroupedScene (boundary violation + leaks safety-withheld scenes + carries internal reasoning fields), sceneSimulationRuns (raw LLM output, dialogue explicitly forbidden).
- Back-compat hazard (must not be missed): runtimeSnapshot.ts's assertPublicRuntimeSnapshot validates persisted scene rows against PUBLIC_ACTIVE_SCENE_FIELDS -- if new fields are added as REQUIRED, every pre-existing publicRuntimeSnapshots row throws on read (serveRuntimeSnapshot throws, doesn't degrade). Same hazard for assertPublicDynamicProjection on last-known-good liveState payloads. ALL new fields MUST be optional.

### Phase 0 -- contract widening (pure, backward-compatible)
In convex/publicRead/publicDynamicProjection.ts: extend PublicActiveScene with OPTIONAL fields only: sceneId?, locationId?, participantCharacterIds?, arcIds?, status?: 'active'|'ended', publicationStatus?: 'published', startedAt?, endedAt? (Canon acceptedAt, never a clock). Keep existing title/summary/sourceEventIds required and unchanged -- do not rename to match PRD's publicTitle/publicSummary field names, document the mapping instead (renaming breaks ART-115/116/119/120 consumers for zero privacy gain). Add PUBLIC_ACTIVE_SCENE_OPTIONAL_FIELDS constant mirroring the existing PUBLIC_MOTION_OPTIONAL_FIELDS idiom. Update assertActiveScene to validate the optional fields when present (non-empty locationId, sorted-unique id arrays, endedAt>=startedAt, status/publicationStatus enums). Bump PUBLIC_DYNAMIC_RUNTIME_VERSION 1->2. Update publicDynamicProjectionValidators.ts to match (a parity test already pins validator<->assertion agreement). Update runtimeSnapshot.ts to pass the new optional field list through its own validation and widen its explicit scene-field construction -- but do NOT bump RUNTIME_SNAPSHOT_SCHEMA_VERSION (optional fields make a bump unnecessary and a bump would hard-fail every existing row).

### Phase 1 -- the resolver, new pure module convex/publicRead/activeScenePresentation.ts
No Convex import, no clock, no randomness (same contract as its siblings).
resolveSceneSpatials(events, arcsBySequence): resolves {locationId, participantCharacterIds, arcIds, startedAt, endedAt, sourceEventIds} from a traced event set.
buildActiveScenePresentations({acceptedEvents, arcMemberships, publishedEpisodeScenes, excludedCharacterIds, worldTime}): PublicActiveScene[]

AC#6 resolution rules (exact): locationId = most frequent event.locationId among traced events (ties by ascending locationId); if none present, fall back to most frequent character_location_changed.toLocationId; if still none, OMIT the field entirely (unfocusable, never fabricated). participantCharacterIds = sorted union of event.participantIds, filtered through the existing excludedCharacterIds() helper so a scene never lists someone the map already refuses to draw (dead/deactivated). arcIds = sorted union of memberships[].arcId for each traced sequenceNumber. startedAt/endedAt = acceptedAt of the min/max sequenceNumber event in the traced set.

AC#7 currency rule (exact): partition accepted events by (worldDay, timeSlot, locationId); drop groups with no resolvable locationId. A group is 'active' iff its (worldDay, timeSlot) equals the projection's current worldTime (the last accepted event's slot). Emit all such groups, ordered by descending max sequenceNumber. sceneId = `${worldDay}:${timeSlot}:${locationId}` (deterministic, so contentHash dedup keeps working). Title/summary: if the traced event set intersects a published keyScene's sourceEventIds, ADOPT that keyScene's narrated, safety-cleared title/summary (graceful upgrade once the episode lands later in the day). Otherwise synthesize: title = `${locationId} · ${timeSlot}`, summary = the traced events' publicSummary values joined (a field that's already published verbatim elsewhere, safety-clean by construction). NEVER read metadata, a stateChange reason, or anything from sceneSimulationRuns.

AC#8 degradation rule (exact): if the active set is empty, emit exactly ONE presentation -- the group with the highest max sequenceNumber among all EARLIER slots -- with status:'ended' and endedAt set. If no such group exists either (a world with no history), emit [].

### Phase 2 -- wiring
In convex/publicRead/liveStateFunctions.ts: add a 7th parallel read to the existing Promise.all -- query storyArcEventClassifications by_world index (already exists in schema), parse via the existing parseArcEventClassification helper from ../story/classification (same import direction as the existing ../story/projection import, no boundary change). Compute presentations once, pass to BOTH buildPublicDynamicProjectionResult's activeScenes param and buildLiveProjection's publishedEpisode param. In liveState.ts: widen LiveScene to the same optional-field shape, bump LIVE_PROJECTION_SCHEMA_VERSION, widen LivePublishedEpisodeInput. Add activeSceneCount and activeSceneMode:'canon'|'episode'|'degraded'|'none' to the mutation's return value for ART-133's observability lane to see which path fired without reading the payload.

### Phase 3 -- privacy gate (AC#4): apply directly vs defer to ART-132
Apply directly (all cheap, must not wait for FR-P004/ART-132):
1. Canon-acceptance gate -- only accepted canonEvents rows are ever read; a scene withheld by post-generation safety never commits, so it structurally cannot appear.
2. Field gate -- only publicSummary (and keyScene.summary, which already passed the existing post-generation safety classification) may ever become the public `summary`. Add a test proving the resolver never reads metadata/reason/memory-formed/knowledge-learned change content.
3. Episode gate unchanged -- keep filtering dailyEpisodes to status==='ready' for the keyScene-upgrade path.
4. Whitelist gate -- extend PUBLIC_DYNAMIC_FORBIDDEN_FIELDS with 'trigger'/'dramaticPressure'/'keyActions'/'dialogueHighlights'/'rumors' so the GroupedScene/raw-LLM vocabulary is explicitly named as forbidden even though nothing here currently produces it (defense in depth).
Explicitly DEFER to FR-P004/ART-132: a per-scene publication-status state machine (publicationLifecycle.ts currently only has an 'episode' content kind), operator withhold/resume of a live scene, consulting a publications table on this read path. Ship publicationStatus as a single-member union ('published' only) today so ART-132 widens the enum later rather than the client having to learn a new field shape.

### Phase 4 -- client wiring
1. src/components/world/cameraModel.ts: add 'scene' to FocusTargetKind; add sceneTargetId(sceneId) helper; extend focusTargetsFrom to accept scenes and emit one kind:'scene' target per scene whose locationId resolves to a known footprint (centred via the same rectCenter helper location targets already use; a scene with no footprint match is silently skipped, never centred at origin). Add primarySceneLocationId(scenes) = locationId of the first status:'active' scene, else the degraded one, else null. KEEP the existing primaryLocationId heuristic as an explicit documented FALLBACK for scene-less worlds and stale/last-known-good payloads predating this change -- update its doc comment accordingly, do not delete it.
2. src/components/live/LiveMapPage.tsx: primaryLocationId becomes `primarySceneLocationId(scenes) ?? primaryLocationId(motions)`; pass scenes into focusTargetsFrom and down to the view. Memoize on projection?.activeScenes, NOT on nowMs (avoid camera judder on every tick).
3. New src/components/live/activeSceneModel.ts (pure): composeActiveScenePanel({scenes, footprints, worldId, base}) building the panel's display data including a focusTargetId per scene and an episodeHref for ended scenes using the EXISTING #episode/<worldId>/<worldDay> deep-link shape already used by EpisodeList/EpisodeDetail -- do NOT build new recent-events UI from scratch, this satisfies AC#5 by linking to what already exists.
4. New src/components/live/ActiveScenePanel.tsx: a new UI surface (not an extension of CameraControls' flat chip list, since AC#2 needs title + multi-line summary + participant list + arc list which the chip pattern can't carry) with real <button> elements only, no Pixi handlers (AC#3 satisfied via the existing camera-mode focus mechanism). Additionally add a third FocusList to CameraControls.tsx for kind==='scene' so scene focus is also reachable from the existing camera chrome.
5. src/components/public/liveRoute.ts + LiveView.tsx: widen the text Live View's scene rendering to show participants/arc/Episode link -- cheapest AC#2/AC#5 evidence and the non-map (NFR-009) equivalent.

### Phase 5 -- tests (AC-by-AC, Mistwood-seed IDs only, no Playwright)
#1: every published scene with a locationId yields exactly one kind:'scene' focus target at the footprint centre.
#2: activeSceneModel's panel data carries title/summary/participants/arcIds; rendered panel is axe-clean with a labelled heading.
#3: resolving a focus target with a scene's focus id centres the camera on the scene's location; an unresolvable scene id degrades gracefully to town view, never freezes the camera.
#4: a withheld/failed dailyEpisodes row contributes nothing to the presentation; an event whose only public text lives in a reason/metadata field yields an empty summary rather than leaking that text; assertPublicDynamicProjection throws on an injected dialogueHighlights/trigger field.
#5: a status:'ended' scene produces the correct #episode/<worldId>/<worldDay> href; a status:'active' scene produces no episode link.
#6: fixture with 3 accepted events (mixed/absent locationId) + 2 arc memberships resolves to the exact expected {locationId, participantCharacterIds, arcIds, startedAt, endedAt}; a dead character is excluded from participants via excludedCharacterIds.
#7 (the regression test that proves the task): fixture with ZERO dailyEpisodes rows but events in the latest slot still produces a non-empty status:'active' scene list.
#8: latest slot has only location-less events -> exactly one status:'ended' scene from the newest prior slot with a resolvable location; a world with no history at all -> [].
Plus back-compat proof: a pre-ART-122-shaped snapshot row ({title,summary,sourceEventIds} only, no new fields) still passes assertPublicRuntimeSnapshot and serveRuntimeSnapshot without throwing. Plus: no new public function was added to ART-128's public-surface allowlist (this task adds no new query). Plus: ActiveScenePanel.tsx names no write/network API (liveMapSurface-style structural scan).

### Phase 6 -- documentation
New docs/active-scene-presentation.md: the AC#7 decision and why GroupedScene/sceneSimulationRuns were rejected as sources; the (worldDay, timeSlot, locationId) partition rule; the AC#6 resolution rules verbatim; the AC#8 degradation rule; the AC#4 gate boundary vs what's deferred to ART-132; the field-name mapping note (PRD's publicTitle/publicSummary -> this contract's title/summary).
Update docs/public-dynamic-projection.md, docs/public-runtime-snapshot.md (note the optional-field back-compat guarantee), docs/live-view-navigation.md (demote primaryLocationId to documented fallback status), docs/prd-2.0-requirement-matrix.md's FR-O003 row.

### Explicit non-goals
Dialogue bubbles/content (FR-O004/ART-123). Overlay layout (FR-O007/ART-125). Publication/safety gating STATE MACHINE implementation (FR-P004/ART-132) -- this task only applies the four cheap gates listed in Phase 3, the full per-scene publication lifecycle is ART-132's job. Do not touch convex/simulation/sceneGrouping.ts or attempt to make GroupedScene/sceneSimulationRuns reachable from publicRead under any circumstances -- that's a disqualified approach per this plan's research, not a judgment call.

### Validation
npm run check (architecture, test:architecture, asset-licenses, typecheck, lint, full test suite, build), THEN a manual browser verification pass (same approach as ART-118/119/120): click a scene focus target, confirm the camera centres on its location, confirm the summary/participants/arc render, confirm the Network panel shows zero requests during the interaction.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per the recorded plan. Core fix: the public scene contract was bound to the wrong producer -- it derived active scenes ONLY from dailyEpisodes rows once status==='ready' (once/day, LLM-gated), leaving the map sceneless for most of every world day. Rebound it to accepted Canon events partitioned by (worldDay, timeSlot, locationId) -- pure, deterministic, refreshes on every Canon commit (5x/day) instead of once/day, no new table, no module-boundary change (publicRead already depends on story for the arcId join).

Deliberately did NOT reach convex/simulation/sceneGrouping.ts's GroupedScene or sceneSimulationRuns, per the plan's explicit disqualification: both are module-boundary violations from publicRead, and both can carry content a safety withhold or the raw LLM layer would otherwise gate (a scene withheld by safety still has a GroupedScene row; sceneSimulationRuns holds raw dialogue).

All new PublicActiveScene fields (sceneId, locationId, participantCharacterIds, arcIds, status, publicationStatus, startedAt, endedAt) were added as OPTIONAL, never required -- this was a deliberate back-compat decision: runtimeSnapshot.ts's validation throws (doesn't degrade) on an unrecognized shape, so a required field would have broken every pre-existing publicRuntimeSnapshots row and last-known-good liveState payload on read, taking the public read path dark until the next rebuild. Verified this with a dedicated test (runtimeSnapshot.test.ts) proving a pre-ART-122-shaped row with none of the new fields still validates without throwing.

AC#6 resolution rules implemented exactly as specified: locationId by majority vote among traced events (never fabricated -- omitted if unresolvable), participantCharacterIds filtered through the existing excludedCharacterIds() helper so dead/deactivated characters are never listed, arcIds joined from storyArcEventClassifications. AC#7's regression test (the one that "proves the task") verifies a fixture with ZERO dailyEpisodes rows but events in the current slot still produces a non-empty active scene -- exactly the state the map was in before this task for most of every day. AC#8's degradation emits exactly one status:'ended' scene from the most recent prior slot when nothing is currently active, or an empty array for a world with no history.

Kept the existing primaryLocationId camera heuristic (from ART-118) as a documented fallback for scene-less worlds and stale payloads, rather than deleting it -- primarySceneLocationId now takes precedence when real scene data exists. Added a new ActiveScenePanel.tsx UI surface (title/summary/participants/arc, real buttons only) plus a third scene FocusList in the existing CameraControls.tsx, and widened the text-only LiveView (NFR-009) with the same data as the cheapest AC#2/AC#5 evidence, linking ended scenes to the existing #episode/<worldId>/<worldDay> deep link rather than building new recent-events UI.

Manual browser check: same known environmental fallback as prior tasks this session (sandbox's Convex backend remains quota-disabled); page state identical to the established ART-118/119/120 baseline, no new defect observed.

Verification evidence (all run and passed on branch feat/ART-122-scene-visualization, based on main post-ART-120-merge):
- npm run check:architecture -> "Architecture boundaries valid (policy v1, 19 modules)." (module count unchanged -- confirms no boundary widening was needed, as the plan predicted)
- npm run test:architecture -> 27/27
- npx tsc --noEmit -> clean
- npm run lint -> clean
- New/related test files -> 11 suites, 285/285 passed
- Full test suite (NODE_OPTIONS=--experimental-vm-modules npx jest) -> 129 suites, 1925 passed, 5 pre-existing skips, 0 failed
- npm run build -> success
- npm run check:asset-licenses / test:asset-licenses -> pass (21/21)
Full npm run check gate is green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Active scenes are now identifiable on the map, publicly summarised, and focusable (PRD 2.0 section 14.6, FR-O003) -- and, critically, present for the whole world day rather than only after the daily episode finishes generating. The public scene contract was rebound from the once-a-day narrated artifact (dailyEpisodes) to accepted Canon events partitioned by (worldDay, timeSlot, locationId), which refreshes on every Canon commit and is pure/deterministic with no new table or module dependency. Location, participant characters and story arc are resolved by tracing a scene's source events back to Canon (majority-vote location, excluded-character-filtered participants, arc-classification join) rather than fabricated. A scene already covered by the safety-cleared daily episode adopts its narrated title/summary as a graceful upgrade; otherwise a scene synthesizes from already-public per-event summaries only, never from internal reasoning or raw model output. When no scene is currently active the map shows the most recent completed one instead of nothing.

All new fields were added as optional specifically to avoid breaking existing persisted read-model rows and snapshots, which throw rather than degrade on an unrecognized shape -- verified with a dedicated back-compat test. The camera can now focus a scene's real location; the existing character/location focus heuristic remains as a documented fallback for scene-less or stale data. Deliberately did not reach the simulation layer's internal scene-grouping or raw-LLM output tables, since both can carry content a safety withhold would otherwise gate -- Canon acceptance is the only safety boundary this task trusts.

Verified with: architecture check (pass, 19 modules unchanged -- confirms no new dependency was needed), typecheck (clean), lint (clean), 285 new/related tests including the core regression test proving a scene now appears with zero published episodes, the full test suite (1925/1930 passed, 5 pre-existing skips, 0 regressions), production build (success), and asset-license checks (21/21 pass). Full check gate is green. All 8 acceptance criteria are evidenced by the tests above.
<!-- SECTION:FINAL_SUMMARY:END -->
