---
id: ART-66
title: Three-level episode recap formats
status: To Do
assignee: []
created_date: '2026-08-02 15:43'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-i
milestone: m-0
dependencies:
  - ART-33
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-G003

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Produce Quick, Standard, Deep, and runtime-validated Machine Summary formats with the PRD length and field requirements.

Scope
Produce Quick, Standard, Deep, and runtime-validated Machine Summary formats with the PRD length and field requirements.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-33

Schema Impact
Episode, recap, machine-summary, coverage, or derived-content records named by the task, each linked to accepted source events.

API Impact
Editorial generation/validation interfaces and publication-candidate outputs; no direct Canon mutation.

Security Impact
Spoilers and unsafe content are withheld through field visibility and publication gates.

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
- [ ] #1 FR-G003: Quick Recap is 80–150 Chinese characters.
- [ ] #2 FR-G003: Standard Recap is 400–800 Chinese characters.
- [ ] #3 FR-G003: Deep Recap contains complete causal context and event list.
- [ ] #4 FR-G003: Machine Summary is runtime-validated structured data containing What Changed, Why It Happened, Who Is Affected, New Questions, Resolved Questions, Required Prior Facts, and Story Arc Progress.
- [ ] #5 All recap formats trace to accepted events and cannot change Canon.
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
