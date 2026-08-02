---
id: ART-75
title: Newcomer comprehension acceptance suite
status: To Do
assignee: []
created_date: '2026-08-02 15:43'
updated_date: '2026-08-02 16:51'
labels:
  - prd-1.0
  - epic-p
milestone: m-0
dependencies:
  - ART-41
  - ART-42
  - ART-77
  - ART-8
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 19.4; Public Test AC 11–12

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Run the 30-second and three-minute newcomer comprehension protocol and retain objective response evidence.

Scope
Run the 30-second and three-minute newcomer comprehension protocol and retain objective response evidence.

Out of Scope
Manual narrative quality rubric, UI implementation, operations controls, and production deployment.

Dependencies
ART-41, ART-42, ART-77, ART-8

Schema Impact
No new production domain schema unless explicitly named; owns deterministic fixtures, reports, rubrics, and verification evidence.

API Impact
Test harnesses consume documented domain/public interfaces without adding production mutation endpoints.

Security Impact
Test evidence minimizes sensitive data and never bypasses Canon, safety, authorization, or publication controls.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
A documented human protocol verifies both 30-second questions and all three three-minute questions with retained pass/fail evidence.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A first-time participant can answer what is happening and why it matters after 30 seconds.
- [ ] #2 After three minutes a participant can identify three core characters, the current core question, and the recommended starting Episode.
- [ ] #3 The protocol defines sample, instructions, timing, scoring, and retained evidence.
- [ ] #4 Failures are recorded as product findings and do not get hidden by automated UI assertions.
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
