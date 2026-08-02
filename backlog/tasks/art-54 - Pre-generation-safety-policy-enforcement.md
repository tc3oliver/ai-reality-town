---
id: ART-54
title: Pre-generation safety policy enforcement
status: In Progress
assignee:
  - '@codex'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 18:21'
labels:
  - prd-1.0
  - epic-n
milestone: m-0
dependencies:
  - ART-3
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
modified_files:
  - convex/safety/preGeneration.ts
  - convex/safety/preGeneration.test.ts
  - docs/pre-generation-safety.md
  - docs/DEVELOPMENT.md
  - package.json
priority: high
type: feature
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-L001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Apply world and prompt constraints for minors sexual content, explicit sex, hate/dehumanization, extreme violence, self-harm encouragement, impersonation, personal data, and real-crime instruction.

Scope
Apply world and prompt constraints for minors sexual content, explicit sex, hate/dehumanization, extreme violence, self-harm encouragement, impersonation, personal data, and real-crime instruction.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-3

Schema Impact
Versioned safety policy, labels, stable reasons, warnings, withholding, and review-status records.

API Impact
Pre/post-generation and viewer-input safety classification interfaces separated from Canon mutation.

Security Impact
Unsafe content cannot reach providers or publication where prohibited; safety failure never changes Canon.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Policy tests cover allowed boundaries and every prohibited category.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-L001: Pre-generation controls restrict minor sexual content, explicit sexual content, hate/dehumanization, extreme violence detail, self-harm encouragement, real-person impersonation, personal data, and real-crime instruction.
- [x] #2 Every prohibited category has boundary tests and stable rejection reasons.
- [x] #3 Blocked input never reaches the provider.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
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
1. Define a versioned pre-generation safety policy with stable prohibited-category codes and deterministic normalization for world, prompt, and context text.
2. Implement boundary evaluation plus a provider-call guard that rejects unsafe input before invoking the provider, without mutating Canon or storing sensitive input.
3. Add allow-boundary and rejection tests for all eight FR-L001 categories, including obfuscation normalization, multi-field scanning, stable reasons, and zero provider calls on rejection.
4. Document limitations and extension rules, include the safety module in lint gates, run focused/full validation, then finalize and merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented policy v1 with eight stable prohibited-category codes, text-free rejection records, world/prompt/context evaluation, simple obfuscation normalization, immutable provider constraints, and a provider callback guard. Focused validation: convex/safety/preGeneration.test.ts, 17 tests passed. Full npm run check passed architecture checks, typecheck, safety-inclusive lint, 17 suites/171 tests, and Vite build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the FR-L001 generation preflight boundary. It blocks all eight required categories with stable privacy-safe reasons, attaches immutable safety constraints to allowed requests, and guarantees rejected content never reaches the provider. Verified by 17 focused tests and the full 171-test quality gate.
<!-- SECTION:FINAL_SUMMARY:END -->
