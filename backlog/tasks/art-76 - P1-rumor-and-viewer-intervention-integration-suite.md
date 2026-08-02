---
id: ART-76
title: P1 rumor and viewer-intervention integration suite
status: To Do
assignee: []
created_date: '2026-08-02 15:53'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-p
milestone: m-0
dependencies:
  - ART-28
  - ART-45
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 19.2 cases 2 and 5

Problem / Context
P1 rumor and viewer-intervention scenarios need verification without blocking the P0 gate.

Goal
Verify multi-person rumor propagation and safe viewer-vote event injection.

Scope
Rumor provenance/version/belief divergence and winning environmental-event injection through safety, structural, and Canon validation.

Out of Scope
P0 Canon/cognition scenarios, direct character control, and production deployment.

Dependencies
ART-28, ART-45

Schema Impact
No new production domain schema unless explicitly named; owns deterministic fixtures, reports, rubrics, and verification evidence.

API Impact
Test harnesses consume documented domain/public interfaces without adding production mutation endpoints.

Security Impact
Test evidence minimizes sensitive data and never bypasses Canon, safety, authorization, or publication controls.

Validation Commands
npm run check; run the focused rumor/voting integration command and record its exact result.

Test Requirements
Both scenarios prove safety, provenance, idempotency, and Canon validation.

Documentation Impact
Update integration-test and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A multi-character rumor preserves origin, chain, versions, credibility, truth status, and divergent beliefs.
- [ ] #2 A winning environmental vote enters only as a Proposed Event and passes safety, structural, and Canon validation.
- [ ] #3 Neither scenario controls a character result or turns rumor into Canon.
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
