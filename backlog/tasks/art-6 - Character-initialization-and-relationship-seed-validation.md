---
id: ART-6
title: Character initialization and relationship seed validation
status: To Do
assignee: []
created_date: '2026-08-02 15:30'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-b
milestone: m-0
dependencies:
  - ART-5
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-A002

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Load 12–20 fictional characters with public/private profiles, goals, secrets, assets, knowledge, location, and deduplicated relationships.

Scope
Load 12–20 fictional characters with public/private profiles, goals, secrets, assets, knowledge, location, and deduplicated relationships.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-5

Schema Impact
World import/seed schemas for world, locations, organizations, history, rules, characters, relationships, knowledge, secrets, and assets named by the task.

API Impact
Validated administrative import/readiness commands; imports are atomic and unavailable to public callers.

Security Impact
Seed/import data rejects real-person data, invalid references, unsafe defaults, and partial writes.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Fixture tests load at least 12 characters and exercise all rejection cases.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-A002: MVP 至少可載入 12 位主要角色。
- [ ] #2 FR-A002: 每位角色必須具備 Public Goal 與 Private Goal。
- [ ] #3 FR-A002: 所有角色與地點參照有效。
- [ ] #4 FR-A002: 所有 Secret 必須定義初始知情者。
- [ ] #5 FR-A002: 相互關係不得產生無效或重複記錄。
- [ ] #6 FR-A002: 不得使用真實個人資料或真實人物作為預設角色。
- [ ] #7 Automated tests provide evidence for every mapped FR-A002 acceptance criterion, including rejection and failure paths.
- [ ] #8 PRD traceability links FR-A002 to doc-1 and the merged implementation evidence.
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
