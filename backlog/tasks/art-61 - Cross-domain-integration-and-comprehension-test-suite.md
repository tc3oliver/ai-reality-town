---
id: ART-61
title: P0 canon and cognition integration suite
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-p
milestone: m-0
dependencies:
  - ART-17
  - ART-24
  - ART-25
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 19.2 cases 1, 3, and 4; Public Test AC 3–6

Problem / Context
P0 Canon and cognition invariants need focused integration evidence without depending on P1 rumor or voting features.

Goal
Verify sourced secret acquisition and sharing, deceased-character exclusion from normal scenes, and unique item ownership across repeated transfers.

Scope
P0 integration scenarios for knowledge provenance, alive status, location consistency, item ownership, replay, and duplicate-event protection.

Out of Scope
P1 rumor propagation and viewer voting, covered separately; production deployment.

Dependencies
ART-17, ART-24, ART-25

Schema Impact
No new production domain schema unless explicitly named; owns deterministic fixtures, reports, rubrics, and verification evidence.

API Impact
Test harnesses consume documented domain/public interfaces without adding production mutation endpoints.

Security Impact
Test evidence minimizes sensitive data and never bypasses Canon, safety, authorization, or publication controls.

Validation Commands
npm run check; run the focused Canon/cognition integration command and record its exact result.

Test Requirements
Each scenario runs deterministically, asserts replay equality, and proves invalid transitions are rejected.

Documentation Impact
Update integration-test and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A character acquires and shares a secret only through allowed accepted-event sources with intact provenance.
- [ ] #2 A deceased character cannot participate in a normal new scene after replay or retry.
- [ ] #3 Repeated item transfers preserve exactly one canonical owner and reject concurrent or duplicate ownership.
- [ ] #4 All scenarios are deterministic and retain 100% replay equality.
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
