---
id: ART-29
title: Story arc event classification
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-h
milestone: m-0
dependencies:
  - ART-13
  - ART-16
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-F001

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Classify important accepted events into existing or new arcs with bounded multi-arc membership, explicit event roles, premise, current question, importance, and core-character changes.

Scope
Classify important accepted events into existing or new arcs with bounded multi-arc membership, explicit event roles, premise, current question, importance, and core-character changes.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-13, ART-16

Schema Impact
Versioned Story Arc state, fields, event links, lifecycle, scores, outcomes, and summary-consequence references named by the task.

API Impact
Deterministic arc classification/lifecycle/query interfaces; public ordering consumes published projections only.

Security Impact
Arc data cannot reveal unpublished facts or mutate Canon outside accepted events.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every mapped PRD acceptance condition, negative case, and failure boundary.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-F001: Event 可屬於多條 Arc，但主要 Arc 數量有限。
- [ ] #2 FR-F001: Arc 建立必須有明確 Premise 與 Current Question。
- [ ] #3 FR-F001: 低重要度事件不得任意建立新 Arc。
- [ ] #4 Automated tests provide evidence for every mapped FR-F001 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-F001 to doc-1 and the merged implementation evidence.
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
