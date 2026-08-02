---
id: ART-25
title: Subjective character memory projection
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-g
milestone: m-0
dependencies:
  - ART-24
  - ART-16
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-E002

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Create distinct subjective memories per participant with interpretation, importance, emotion, confidence, visibility, and event provenance.

Scope
Create distinct subjective memories per participant with interpretation, importance, emotion, confidence, visibility, and event provenance.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-24, ART-16

Schema Impact
Character Knowledge, Memory, compression, retrieval-trace, or rumor-chain records named by the task.

API Impact
Authorized cognition queries and event-derived update interfaces; no cross-character unrestricted access.

Security Impact
Private knowledge/memory is least-privilege, source-proven, and excluded from public output.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests generate divergent memories from one event and verify traceability and privacy.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-E002: 角色記憶與 Canon Fact 分離。
- [ ] #2 FR-E002: 記憶可包含誤解。
- [ ] #3 FR-E002: 記憶必須可追蹤至事件。
- [ ] #4 FR-E002: 私人記憶不得直接公開。
- [ ] #5 Automated tests provide evidence for every mapped FR-E002 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-E002 to doc-1 and the merged implementation evidence.
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
