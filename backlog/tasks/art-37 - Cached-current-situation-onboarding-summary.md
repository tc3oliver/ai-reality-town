---
id: ART-37
title: Cached current-situation onboarding summary
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-j
milestone: m-0
dependencies:
  - ART-34
  - ART-66
  - ART-30
  - ART-40
  - ART-67
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-H001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Precompute an approximately 300-Chinese-character entry summary with major event, importance, four characters, three facts, question, recommended episode, and scene.

Scope
Precompute an approximately 300-Chinese-character entry summary with major event, importance, four characters, three facts, question, recommended episode, and scene.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-34, ART-66, ART-30, ART-40, ART-67

Schema Impact
Current-situation, primer, entry-point, return-recap, viewer-progress, or spoiler-compatibility contracts named by the task.

API Impact
Cached onboarding/recap read contracts; visitor reads never trigger generation.

Security Impact
Viewer progress is isolated by viewer/device and recap visibility obeys spoiler/publication rules.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Read-path tests verify content limits, cache behavior, invalidation, and zero generation calls.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-H001: 主要內容不超過約 300 中文字。
- [ ] #2 FR-H001: 不顯示完整世界歷史。
- [ ] #3 FR-H001: 主線重大變化後自動更新。
- [ ] #4 FR-H001: 結果必須快取。
- [ ] #5 FR-H001: 每位訪客讀取不得觸發 LLM。
- [ ] #6 Automated tests provide evidence for every mapped FR-H001 acceptance criterion, including rejection and failure paths.
- [ ] #7 PRD traceability links FR-H001 to doc-1 and the merged implementation evidence.
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
