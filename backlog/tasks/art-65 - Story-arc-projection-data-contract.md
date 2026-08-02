---
id: ART-65
title: Story arc projection data contract
status: To Do
assignee: []
created_date: '2026-08-02 15:43'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-h
milestone: m-0
dependencies:
  - ART-12
  - ART-16
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-F003

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Maintain every required arc field, including premise, question, core characters, inciting event, turning point, facts, questions, entry point, heat, and progress time.

Scope
Maintain every required arc field, including premise, question, core characters, inciting event, turning point, facts, questions, entry point, heat, and progress time.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-12, ART-16

Schema Impact
Versioned Story Arc state, fields, event links, lifecycle, scores, outcomes, and summary-consequence references named by the task.

API Impact
Deterministic arc classification/lifecycle/query interfaces; public ordering consumes published projections only.

Security Impact
Arc data cannot reveal unpublished facts or mutate Canon outside accepted events.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every acceptance criterion and all stated negative or failure cases.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-F003: Arc stores Title, Premise, Current Question, Status, Core Characters, Inciting Event, Latest Turning Point, Essential Facts, Unresolved Questions, Resolved Questions, Recommended Entry Point, Heat Score, and Last Progress Time.
- [ ] #2 Every required field is runtime validated and replayable from accepted events.
- [ ] #3 Traceability links FR-F003 to doc-1 and implementation evidence.
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
