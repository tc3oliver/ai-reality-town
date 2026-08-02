---
id: ART-84
title: Public World and Character projections
status: To Do
assignee: []
created_date: '2026-08-02 16:20'
updated_date: '2026-08-02 16:26'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-9
  - ART-24
  - ART-25
  - ART-78
  - ART-79
  - ART-80
  - ART-81
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Sections 13.1, 13.2, 13.5–13.7; Public Read Model

Problem / Context
World and Character public projections need a focused owner separate from relationship and arc projections.

Goal
Build publication-safe World and Character projections with explicit field allowlists.

Scope
World/current-day/environment and Character public profile/current-state/dramatic-irony projection only.

Out of Scope
Relationship, Arc, Episode, Timeline, Live UI, and production deployment.

Dependencies
ART-40, ART-9, ART-24, ART-25, ART-78, ART-79, ART-80, ART-81

Schema Impact
Owns publication-safe World and Character projection records and DTOs only.

API Impact
Internal idempotent projection writers and read-only World/Character queries.

Security Impact
Server allowlists exclude private profiles, Knowledge, memories, prompts, raw output, and admin notes.

Validation Commands
npm run check; run focused projection rebuild, privacy, correction, and query tests.

Test Requirements
Tests cover every public/forbidden Character field, world state, rebuild, correction, and idempotency.

Documentation Impact
Update read-model/API and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 World projection exposes publication-safe day, time, environment, and public Canon facts.
- [ ] #2 Character projection exposes every allowed FR-I005 field and excludes every forbidden field server-side.
- [ ] #3 Both rebuild deterministically and refresh after corrections.
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
