---
id: ART-22
title: Whole-scene simulation and proposal output
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 21:23'
labels:
  - prd-1.0
  - epic-f
milestone: m-0
dependencies:
  - ART-21
  - ART-15
  - ART-55
  - ART-4
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
modified_files:
  - convex/simulation/sceneSimulation.ts
  - convex/simulation/sceneSimulationFunctions.ts
  - convex/simulation/sceneSimulation.test.ts
  - convex/simulation/schema.ts
  - convex/_generated/api.d.ts
  - docs/whole-scene-simulation.md
  - docs/DEVELOPMENT.md
priority: high
type: feature
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-C005

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Simulate each major scene once and produce validated summaries, actions, highlights, proposed events, relationship/knowledge/memory/rumor changes, warnings, and safety labels.

Scope
Simulate each major scene once and produce validated summaries, actions, highlights, proposed events, relationship/knowledge/memory/rumor changes, warnings, and safety labels.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-21, ART-15, ART-55, ART-4

Schema Impact
Simulation Run, Director Plan, Intent, Scene, checkpoint, failure-stage, and proposal references named by the task.

API Impact
Internal scheduling/orchestration commands with idempotent start, resume, retry, pause, and inspection boundaries.

Security Impact
Generated data is untrusted, knowledge-scoped, safety-checked, and unable to bypass validation or commit directly.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Provider integration tests cover valid, malformed, retry, and high-risk outputs.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-C005: 輸出必須通過 Runtime Validation。
- [x] #2 FR-C005: 無效輸出必須可重試。
- [x] #3 FR-C005: 場景不得直接寫入 Canon State。
- [x] #4 FR-C005: 完整原始輸出不直接公開。
- [x] #5 FR-C005: 高風險內容必須進入安全審核。
- [x] #6 Automated tests provide evidence for every mapped FR-C005 acceptance criterion, including rejection and failure paths.
- [ ] #7 PRD traceability links FR-C005 to doc-1 and the merged implementation evidence.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
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
1. Define a strict versioned whole-scene output contract covering Scene Summary, key actions, dialogue highlights, Proposed Events, relationship/knowledge/memory/rumor changes, continuity warnings, and safety result, with exact GroupedScene provenance. 2. Implement one provider call per whole scene attempt through the vendor-neutral structured-chat port; runtime-normalize every Proposed Event, reject unknown/malformed fields, and retry transient or invalid structured output within a bounded budget without committing Canon. 3. Classify the complete validated scene text with the post-generation safety policy, mark withhold/human-review outputs as review-required, and persist only validated output plus trace metadata behind internal-only idempotent APIs; never expose raw provider output publicly. 4. Add deterministic provider tests for valid, malformed-then-valid retry, exhausted invalid output, high-risk review routing, provenance/idempotency, and absence of Canon writes; update docs and run codegen/full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented one structured provider request per complete Grouped Scene, a strict v1 runtime contract for every FR-C005 field, shared Proposed Event normalization and exact Scene provenance. Invalid output/transient providers retry the whole scene up to 1-3 attempts; permanent failures stop. The module only returns Proposed Events and never imports Canon commit/reducer paths.

Complete validated narrative text receives post-generation safety classification; withhold/human-review labels set reviewStatus required. Internal-only idempotent persistence requires an existing Grouped Scene, stores validated result/trace only, and defines no public or raw-output API. Verification: focused Jest 6/6 passed; Convex codegen passed; npm run check passed architecture, typecheck, lint, 44 suites/376 tests, and build; git diff --check passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added FR-C005 whole-scene simulation with strict structured runtime validation, bounded invalid/transient retries, Proposed Event-only output, complete safety review routing, and internal validated-result persistence. Focused provider tests and full 376-test/typecheck/lint/build verification pass; merge evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
