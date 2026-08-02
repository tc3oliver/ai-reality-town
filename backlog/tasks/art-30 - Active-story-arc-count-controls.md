---
id: ART-30
title: Active story arc count controls
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-h
milestone: m-0
dependencies:
  - ART-29
  - ART-64
  - ART-65
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-F004

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Enforce three major, six minor, six core-character, and two-major-arc-per-event limits through merge, downgrade, or rejection without deleting events.

Scope
Enforce three major, six minor, six core-character, and two-major-arc-per-event limits through merge, downgrade, or rejection without deleting events.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-29, ART-64, ART-65

Schema Impact
Versioned Story Arc state, fields, event links, lifecycle, scores, outcomes, and summary-consequence references named by the task.

API Impact
Deterministic arc classification/lifecycle/query interfaces; public ordering consumes published projections only.

Security Impact
Arc data cannot reveal unpublished facts or mutate Canon outside accepted events.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Boundary tests cover every limit and each remediation path.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-F004: 超過上限時必須合併、降級或拒絕。
- [ ] #2 FR-F004: 首頁預設只展示最高優先級 Arc。
- [ ] #3 FR-F004: Arc 數量控制不得刪除 Event。
- [ ] #4 Automated tests provide evidence for every mapped FR-F004 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-F004 to doc-1 and the merged implementation evidence.
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
