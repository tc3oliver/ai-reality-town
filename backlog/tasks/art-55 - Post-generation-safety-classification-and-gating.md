---
id: ART-55
title: Post-generation safety classification and gating
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-n
milestone: m-0
dependencies:
  - ART-54
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-L002

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Label every scene and public artifact Allow, Allow with Warning, Withhold, or Human Review Required, keeping safety failure separate from canon.

Scope
Label every scene and public artifact Allow, Allow with Warning, Withhold, or Human Review Required, keeping safety failure separate from canon.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-54

Schema Impact
Versioned safety policy, labels, stable reasons, warnings, withholding, and review-status records.

API Impact
Pre/post-generation and viewer-input safety classification interfaces separated from Canon mutation.

Security Impact
Unsafe content cannot reach providers or publication where prohibited; safety failure never changes Canon.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Classifier, publication-gate, redaction-fidelity, and failure-isolation tests pass.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-L002: 高風險內容不得直接公開。
- [ ] #2 FR-L002: Safety Failure 不得改變 Canon。
- [ ] #3 FR-L002: 公開摘要可移除過度細節，但不得改變核心事實。
- [ ] #4 FR-L002: 所有阻擋具備可查詢原因。
- [ ] #5 Automated tests provide evidence for every mapped FR-L002 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-L002 to doc-1 and the merged implementation evidence.
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
