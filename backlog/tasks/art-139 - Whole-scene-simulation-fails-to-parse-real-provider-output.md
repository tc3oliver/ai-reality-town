---
id: ART-139
title: Whole-scene simulation fails to parse real provider output
status: To Do
assignee: []
created_date: '2026-08-04 16:16'
updated_date: '2026-08-04 16:59'
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
**Requirement ID:** PRD 1.0 **FR-C002** Whole-scene Simulation — **Existing Baseline Defect**, the single permitted exception under PRD 2.0 §13.2. This is not a new PRD 2.0 requirement and must not be used to reopen PRD 1.0 Epic C or recreate any Done task.

**Release Criticality:** Release Blocker. Blocks PRD 2.0 FR-O002 production acceptance and §22.6 / §22.29.

**Problem / Context:** Against the real provider, `simulateWholeScene()` fails with `SCENE_OUTPUT_INVALID` — `unsupported schema version`.

Suspected root cause is a broken contract between the request schema and the parser:
- `WHOLE_SCENE_JSON_SCHEMA` (`convex/simulation/sceneSimulation.ts:145-156`) declares every nested collection as `{ type: "array", items: { type: "object" } }`, constraining no field names inside `relationshipChanges`, `knowledgeChanges`, `memories` or `rumors`.
- `parseEventLinked` (`:93-105`) calls `record(item, path, allowed)` with an exact allowed-key list per path, rejecting any unknown key.
- The schema therefore cannot make the provider produce what the parser demands.
- `schemaVersion` is declared `{ const: 1 }` but checked with `root.schemaVersion !== 1` (`:110`), so a string `"1"` or a missing field surfaces as the misleading "unsupported schema version" error regardless of the real defect.

**Why this blocks PRD 2.0 (scope of the block, precisely):** No accepted event is produced by the real provider, so `withArrivalStateChanges` (`convex/simulation/worldDayLive.ts:539`) never appends `character_location_changed` from a live run. This blocks only the **production acceptance** of Canon-driven movement — proving cross-location movement from real-provider accepted events (FR-O002 production acceptance, §22.6, §22.29).

It does **not** block the rest of the dynamic layer. The Mistwood seed (`convex/canon/mistwoodSeed.ts`, twelve characters with `initialLocationId`), `liveState.ts`, and deterministic fixtures already provide enough data to implement and unit-test the map, visual bindings, ambient movement, replay and the rest of the dynamic layer while this task is in progress. Do not use this section to justify blocking unrelated V2 tasks.

## Evidence

| Item | Value |
|---|---|
| Discovered during | ART-106 real-provider smoke test |
| Evidence document | `backlog/tasks/art-106 - Generate-scene-narration-in-Traditional-Chinese.md` — recorded in both Implementation Notes and Final Summary |
| Commit at discovery | `972696f` feat(ART-106): generate scene narration in Traditional Chinese |
| Commit that introduced the code | `35411d3` feat: add whole-scene simulation |
| Provider | `LLM_API_URL=https://llm.shouri.app/v1`, `LLM_MODEL=auto` |
| Observed error | `SCENE_OUTPUT_INVALID` — `unsupported schema version` |
| Code references | `sceneSimulation.ts:110`, `:93-105`, `:145-156` |

**Evidence gap (recorded honestly):** no permanent reproduction harness exists. The ART-106 smoke test was a temporary `internalAction`, removed after verification, so no runnable reproduction command can be cited here. **Building a reproducible regression test is the first deliverable of this task.** Until it exists the root cause above is a high-confidence hypothesis, not a proven diagnosis.

**Goal:** Whole-scene simulation succeeds end to end against the real provider, and any genuinely malformed output fails with an accurate, actionable error.

**Scope:**
- Build the reproduction first, as a permanent regression test.
- Declare nested item properties in `WHOLE_SCENE_JSON_SCHEMA` so a strict provider is actually constrained to the parser contract.
- Make the `schemaVersion` check report the real defect instead of masking downstream field errors.
- Decide and implement the tolerance policy for non-conforming provider output: normalize known field-name variants, fail with a precise path-level error, or repair-and-retry.
- Ensure every error path identifies the offending field path.

**Out of Scope:** Changing Canon validation; changing narration language (ART-106, Done); provider selection; reopening PRD 1.0 Epic C.

**Dependencies:** None. Can start immediately and in parallel with ART-99 and ART-107.

**Schema Impact:** None to Canon. Request JSON schema tightened.

**API Impact:** None public.

**Security Impact:** Provider output remains untrusted and must still pass post-generation safety and Canon validation unchanged.

**Test Requirements:** A permanent regression test reproducing the real-provider output shape; tests that a wrong `schemaVersion` and a wrong nested field each produce their own accurate error code and path; a test that the tightened JSON schema matches the parser contract.

**Validation Commands:**
- `npm run check`
- Live: run a world-day slot against the real provider and confirm accepted events are committed and `character_location_changed` is produced.

**Documentation Impact:** Update `docs/whole-scene-simulation.md` with the schema/parser contract rule and the confirmed root cause.
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
- [ ] #8 A permanent reproduction test exists that fails on the current code and captures the real provider output shape
- [ ] #9 The confirmed root cause is documented, replacing the current hypothesis
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
