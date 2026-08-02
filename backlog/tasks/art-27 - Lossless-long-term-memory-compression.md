---
id: ART-27
title: Lossless long-term memory compression
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-g
milestone: m-0
dependencies:
  - ART-26
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-E004

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Compress old memories into impressions, beliefs, relationship summaries, arc understanding, and location experience without changing canon or deleting source memories.

Scope
Compress old memories into impressions, beliefs, relationship summaries, arc understanding, and location experience without changing canon or deleting source memories.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-26

Schema Impact
Character Knowledge, Memory, compression, retrieval-trace, or rumor-chain records named by the task.

API Impact
Authorized cognition queries and event-derived update interfaces; no cross-character unrestricted access.

Security Impact
Private knowledge/memory is least-privilege, source-proven, and excluded from public output.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests cover recall parity, source retention, canon isolation, and failure recovery.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-E004: 原始 Event 仍保留。
- [ ] #2 FR-E004: 壓縮不得改變 Canon。
- [ ] #3 FR-E004: 壓縮後角色仍能回想高重要度事件。
- [ ] #4 FR-E004: 壓縮失敗不得刪除原始記憶。
- [ ] #5 Automated tests provide evidence for every mapped FR-E004 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-E004 to doc-1 and the merged implementation evidence.
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
