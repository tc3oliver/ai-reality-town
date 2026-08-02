---
id: ART-55
title: Post-generation safety classification and gating
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 20:42'
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
- [x] #1 FR-L002: 高風險內容不得直接公開。
- [x] #2 FR-L002: Safety Failure 不得改變 Canon。
- [x] #3 FR-L002: 公開摘要可移除過度細節，但不得改變核心事實。
- [x] #4 FR-L002: 所有阻擋具備可查詢原因。
- [x] #5 Automated tests provide evidence for every mapped FR-L002 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-L002 to doc-1 and the merged implementation evidence.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Define a versioned post-generation safety contract for scenes/public artifacts with Allow, Allow with Warning, Withhold, and Human Review Required labels plus stable queryable reasons. 2. Implement deterministic classification and fail-closed publication gating, including sanitized-summary core-fact fidelity checks and a boundary that never imports or mutates Canon. 3. Persist idempotent classification records behind internal Convex functions and expose operations-only reason lookup. 4. Add classifier, high-risk blocking, warning, human-review, redaction-fidelity, classifier-failure isolation, idempotency, and boundary tests; update docs, run codegen and full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented versioned Allow/Allow with Warning/Withhold/Human Review Required classification for scenes and public artifacts. Publication fails closed on high risk or classifier failure; stable reason codes are internally queryable, raw unsafe text is not stored, and sanitized summaries must retain identical ordered core Fact IDs. Safety code has no Canon commit/reducer dependency. Focused Jest passed 8 tests; Convex codegen succeeded; npm run check passed architecture, typecheck, lint, 38 suites/335 tests, and build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-L002 post-generation safety labels, fail-closed publication gating, queryable block reasons, classifier failure isolation, and core-fact-preserving summary sanitization. Verified with 8 focused tests and full npm run check (335 tests); merge evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
