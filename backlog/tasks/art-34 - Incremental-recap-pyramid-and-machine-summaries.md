---
id: ART-34
title: Incremental recap pyramid
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 17:00'
labels:
  - prd-1.0
  - epic-i
milestone: m-0
dependencies:
  - ART-33
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-G002; Section 13.11

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Maintain the traceable Raw Event to Scene, Episode, Arc, Season, and Viewer summary pyramid incrementally from prior summaries plus new accepted events.

Scope
Maintain the traceable Raw Event to Scene, Episode, Arc, Season, and Viewer summary pyramid incrementally from prior summaries plus new accepted events.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-33

Schema Impact
Episode, recap, machine-summary, coverage, or derived-content records named by the task, each linked to accepted source events.

API Impact
Editorial generation/validation interfaces and publication-candidate outputs; no direct Canon mutation.

Security Impact
Spoilers and unsafe content are withheld through field visibility and publication gates.

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
- [ ] #1 FR-G002: 高層摘要可追蹤來源事件。
- [ ] #2 FR-G002: 更新時優先使用前一版摘要與新增事件。
- [ ] #3 FR-G002: 不得每次讀取完整世界歷史。
- [ ] #4 FR-G002: 摘要可重新生成，但不得改變 Canon。
- [ ] #5 Automated tests provide evidence for every mapped FR-G002 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-G002 to doc-1 and the merged implementation evidence.
- [ ] #7 Section 13.11: Recap Snapshot records id, worldId, recapType, targetId, sourceFromEventId, sourceToEventId, content, structuredPayload, version, and generatedAt; its source range resolves only to Accepted Events.
- [ ] #8 Recap Snapshot regeneration creates a new version, preserves prior versions for audit, and never mutates Canon.
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
