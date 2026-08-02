---
id: ART-85
title: Public Episode and Timeline projections
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
  - ART-33
  - ART-51
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 85000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Sections 13.8 and 13.10; Public Read Model

Problem / Context
Episode and major-event Timeline projections share editorial sources and need a focused owner separate from Live state.

Goal
Build publication-safe Episode and major-event Timeline projections with last-known-good availability.

Scope
Published Episode detail/list data and major-event timeline filter keys only.

Out of Scope
Live state, World/Character/Relationship/Arc projections, UI, and generation.

Dependencies
ART-40, ART-33, ART-51

Schema Impact
Owns published Episode and Timeline projection records and DTOs only.

API Impact
Internal projection writers and read-only Episode/Timeline queries.

Security Impact
Only eligible published content is projected; hidden events, raw output, prompts, and secrets remain excluded.

Validation Commands
npm run check; run focused publication, rebuild, correction, filter-key, and privacy tests.

Test Requirements
Tests cover published-state gating, key fields, major-event selection, rebuild, and correction refresh.

Documentation Impact
Update read-model/API and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Episode projection includes only eligible published editorial content and all detail/list query fields.
- [ ] #2 Timeline defaults to major events and retains Arc, Character, Event Type, and Episode-link keys.
- [ ] #3 Both remain last-known-good during simulation failure and refresh after corrections.
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
