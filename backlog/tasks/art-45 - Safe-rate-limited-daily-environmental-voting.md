---
id: ART-45
title: Safe rate-limited daily environmental voting
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-l
milestone: m-0
dependencies:
  - ART-15
  - ART-56
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-J001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Offer 3–4 validated environmental candidates, enforce per-device daily limits and cutoff, select one winner, and inject it as a proposed world event without prescribing outcomes.

Scope
Offer 3–4 validated environmental candidates, enforce per-device daily limits and cutoff, select one winner, and inject it as a proposed world event without prescribing outcomes.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-15, ART-56

Schema Impact
Viewer Intervention, vote, consequence, analytics, or authenticated progress schemas explicitly named by the task.

API Impact
Untrusted viewer command/ingestion interfaces and privacy-safe read/aggregate queries.

Security Impact
Rate limits, authorization, injection defenses, data minimization, and no direct character control are mandatory.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests cover candidate rules, abuse limits, cutoff/tie behavior, injection, safety, and canon rejection.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-J001: 候選事件通過安全與 Canon 檢查。
- [ ] #2 FR-J001: 每個裝置每日投票次數受限。
- [ ] #3 FR-J001: 投票截止後只有一項勝出。
- [ ] #4 FR-J001: 勝出事件作為 Proposed World Event 注入。
- [ ] #5 FR-J001: 勝出不代表指定後續結果。
- [ ] #6 Automated tests provide evidence for every mapped FR-J001 acceptance criterion, including rejection and failure paths.
- [ ] #7 PRD traceability links FR-J001 to doc-1 and the merged implementation evidence.
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
