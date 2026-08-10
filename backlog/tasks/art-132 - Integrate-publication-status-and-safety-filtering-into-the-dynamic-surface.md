---
id: ART-132
title: Integrate publication status and safety filtering into the dynamic surface
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 15:59'
updated_date: '2026-08-10 11:29'
labels:
  - prd-2.0
  - v2-h
  - epic-p
dependencies:
  - ART-115
  - ART-121
  - ART-122
priority: critical
type: feature
ordinal: 132000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-P004 (PRD 2.0 §12 Epic P)

**Problem / Context:** The dynamic layer introduces new public text surfaces — bubbles, scene cards, overlay — each a path by which unapproved or withheld content could reach viewers. Removing text must not disturb Canon or character positions.

**Goal:** Every public text on the dynamic surface is provably published and safety-approved, and withholding text never corrupts world state.

**Scope:**
- Live overlay shows only published, publicly permitted content.
- Withheld scenes show only a safe generic state or are hidden entirely.
- Safety status updates propagate to remove content from the public projection.
- Removing public text leaves Canon and character positions intact.
- Every public text traceable to an accepted event or published summary.

**Out of Scope:** The safety classifier itself (PRD 1.0, delivered); dialogue presentation (FR-O004).

**Dependencies:** FR-N003 public dynamic projection; FR-O003 active scene visualization.

**Schema Impact:** Publication status carried on public presentation records.

**API Impact:** Projection filters by publication status.

**Security Impact:** Primary content-safety gate for the new dynamic surface.

**Test Requirements:** Tests that withheld content never publishes, that a safety status change removes already-published text, that removal does not alter Canon or positions, and traceability of every public string.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Publication and safety integration notes for the dynamic layer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The live overlay shows only published and publicly permitted content
- [x] #2 Withheld scenes show only a safe generic state or are hidden entirely
- [x] #3 A safety status update removes the affected content from the public projection
- [x] #4 Removing public text does not affect Canon or character positions
- [x] #5 Every public text is traceable to an accepted event or a published summary
- [x] #6 A withhold or supersede of published content invalidates or rebuilds every Visual Replay referencing it, verified by test
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
1. Stamp scene provenance onto committed events: in worldDayLive.ts simulate_scenes stage, set metadata.sceneId = result.scene.sceneId on every proposed event before validate_structured_output/commit discards the scene link. Mirror in fakeSceneNarrator.ts sceneProposedEvent for the deterministic fixture path. Extend SceneEventLike (activeScenePresentation.ts) with optional sceneId, sourced from metadata.sceneId where SceneEventLike rows are built in liveStateFunctions.ts.

2. Append-only safety-status override ledger: new table safetyStatusOverrides in convex/safety/schema.ts { worldId, classificationId, label, reason, actor, createdAt }, indexed by_world_and_classification. Original postGenerationSafetyClassifications rows stay immutable (preserves existing dedup/conflict invariant). Pure helper resolveEffectiveSafetyLabel(classification, overrides) in postGeneration.ts: latest override wins, else original label. New internal query getEffectiveSafetyLabels(worldId, sceneIds[]).

3. Operator override mutation in convex/safety (new overrideFunctions.ts): overridePostGenerationSafetyLabel, gated by requireOperator('safety.override') as first statement (same pattern as canonCorrectionFunctions.ts), args { worldId, classificationId, label, reason }. Appends override row + operatorAuditLog entry, then calls rebuildLiveProjection for that world (mirrors canon correction's refresh-port pattern) so the change propagates to the public projection immediately.

4. Filter dynamic surface at build time: buildActiveScenePresentations (activeScenePresentation.ts) gains optional sceneSafetyLabels lookup; a scene group whose events resolve to an effective 'withhold' label is excluded from activeScenes output. rebuildLiveProjection (liveStateFunctions.ts) fetches effective labels for the day's scene ids and threads them through. Character/position projection (toPublicCharacterMotion) is a separate code path, untouched by construction (AC#4) -- add explicit regression test asserting characters output is byte-identical when a scene is withheld.

5. Visual Replay canonEventSummary gate: extend resolveReplayTexts (visualReplayFunctions.ts) canonEventSummary branch to also consult the effective safety label for the source event's sceneId (in addition to the existing recentEvents-window check) and drop the text if withheld -- same pattern already used for episodeScene refs' publication-version gate (AC#6).

6. Tests: extend activeScenePresentation.test.ts / publicDynamicProjection.test.ts (withheld scene absent from output, characters untouched), visualReplayFunctions.test.ts (withheld canonEventSummary ref drops), new tests for the override ledger (override supersedes original label, audit trail intact, original classification row never mutated), and an integration-style test through rebuildLiveProjection verifying override leads to immediate projection change without touching Canon.

Open decision pending user input: when a scene is withheld, hide it entirely from activeScenes (simpler, matches existing withheld-episode precedent) vs keep a placeholder entry with a generic summary and a widened PUBLIC_ACTIVE_SCENE_PUBLICATION_STATUSES including 'withheld' (matches forward-looking comment already in publicDynamicProjection.ts). Recommending the placeholder approach pending confirmation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design decisions confirmed with user: (1) new append-only safetyStatusOverrides ledger + requireOperator-gated mutation that triggers immediate rebuildLiveProjection, per plan step 2-3. (2) withheld scenes render as a safe generic placeholder (publicationStatus: 'withheld') rather than being hidden entirely -- widen PUBLIC_ACTIVE_SCENE_PUBLICATION_STATUSES to include 'withheld' in step 4.

## Delivered

The missing piece was not the gate but the JOIN: post-generation classifications are keyed on a Scene id (sourceId), the public projection is built from accepted Canon events, and events carried no link back to their Scene. So provenance came first.

1. Scene provenance. `withSceneProvenance` (worldDayLive.ts) stamps `metadata.sceneId` onto every proposal inside `simulate_scenes`, the last stage where a SceneSimulationResult's scene and its proposals are co-located. `fakeSceneNarrator.ts` stamps the same key so the deterministic fixture path exercises the shape the orchestrator produces. `metadata` rather than a new top-level field: FR-B001's event contract is fixed, a new column would need back-filling onto all history, and an absent sceneId already has a defined downstream meaning. `sceneEventRows` (liveStateFunctions.ts) lifts it into `SceneEventLike.sceneId`, treating any non-string as absent.

2. Append-only override ledger. `safetyStatusOverrides` {worldId, classificationId, label, reason, actor, createdAt}, indexed by_world_and_classification. `postGenerationSafetyClassifications` is never patched -- doing so would dissolve its SAFETY_CLASSIFICATION_CONFLICT invariant and destroy the record of what the classifier decided. Effective label is derived by the pure `resolveEffectiveSafetyLabel` (latest createdAt wins, else the original). `readEffectiveSafetyLabels` performs the join; needed a new `by_world_and_source` index on (worldId, sourceId) because the projection knows Scene ids, not classification ids. No classification row at all resolves to 'allow' -- Canon carries seed/system/remediation events no classifier ever saw.

3. Operator command. `overridePostGenerationSafetyLabel` (convex/operations/safetyOverrideFunctions.ts) -- public mutation, requireOperator('safety.override') as its first statement, new admin-only capability. Validates the reason before writing, refuses an unknown classification, appends the ledger row + one operatorAuditLog entry in the same transaction, then runs rebuildLiveProjection. Placed under operations/, not safety/, because module-boundaries forbids safety -> operations/publicRead and the reverse would be a cycle; operations already may depend on both. Registered in publicFunctionSurface.

4. The gate, applied at REBUILD time. buildActiveScenePresentations takes an optional sceneSafetyLabels map; a refused group is presented with title '內容審核中', empty summary, publicationStatus 'withheld', keeping sourceEventIds and every spatial field. redactWithheldSummaries drops publicSummary of refused events before buildLiveProjection and buildVisualReplay see them. PUBLIC_ACTIVE_SCENE_PUBLICATION_STATUSES widened to ['published','withheld'] in both the hand-written assertion and the Convex validator. Fails closed on a verdict (any refused Scene in a group withholds the group, since groups publish joined summaries) and open on silence.

5. AC#6 via redaction rather than a read-time filter in resolveReplayTexts. A read-time filter would have had to read canonEvents from a public query -- which visualReplayFunctions.ts's own design explicitly rules out -- and would have left the refused sentence in the published payload for FR-O010's last-known-good fallback to keep serving. Redacting at the producer means a canonEventSummary reference stops resolving through the same absence path a withheld episode already uses. Documented in both module headers and docs/visual-replay.md.

6. AC#4 is true by construction (toPublicCharacterMotion never sees a label) and locked by a regression test that builds the whole projection twice, with and without a withheld scene, asserting `characters` is byte-identical.

Module boundary: publicRead gained `safety` in mayDependOn (safety depends only on shared; viewer already depended on it). activeScenePresentation.ts still imports nothing from safety -- it declares SceneSafetyLabel structurally, because FR-O013's replay builder pins that module's entire dependency closure and refuses anything under convex/safety/.

## Verification

`npm run check` clean: check:architecture, test:architecture (21/21), check:asset-licenses, test:asset-licenses, typecheck, lint, test (2054 passed, 5 skipped, 137 suites), build.

New/updated tests: convex/safety/effectiveSafetyLabels.test.ts (resolver + join, classification row byte-identical after every override), convex/operations/safetyOverrideFunctions.test.ts (auth-first, admin-only, audit trail, additive ledger, and an end-to-end AC#3 pass where an override turns a published scene into a placeholder and a later override restores it), convex/publicRead/activeScenePresentation.test.ts (placeholder, publicationStatus, fail-closed/open, traceability, characters byte-identical), convex/publicRead/visualReplayFunctions.test.ts (withheld canonEventSummary drops, Canon byte-identical), convex/simulation/worldDayLive.test.ts (provenance stamp).

Docs: new docs/dynamic-safety-filtering.md; docs/prd-2.0-requirement-matrix.md FR-P004 row moved to Done; handoff notes in docs/active-scene-presentation.md and docs/visual-replay.md updated to record what actually landed.

Defect found and fixed while testing: the ledger row was inserted before recordAudit could reject a blank reason. The transaction would have rolled it back, but "the write is undone" is weaker than "the write never happened"; the reason is now validated up front.

## Review round 1 — six fixes

1. **(HIGH, content-safety leak) The Visual Replay `episodeScene` branch was ungated.** Redacting `event.publicSummary` closed the `canonEventSummary` branch, but `resolveEventCardStep` PREFERS episode narration when a published episode exists, and that branch resolves `keyScene.summary` gated only on the episode's publication version/status. On any world day with a published episode covering a withheld scene, the overlay showed the placeholder while the replay narrated the real withheld text. Fixed with `redactWithheldNarration` (liveStateFunctions.ts), applied to both the replay's episode inputs and the overlay's `publishedEpisodeScenes`: a key scene narrating a withheld event keeps its POSITION in the array and loses its `sourceEventIds`, which makes it unmatchable by `narrationForEvents` and therefore unaddressable. Position is load-bearing — the read-time resolver looks summaries up by index in the real `dailyEpisodes` row, so removing the entry would serve a different scene's text under this one's address. A key scene covering a withheld event AND an allowed one is neutralised whole (its text is a joint narration). New tests build the replay both with and without the gate; the first asserts the leak IS reachable without it, so the regression test cannot pass against the broken version.

2. **(HIGH) A backdated `now` silently no-opped while reporting success.** `effectiveLabel` was an unverified echo of `args.label`. Now the handler re-reads the ledger after appending and throws `SAFETY_OVERRIDE_NOT_APPLIED` when the scene does not actually resolve to the requested label. While fixing this I found a related latent bug: `readEffectiveSafetyLabel` (`.order('desc').take(1)`) and `resolveEffectiveSafetyLabel` (strict `>`) disagreed on exact `createdAt` ties — the rebuild's gate and the command's verification would have reached different verdicts on the same content. Changed the fold to `>=` so both resolve ties to the last row in ledger order, documented the rule, and pinned it with tests in both directions. Consequence: an identical timestamp is not a backdate and does apply (the row appended second is the later decision); only a strictly older one is refused.

3. **Ledger re-keyed from `classificationId` to `sourceId`.** An override is a decision about a SCENE, and `sourceId` is the stable scene identity while `classificationId` is per classification run. Keying on the run would have orphaned the decision the moment a slot retry re-classified the same scene. `sourceId` is resolved once at write time from the classification row; `classificationId` is still recorded as part of the account of what the operator was reading. Index is now `by_world_source_and_created` on `['worldId','sourceId','createdAt']` — one index serving both "newest override for this scene" (`take(1)`) and "every override in this world" (`worldId` prefix). Test covers a re-classification under a new run id leaving the override in force.

4. **(HIGH) Unbounded reads in the label lookup.** The rebuild was passing every distinct sceneId in the world's entire canon history into a function doing 2 sequential unbounded `.collect()`s per id. Fixed by inverting the question rather than by trimming the input window: `readWithheldSceneLabels(db, worldId)` reads the REFUSED classifications (via the existing `by_world_and_label`, so allowed content is never read at all) plus the world's overrides, and everything absent from that union is showable. Three reads total, independent of history length and of world age — asserted by a test that counts the reads against a 51-scene fixture. `readEffectiveSafetyLabels` (still used by the override command, always with a bounded list) now parallelises with `Promise.all` and takes the latest override with `.order('desc').take(1)`. This mattered more than a perf nit: the failure mode was `rebuildLiveProjection` throwing, `liveState` freezing on last-known-good, and every SUBSEQUENT withhold silently never reaching viewers.

5. **Positional array correlation removed.** `redactWithheldSummaries` paired `events[i]` with `sceneEvents[i]`. Now `withheldEventIds` builds a set of event ids once and every redaction keys on `event.eventId`.

6. **Uncorrelated overrides no longer report a blank success.** `rebuildLiveProjection` takes an optional `correlateSceneId` and returns `correlatedEventCount` (costs no read — the scene events are already in hand). The mutation surfaces it and audits `outcome: 'no_op'` with a `..._UNCORRELATED` result code when it is zero, so an operator overriding a scene that correlates to nothing gets a truthful signal. No backfill migration for pre-ART-132 events, documented as a deliberate limitation in docs/dynamic-safety-filtering.md.

`npm run check` clean after the fixes: 137 suites, 2073 passed, 5 skipped, build OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-P004: content-safety/publication filtering for the public dynamic surface.

Core mechanism: every proposed event is now stamped with metadata.sceneId at scene-simulation time (worldDayLive.ts, fakeSceneNarrator.ts), giving committed Canon events a durable link back to the scene-level postGenerationSafetyClassifications row that governs them. A new append-only safetyStatusOverrides ledger (keyed by worldId+sourceId, not classificationId, so it survives re-classification) lets an admin-only operator mutation (overridePostGenerationSafetyLabel, requireOperator('safety.override') gated) retroactively withhold/restore a scene; the mutation re-reads the effective label after insert and throws SAFETY_OVERRIDE_NOT_APPLIED rather than reporting false success, and surfaces correlatedEventCount so a no-op (e.g. overriding a scene predating this feature) is truthful, not silent.

Withheld scenes render as a safe generic placeholder (publicationStatus: 'withheld') on the dynamic overlay rather than being hidden, per user confirmation. Character/position projection is a separate code path, verified untouched by a byte-identical regression test. Visual Replay is gated on both its canonEventSummary and episodeScene reference branches (the latter was found leaking real text through a published-episode fallback during review and fixed at the producer, before buildVisualReplay runs). The "which scenes are withheld" lookup is inverted (query refused-label classifications + overrides directly, ~3 reads) rather than windowed, so it stays bounded independent of world history length.

Verification: two independent review passes (code-reviewer, security-reviewer) found 1 confirmed content-safety leak (Visual Replay episodeScene branch) plus 5 correctness/reliability findings; all six were fixed in a follow-up round and independently re-verified by a third pass with evidence-level checks (not just re-reading the implementer's summary). npm run check (architecture boundaries, asset licenses, typecheck, lint, full Jest suite, build) is green: 137 suites, 2073 passed, 5 pre-existing/unrelated skips, build succeeds. Known, documented limitation: retroactive withhold cannot correlate Canon events committed before this feature shipped (no metadata.sceneId); no backfill was built since no production traffic predates it (docs/dynamic-safety-filtering.md §8).
<!-- SECTION:FINAL_SUMMARY:END -->
