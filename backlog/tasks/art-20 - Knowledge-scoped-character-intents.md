---
id: ART-20
title: Knowledge-scoped character intents
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:45'
labels:
  - prd-1.0
  - epic-f
milestone: m-0
dependencies:
  - ART-19
  - ART-24
  - ART-26
  - ART-9
  - ART-80
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-C003

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Build traceable, bounded character contexts and structured intents from authorized persona, goals, emotions, memories, knowledge, assets, location, and arc context.

Scope
Build traceable, bounded character contexts and structured intents from authorized persona, goals, emotions, memories, knowledge, assets, location, and arc context.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-19, ART-24, ART-26, ART-9, ART-80

Schema Impact
Simulation Run, Director Plan, Intent, Scene, checkpoint, failure-stage, and proposal references named by the task.

API Impact
Internal scheduling/orchestration commands with idempotent start, resume, retry, pause, and inspection boundaries.

Security Impact
Generated data is untrusted, knowledge-scoped, safety-checked, and unable to bypass validation or commit directly.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests inspect context provenance and reject or downgrade illegal intents.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-C003: 所有輸入均可追蹤。
- [ ] #2 FR-C003: Intent 必須結構化。
- [ ] #3 FR-C003: Intent 不得直接修改世界。
- [ ] #4 FR-C003: 不合法 Intent 必須被拒絕或降級。
- [ ] #5 Automated tests provide evidence for every mapped FR-C003 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-C003 to doc-1 and the merged implementation evidence.
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
