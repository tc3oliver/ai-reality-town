---
id: ART-60
title: Deterministic 7-day and 30-day simulation harness
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:58'
labels:
  - prd-1.0
  - epic-p
milestone: m-0
dependencies:
  - ART-83
  - ART-31
  - ART-4
  - ART-35
  - ART-82
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-007, Section 19.3, Public Test AC 1–10

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Run fixed-seed 7-day and 30-day simulations and machine-check Canon conflicts, replay consistency, arc limits/progress/resolution, character appearance, repetition, recap coverage, token anomalies, and safety outcomes.

Scope
Run fixed-seed 7-day and 30-day simulations and machine-check Canon conflicts, replay consistency, arc limits/progress/resolution, character appearance, repetition, recap coverage, token anomalies, and safety outcomes.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-83, ART-31, ART-4, ART-35, ART-82

Schema Impact
No new production domain schema unless explicitly named; owns deterministic fixtures, reports, rubrics, and verification evidence.

API Impact
Test harnesses consume documented domain/public interfaces without adding production mutation endpoints.

Security Impact
Test evidence minimizes sensitive data and never bypasses Canon, safety, authorization, or publication controls.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every mapped PRD acceptance condition, negative case, and failure boundary.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A fixed-seed 7-day run completes reproducibly with machine-readable findings.
- [ ] #2 A fixed-seed 30-day run completes with 100% replay equality and checks Canon conflicts, arc limits/progress/resolution, character appearance, repetition, recap coverage, token anomalies, and safety outcomes.
- [ ] #3 The harness uses ART-4 Fake Provider and fixed fixture without network credentials.
- [ ] #4 The 90-day run is explicitly out of scope and owned by ART-73.
- [ ] #5 Section 16.2: The fixed-seed 30-world-day simulation completion rate is 100%.
- [ ] #6 Section 16.2: The run maintains 1–3 major Active Story Arcs throughout all measured checkpoints.
- [ ] #7 Section 5.1: Every completed world day in the 30-day run contains at least one persisted, traceable Accepted Event and exactly one daily Episode derived from accepted events.
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
