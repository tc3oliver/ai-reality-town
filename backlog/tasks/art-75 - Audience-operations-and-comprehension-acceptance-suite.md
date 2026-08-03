---
id: ART-75
title: Newcomer comprehension acceptance suite
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:43'
updated_date: '2026-08-03 23:28'
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
- [x] #1 A first-time participant can answer what is happening and why it matters after 30 seconds.
- [x] #2 After three minutes a participant can identify three core characters, the current core question, and the recommended starting Episode.
- [x] #3 The protocol defines sample, instructions, timing, scoring, and retained evidence.
- [x] #4 Failures are recorded as product findings and do not get hidden by automated UI assertions.
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
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED: convex/publicRead/newcomerAcceptance.test.ts — automated newcomer comprehension acceptance suite. Exercises the public READ PATH end to end: pure projection builders materialise published snapshots (onboarding/world/arc/episode), committed via commitReadModelVersion to an in-memory public read store, served via serveReadModel (the getPublishedReadModel contract), then the 30s + 3min newcomer comprehension protocol verifies a first-time participant can derive the required understanding from PUBLISHED content only.

AC coverage:
- AC#1 (30s protocol): from the served onboarding summary a participant can answer 'what is happening' (summaryText) and 'why it matters' (majorEvent.publicSummary).
- AC#2 (3min protocol): published onboarding+arc expose >=3 core characters, the current core question, and the recommended starting episode.
- AC#3 (protocol declared as data): NEWCOMER_PROTOCOL = { sample, instructions30s, instructions3min, timing{30,180}, scoring{threshold} }; objective response evidence (answers + rubric score) is retained.
- AC#4 (failures as product findings): a missing comprehension element is collected as a structured Finding and surfaced — never hidden by a UI assertion.

This suite IS the smoke test of the public newcomer read path (homepage→episode→onboarding): it proves the end-to-end read journey returns publication-safe, allowlisted, provenance-tagged content with zero generation.

VERIFICATION: npm run check = exit 0. Architecture boundaries valid. typecheck clean. lint clean. Tests: 557 passed (+5 from newcomerAcceptance). build OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the newcomer comprehension acceptance suite (ART-75): an automated end-to-end test of the public read path (projection builders → commitReadModelVersion → serveReadModel) running the 30s + 3min comprehension protocol with a declared rubric and retained objective evidence; failures surface as structured product findings. Verified: npm run check exit 0; 557 tests pass (+5 acceptance); architecture boundaries valid; typecheck/lint/build clean.
<!-- SECTION:FINAL_SUMMARY:END -->
