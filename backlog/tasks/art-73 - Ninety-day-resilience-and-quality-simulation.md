---
id: ART-73
title: Ninety-day resilience and quality simulation
status: To Do
assignee: []
created_date: '2026-08-02 15:43'
updated_date: '2026-08-02 16:27'
labels:
  - prd-1.0
  - epic-p
milestone: m-0
dependencies:
  - ART-60
  - ART-58
  - ART-88
  - ART-89
  - ART-90
  - ART-59
  - ART-91
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-007, Section 19.3, Milestone 8

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Run the fixed-seed 90-day simulation with budget, degradation, quality, stagnation, repetition, safety, and replay reporting; keep the P0 30-day gate independent.

Scope
Run the fixed-seed 90-day simulation with budget, degradation, quality, stagnation, repetition, safety, and replay reporting; keep the P0 30-day gate independent.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-60, ART-58, ART-88, ART-89, ART-90, ART-59, ART-91

Schema Impact
No new production domain schema unless explicitly named; owns deterministic fixtures, reports, rubrics, and verification evidence.

API Impact
Test harnesses consume documented domain/public interfaces without adding production mutation endpoints.

Security Impact
Test evidence minimizes sensitive data and never bypasses Canon, safety, authorization, or publication controls.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every acceptance criterion and all stated negative or failure cases.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A fixed-seed 90-day simulation completes using the deterministic harness and Fake Provider.
- [ ] #2 The report covers Canon/replay, narrative consistency, novelty/repetition, arc progress/stagnation, recap/spoiler, rejection/safety, budget/degradation, and token anomalies.
- [ ] #3 Results identify thresholds, source evidence, evaluator versions, and reproducible seed/configuration.
- [ ] #4 The 90-day task does not redefine or duplicate the P0 7/30-day gate.
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
