---
id: ART-141
title: >-
  Whole-scene simulation proposedEvents do not conform to the requested schema
  against the real provider
status: Done
assignee:
  - '@claude'
created_date: '2026-08-05 02:11'
updated_date: '2026-08-06 07:34'
labels:
  - prd-2.0
  - release-blocker
  - epic-c
dependencies:
  - ART-139
priority: critical
ordinal: 141000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement ID: PRD 1.0 FR-C002 Whole-scene Simulation -- Existing Baseline Defect, discovered while live-verifying ART-139 (Critical, In Progress at the time of this discovery) against the real configured provider (LLM_API_URL=https://llm.shouri.app/v1, LLM_MODEL=auto).

Problem / Context: With the ART-139 schemaVersion/sceneId contract fix applied and confirmed working live, simulateWholeScene against the real provider gets past the root-level parse and then fails inside proposedEvents. The real provider returns proposedEvents items shaped like { eventId, publicSummary, trigger } -- almost none of the required ProposedEvent fields are present: schemaVersion, worldId, idempotencyKey, proposedBy, worldDay, timeSlot, eventType, participantIds, causedByEventIds, and critically stateChanges (the actual substantive content of the event) are all missing. normalizeProposedEventOutput (convex/canon/proposedEvent.ts) correctly rejects this as INVALID_EVENT_SHAPE / contains unknown fields.

This is a different, deeper defect than ART-139s: schemaVersion and sceneId were fixed/known-in-advance values the caller could safely default when the provider omitted them (not generated content). stateChanges and the rest of a ProposedEvent are the actual model-generated substance -- there is nothing safe to default them to. The model is not reliably producing the requested proposedEvents shape at all.

Leading hypothesis, not yet confirmed: WHOLE_SCENE_JSON_SCHEMA still declares proposedEvents item nested fields loosely in two places -- metadata: { type: "object" } (no properties/additionalProperties) and stateChanges: { type: "array", items: { type: "object" } } (deliberately left unconstrained in ART-139 because that 9-variant discriminated union has its own independent strict validator, normalizeStateChange). It is possible this gateways strict-mode implementation does not do true grammar-constrained decoding, and an under-specified nested schema anywhere in a branch lets the model freelance that entire branch rather than just the under-specified field -- which would explain why proposedEvents came back almost entirely off-schema while the now-fully-specified root-level and sibling nested-collection schemas (keyActions, dialogueHighlights, relationshipChanges, knowledgeChanges, memories, rumors) worked. This has not been tested; it may also simply be that this gateway/model combination (LLM_MODEL=auto) does not honor strict JSON Schema well regardless of specificity.

Evidence: live smoke test run 2026-08-05 against the real provider via a temporary internalAction (same pattern as ART-106s and ART-139s smoke tests, removed after verification), scene { worldId: mistwood, participantIds: [wu-zhen, lin-yingxue], trigger describing Wu Zhen delivering an envelope and continuing to the town square }. Raw proposedEvents keys observed: [["eventId","publicSummary","trigger"],["eventId","publicSummary","trigger"]]. Root-level fields (sceneSummary, keyActions, dialogueHighlights, relationshipChanges, knowledgeChanges, memories, rumors, continuityWarnings, schemaVersion, sceneId) were present and correctly shaped once the ART-139 fix applied.

Goal: proposedEvents items returned by the real provider reliably contain everything normalizeProposedEventOutput requires, including well-formed stateChanges, so simulateWholeScene succeeds end to end against the real provider and a live world-day run can produce accepted events (including character_location_changed for travel scenes).

Scope:
- Investigate why proposedEvents structural compliance fails against the real provider: test whether fully specifying the stateChanges 9-variant union (and metadata) in WHOLE_SCENE_JSON_SCHEMA changes provider behavior; if not, investigate prompt restructuring (e.g. explicit few-shot proposedEvents examples, or splitting proposedEvents into its own structured-output call) as an alternative.
- If the gateway/model combination cannot be made to comply reliably, evaluate and recommend whether LLM_MODEL=auto is appropriate for this call, as a documented recommendation -- changing the configured model value itself is a deployment/operational decision, not a code change this task makes unilaterally.
- Implement the fix that makes it work, with a regression test that captures the actual real-provider output shape recorded in this tasks evidence.
- Confirm success end to end against the real provider: simulateWholeScene succeeds and a live single-slot run (temporary smoke action, same pattern as prior ART-106/ART-139 checks) produces a character_location_changed accepted event for a travel-shaped scene.

Out of Scope: Wiring the real provider into the runQueuedWorldDaySlot live mutation pipeline (a separate, already-flagged gap: Convex mutations cannot make outbound network calls, so no live path currently reaches the real provider at all outside a standalone action -- track that separately if/when needed). Changing narration language (ART-106, Done). Reopening PRD 1.0 Epic C beyond this defect.

Dependencies: ART-139 (must land first; this task is discovered by and builds on its confirmed root-level fix).

Schema Impact: None to Canon. Request JSON schema may be tightened further.

API Impact: None public.

Security Impact: Provider output remains untrusted and must still pass normalizeProposedEventOutput and post-generation safety unchanged.

Test Requirements: A permanent regression test reproducing the real-provider proposedEvents output shape recorded in this tasks evidence; a test proving the fix produces a valid, complete ProposedEvent including stateChanges.

Validation Commands:
- npm run check
- Live: run simulateWholeScene against the real provider with a travel-shaped scene and confirm a valid proposedEvents entry with a character_location_changed stateChange is produced.

Documentation Impact: Update docs/whole-scene-simulation.md with the confirmed proposedEvents root cause once found.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 proposedEvents items returned by the real provider contain every field normalizeProposedEventOutput requires, including well-formed stateChanges
- [x] #2 simulateWholeScene succeeds end to end against the real provider and commits accepted events
- [x] #3 A live single-slot run against the real provider is observed to produce a character_location_changed accepted event for a travel-shaped scene
- [x] #4 A permanent regression test reproduces the real-provider proposedEvents output shape recorded in this task and fails on the pre-fix code
- [x] #5 The confirmed root cause of the proposedEvents non-compliance is documented
- [x] #6 If LLM_MODEL=auto is found to be a contributing factor, that finding and a recommendation are documented (the model value itself is a deployment decision, not changed by this task)
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
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce live against the real provider (https://llm.shouri.app/v1, LLM_MODEL=auto) with a temporary smoke test; capture the raw proposedEvents shape.
2. Test the task's leading hypothesis -- that proposedEventItem was the only strict-mode-nonconformant subtree -- by making it fully conformant and expanding stateChanges into its complete ten-variant anyOf. Measure, do not assume.
3. If that is not sufficient, isolate the true root cause with targeted probes: send the proposedEvents sub-schema alone to see whether the gateway constrains decoding at all, and send the full schema plus a worked example to see whether the prompt is the effective binding surface.
4. Implement whichever fix the probes actually support. (Confirmed: the gateway performs no schema enforcement, so the contract must travel in the prompt. wholeSceneSystemPrompt serialises WHOLE_SCENE_JSON_SCHEMA into the system message and adds a scene-derived worked proposedEvents example; the schema remains the single source of truth so prompt and schema cannot drift. Keep the schema strict-mode conformant via a strictObject helper that derives required from properties, and keep sending it as response_format for providers that do honor it.)
5. Fix the latent allow-list bug in normalizeStateChange, whose outer exactObject key list omitted every location_state_changed and organization_state_changed field, so those two variants could never pass normalization.
6. Re-measure live until reliable, iterating on observed failures rather than guesses. (Iteration found the model fusing the scene-level memories note with the character_memory_formed state change; fixed with an explicit disambiguation clause.)
7. Verify acceptance end to end: simulateWholeScene succeeds live, and the resulting character_location_changed ProposedEvent is ACCEPTED through commitProposedEvent.
8. Add permanent regression tests capturing the observed pre-fix and post-fix real-provider shapes verbatim, plus strict-mode and prompt-contract invariants that fail on pre-fix code.
9. Update docs/whole-scene-simulation.md with the confirmed root cause and the LLM_MODEL=auto finding; remove the temporary smoke test; npm run check; PR with auto-merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Live investigation against the real provider (https://llm.shouri.app/v1, LLM_MODEL=auto), 2026-08-06, via a temporary smoke test removed before the PR.

STEP 1 -- reproduced the reported defect verbatim. Raw structuredChat with WHOLE_SCENE_JSON_SCHEMA returned PROPOSED_EVENT_KEYS [["eventId","publicSummary","trigger"]]; parseWholeSceneOutput -> CanonError [INVALID_EVENT_SHAPE] object contains unknown fields; simulateWholeScene -> SceneSimulationError [SCENE_SIMULATION_FAILED]. Root keys also lacked schemaVersion and sceneId, matching ART-139.

STEP 2 -- tested the task's leading hypothesis and DISPROVED it as a sufficient fix. Rebuilt proposedEventItem to be fully strict-mode conformant (required == properties everywhere, proposedBy narrowed, eventType/timeSlot as enums, metadata dropped) and expanded stateChanges into the complete ten-variant anyOf built from the shared canon enums. The provider returned the same invented shape: PROPOSED_EVENT_KEYS [["eventId","publicSummary","probability"],[...]]. Latency rose 5s -> 66s, showing the larger schema was consumed but not obeyed.

STEP 3 -- isolated the true root cause with two probes. Probe A sent ONLY the proposedEvents sub-schema; the gateway returned an entirely unrelated document: {sceneId, worldId, locationId, timeSlot, participants[{id, action, internalState}], dialogue, narrative, outcome, dramaticTension}. That is decisive: the gateway accepts response_format json_schema with strict:true and returns HTTP 200 but performs NO grammar-constrained decoding. Everything that previously appeared 'honored' was the model inferring intent from self-describing field names echoed back from the scene payload. proposedEvents is a canon concept it cannot infer, so it invents one. Probe B sent the full schema plus one worked proposedEvents example in the system message and got all twelve contract fields back, confirming the prompt is the effective binding surface.

STEP 4 -- implemented the fix and iterated on measured evidence. wholeSceneSystemPrompt serialises WHOLE_SCENE_JSON_SCHEMA into the system message and adds a scene-derived worked example. First measurement was 1/3, failing deterministically at memories[0]: the model fused the scene-level memories note with the character_memory_formed state change my own prompt had introduced, returning ["characterId","content","interpretation","importance","emotionalWeight","confidence","visibility"] and dropping proposedEventIndex. Added an explicit disambiguation clause naming the exact keys for memories/knowledgeChanges/rumors.

STEP 5 -- final live measurement: 6/6 consecutive passes, no retries consumed. memories back to ["characterId","content","proposedEventIndex"] on every run; proposedEvents carried all twelve fields on every run; STATE_CHANGE_TYPES ["character_location_changed","item_transferred","relationship_changed"] on every run. Median latency ~8s (down from ~66s). The verbatim conforming response was captured and embedded as the regression fixture.

Latent defect found and fixed en route: normalizeStateChange's outer exactObject allow-list omitted every location_state_changed and organization_state_changed field (locationId, name, description, locationType, capacity, connectedLocationIds, active, organizationId, organizationType, headquartersLocationId), so those two variants could never pass normalization even when well formed. Covered by a new test in convex/canon/proposedEvent.test.ts.

Pre-fix failure confirmed empirically: with the two source files stashed, convex/simulation/sceneSimulation.test.ts fails to compile (wholeSceneSystemPrompt absent) and convex/canon/proposedEvent.test.ts fails on the location/organization variant test. Working tree restored intact afterwards.

Validation: npm run check passed end to end (architecture, asset licences, typecheck, lint, 351 tests, build). The temporary smoke test was deleted before commit.

STEP 6 -- accepted-event verification (AC#2/AC#3). Ran simulateWholeScene live against the real provider for the travel-shaped Mistwood scene (worldId mistwood, participants wu-zhen/lin-yingxue, trigger: Wu Zhen leaves the town square to deliver a sealed envelope to Lin Yingxue at the station), took the produced ProposedEvent carrying the character_location_changed state change, and put it through the Canon commit boundary (commitProposedEvent against InMemoryCanonStore). 2/2 runs ACCEPTED:

{ commit: { eventId: 'mistwood#event#0', sequenceNumber: 0, deduplicated: false },
  accepted: [{ schemaVersion: 1, worldId: 'mistwood', idempotencyKey: 'mistwood-scene1-wu-move', proposedBy: { type: 'system' }, worldDay: 3, timeSlot: 'morning', eventType: 'movement', locationId: 'mistwood-station', participantIds: ['wu-zhen'], causedByEventIds: [], publicSummary: '吳真從迷霧廣場前往車站。', stateChanges: [{ type: 'character_location_changed', characterId: 'wu-zhen', fromLocationId: 'mistwood-square', toLocationId: 'mistwood-station' }], eventId: 'mistwood#event#0', acceptedAt: 1786001299907, sequenceNumber: 0, validationVersion: 'canon-v1', traceId: 'art141-live' }] }

So the chain provider -> parseWholeSceneOutput -> normalizeProposedEventOutput -> validateEventStructure -> validateCanon -> appendCommit now completes end to end on real provider output. Wiring this into runQueuedWorldDaySlot's live mutation pipeline remains the separately-tracked gap (Convex mutations cannot make outbound network calls) and was explicitly out of scope here.

AC#6 finding: LLM_MODEL=auto is NOT a contributing factor. The defect is the gateway's structured-output implementation -- it accepts response_format json_schema strict:true and returns HTTP 200 without performing any schema enforcement, independent of which model 'auto' selects. Recommendation: leave LLM_MODEL=auto unchanged; no deployment or operational change is warranted by this task. Documented in docs/whole-scene-simulation.md.

All temporary smoke-test code removed before the PR.

PR #159 opened (https://github.com/tc3oliver/ai-reality-town/pull/159) with auto-merge enabled (gh pr merge 159 --auto --merge --delete-branch, enabledAt 2026-08-06T07:30:09Z). CI in progress at hand-off: 'Offline checks (typecheck, lint, test, build)' and 'Autonomous control plane + offline quality'. mergeStateStatus BLOCKED pending those checks, which is the expected pre-merge state; GitHub will merge automatically once they pass. Not block-watched, per the project's autonomous development rules.

PR #159 merged 2026-08-06 (https://github.com/tc3oliver/ai-reality-town/pull/159). Both required checks green: "Offline checks (typecheck, lint, test, build)" SUCCESS, "Autonomous control plane + offline quality" SUCCESS. Auto-merge completed; branch deleted.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Root cause, confirmed live rather than hypothesized: the configured gateway (https://llm.shouri.app/v1, LLM_MODEL=auto) accepts response_format json_schema with strict:true and returns HTTP 200, but performs no schema enforcement whatsoever. A probe carrying only the proposedEvents sub-schema came back as an entirely invented {sceneId, participants, narrative, outcome, dramaticTension} document. Every field that previously looked honored was really the model inferring intent from self-describing names echoed back from the scene payload; proposedEvents is a Canon concept it cannot infer, so it invented {eventId, publicSummary, trigger} and {eventId, publicSummary, probability}.

The task's leading hypothesis (an under-specified proposedEventItem breaking strict mode) was tested and disproved as a sufficient fix: after making every object node strict-mode conformant and expanding stateChanges into its full ten-variant anyOf, the provider returned exactly the same invented shape.

Fix: carry the contract in the prompt. wholeSceneSystemPrompt serialises WHOLE_SCENE_JSON_SCHEMA into the system message, adds a worked proposedEvents example derived from the scene, and disambiguates the scene-level memories/knowledgeChanges/rumors notes from the character_memory_formed state change they were being fused with. The schema stays the single source of truth and the prompt is serialised from it, so they cannot drift; it is still sent as response_format for providers that honor it, and strictObject derives required from properties so strict-mode conformance is structural. Also fixed a latent defect surfaced en route: normalizeStateChange's outer allow-list omitted every location_state_changed and organization_state_changed field, so those variants could never pass normalization.

Verified: 6/6 consecutive live runs produced proposedEvents carrying all twelve contract fields with well-formed stateChanges including character_location_changed, with median latency down from ~66s to ~8s; 2/2 live runs then had that event ACCEPTED through commitProposedEvent (eventId mistwood#event#0, validationVersion canon-v1). Pre-fix failure confirmed by stashing the source and re-running the suites. npm run check passed end to end (architecture, asset licences, typecheck, lint, 351 tests, build). Temporary smoke-test code removed before the PR.

LLM_MODEL=auto is not a contributing factor and no deployment change is recommended; the gap is the gateway's structured-output implementation. Documented in docs/whole-scene-simulation.md.
<!-- SECTION:FINAL_SUMMARY:END -->
