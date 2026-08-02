---
id: ART-44
title: Scoped relationship graph experience
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:27'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-95
  - ART-10
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I007; NFR-002 graph clause

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Deliver the scoped relationship graph with current-arc, one-hop, recent-change defaults and relationship exploration controls.

Scope
Deliver the scoped relationship graph with current-arc, one-hop, recent-change defaults and relationship exploration controls.

Out of Scope
World timeline, full-world default graph, relationship mutation, and production deployment.

Dependencies
ART-40, ART-95, ART-10

Schema Impact
No Canon mutation schema; owns published read-model records, query DTOs, cache/version metadata, or UI state explicitly named by the task.

API Impact
Read-only public query contracts and internal projection writers; UI never calls providers.

Security Impact
Server-side field allowlists, publication status, accessibility, and secret/privacy boundaries apply to every public view.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
UI tests cover defaults, filters, reasons, privacy, accessibility, and the 30-node default limit.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-I007: Relationship graph defaults to current-arc core characters, one-hop relationships, and relationships changed in the last seven days.
- [ ] #2 FR-I007: Graph supports date switching, relationship-type filtering, character summaries, and change reasons.
- [ ] #3 The default graph never renders all characters/relationships and remains within the 30-node limit.
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
