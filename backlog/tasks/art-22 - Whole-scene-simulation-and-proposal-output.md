---
id: ART-22
title: Whole-scene simulation and proposal output
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:24'
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
- [ ] #1 FR-C005: 輸出必須通過 Runtime Validation。
- [ ] #2 FR-C005: 無效輸出必須可重試。
- [ ] #3 FR-C005: 場景不得直接寫入 Canon State。
- [ ] #4 FR-C005: 完整原始輸出不直接公開。
- [ ] #5 FR-C005: 高風險內容必須進入安全審核。
- [ ] #6 Automated tests provide evidence for every mapped FR-C005 acceptance criterion, including rejection and failure paths.
- [ ] #7 PRD traceability links FR-C005 to doc-1 and the merged implementation evidence.
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
