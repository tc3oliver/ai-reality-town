---
id: ART-141
title: >-
  Whole-scene simulation proposedEvents do not conform to the requested schema
  against the real provider
status: To Do
assignee: []
created_date: '2026-08-05 02:11'
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
- [ ] #1 proposedEvents items returned by the real provider contain every field normalizeProposedEventOutput requires, including well-formed stateChanges
- [ ] #2 simulateWholeScene succeeds end to end against the real provider and commits accepted events
- [ ] #3 A live single-slot run against the real provider is observed to produce a character_location_changed accepted event for a travel-shaped scene
- [ ] #4 A permanent regression test reproduces the real-provider proposedEvents output shape recorded in this task and fails on the pre-fix code
- [ ] #5 The confirmed root cause of the proposedEvents non-compliance is documented
- [ ] #6 If LLM_MODEL=auto is found to be a contributing factor, that finding and a recommendation are documented (the model value itself is a deployment decision, not changed by this task)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->
