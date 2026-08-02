---
id: ART-42
title: Episode detail experience
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-66
  - ART-85
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I003

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Deliver the published Episode detail page with recap-depth switching, key scenes, related characters/arcs, navigation, and recommended reading.

Scope
Deliver the published Episode detail page with recap-depth switching, key scenes, related characters/arcs, navigation, and recommended reading.

Out of Scope
Episode list/discovery, timeline, content generation, and production deployment.

Dependencies
ART-40, ART-66, ART-85

Schema Impact
No Canon mutation schema; owns published read-model records, query DTOs, cache/version metadata, or UI state explicitly named by the task.

API Impact
Read-only public query contracts and internal projection writers; UI never calls providers.

Security Impact
Server-side field allowlists, publication status, accessibility, and secret/privacy boundaries apply to every public view.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
UI tests cover all required sections, navigation boundaries, mobile layout, accessibility, and no-generation reads.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-I003: Episode detail supports Quick, Standard, and Deep Recap views.
- [ ] #2 FR-I003: Episode detail displays key scenes, related characters, and related arcs.
- [ ] #3 FR-I003: Previous and next Episode navigation works at boundaries.
- [ ] #4 FR-I003: Recommended related reading uses published content only.
- [ ] #5 The page is mobile accessible and public reads trigger no generation.
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
