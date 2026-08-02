---
id: ART-67
title: Recommended active-arc entry points
status: To Do
assignee: []
created_date: '2026-08-02 15:43'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-j
milestone: m-0
dependencies:
  - ART-33
  - ART-64
  - ART-65
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-H003

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Maintain an explainable recommended entry episode for every major active arc and reassess it after major changes.

Scope
Maintain an explainable recommended entry episode for every major active arc and reassess it after major changes.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-33, ART-64, ART-65

Schema Impact
Current-situation, primer, entry-point, return-recap, viewer-progress, or spoiler-compatibility contracts named by the task.

API Impact
Cached onboarding/recap read contracts; visitor reads never trigger generation.

Security Impact
Viewer progress is isolated by viewer/device and recap visibility obeys spoiler/publication rules.

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
- [ ] #1 FR-H003: 每條主要 Active Arc 必須有推薦入坑點。
- [ ] #2 FR-H003: 推薦原因可查詢。
- [ ] #3 FR-H003: Arc 重大變化後重新評估。
- [ ] #4 Automated tests provide evidence for every mapped FR-H003 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-H003 to doc-1 and the merged implementation evidence.
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
