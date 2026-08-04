---
id: ART-139
title: Whole-scene simulation fails to parse real provider output
status: To Do
assignee: []
created_date: '2026-08-04 16:16'
labels:
  - prd-2.0
  - release-blocker
  - epic-c
dependencies: []
priority: critical
type: bug
ordinal: 139000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** PRD 1.0 FR-C002 whole-scene simulation; blocks PRD 2.0 FR-O002 and §22.6

**Problem / Context:** Against the real provider (`LLM_API_URL=https://llm.shouri.app/v1`), `simulateWholeScene()` fails with `SCENE_OUTPUT_INVALID: unsupported schema version`. Discovered during ART-106 and confirmed independent of the language-instruction change by reproducing it directly.

Root cause is a broken contract between the request schema and the parser:
- `WHOLE_SCENE_JSON_SCHEMA` (`convex/simulation/sceneSimulation.ts`) declares every nested collection as `{ type: "array", items: { type: "object" } }`, so it constrains no field names inside `relationshipChanges`, `knowledgeChanges`, `memories` or `rumors`.
- `parseEventLinked` calls `record(item, path, allowed)` with an exact allowed-key list per path, rejecting any unknown key.
- The schema therefore cannot make the provider produce what the parser demands. Observed output used `{characterId, targetCharacterId, change}` where the parser requires `{sourceCharacterId, targetCharacterId, summary, proposedEventIndex}`.
- `schemaVersion` is declared `{ const: 1 }` but checked with `root.schemaVersion !== 1`, so a string `"1"` or a missing field surfaces as the misleading "unsupported schema version" error regardless of the real defect.

**Why this blocks PRD 2.0:** No accepted event is produced, so `withArrivalStateChanges` in `convex/simulation/worldDayLive.ts` never appends `character_location_changed`. With no canon movement there is nothing for the dynamic layer to render, and PRD 2.0 §22.6 cannot be satisfied.

**Goal:** Whole-scene simulation succeeds end to end against the real provider, and any genuine malformed output fails with an accurate, actionable error.

**Scope:**
- Declare nested item properties in `WHOLE_SCENE_JSON_SCHEMA` so a strict provider is actually constrained to the parser contract.
- Make the `schemaVersion` check report the real defect instead of masking downstream field errors.
- Decide and implement the tolerance policy for non-conforming provider output: normalize known field-name variants, or fail with a precise path-level error, or repair-and-retry.
- Ensure error paths identify the offending field path.

**Out of Scope:** Changing Canon validation; changing the narration language (ART-106, Done); provider selection.

**Dependencies:** None.

**Schema Impact:** None to Canon. Request JSON schema tightened.

**API Impact:** None public.

**Security Impact:** Provider output remains untrusted and must still pass post-generation safety and Canon validation unchanged.

**Test Requirements:** A regression test reproducing the real-provider output shape that currently fails; tests that a wrong `schemaVersion` and a wrong nested field each produce their own accurate error code and path; a test that the tightened JSON schema matches the parser contract.

**Validation Commands:**
- `npm run check`
- Live: run whole-scene simulation against the real provider and confirm accepted events are committed.

**Documentation Impact:** Update `docs/whole-scene-simulation.md` with the schema/parser contract rule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 simulateWholeScene succeeds against the real provider and commits accepted events
- [ ] #2 WHOLE_SCENE_JSON_SCHEMA declares nested item properties so the request schema matches the parser contract
- [ ] #3 A wrong schemaVersion and a wrong nested field each produce a distinct accurate error code and field path
- [ ] #4 The tolerance policy for non-conforming provider output is implemented and documented
- [ ] #5 A regression test reproduces the real-provider output shape that currently fails
- [ ] #6 character_location_changed events are observed to be produced by a live world day run
- [ ] #7 Canon validation and post-generation safety behaviour are unchanged
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
