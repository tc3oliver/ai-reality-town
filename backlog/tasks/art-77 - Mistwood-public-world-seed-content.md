---
id: ART-77
title: Mistwood public-world seed content
status: To Do
assignee: []
created_date: '2026-08-02 16:19'
updated_date: '2026-08-02 16:58'
labels:
  - prd-1.0
  - epic-b
milestone: m-0
dependencies:
  - ART-5
  - ART-6
  - ART-7
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Sections 5.1, 10.3, 13, 17, 18 Milestone 0

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Author the production-intended fictional Mistwood seed: 6–10 locations, 12–20 principal characters, organizations, assets, secrets, knowledge, relationships, history, required tensions, shared misconception, and launchable arc.

Scope
Author the production-intended fictional Mistwood seed: 6–10 locations, 12–20 principal characters, organizations, assets, secrets, knowledge, relationships, history, required tensions, shared misconception, and launchable arc.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-5, ART-6, ART-7

Schema Impact
World import/seed schemas for world, locations, organizations, history, rules, characters, relationships, knowledge, secrets, and assets named by the task.

API Impact
Validated administrative import/readiness commands; imports are atomic and unavailable to public callers.

Security Impact
Seed/import data rejects real-person data, invalid references, unsafe defaults, and partial writes.

Validation Commands
npm run check; run the task-focused automated or documented manual validation and record exact evidence.

Test Requirements
Tests or documented human evaluation cover every acceptance criterion, negative case, retry boundary, and privacy rule applicable to this task.

Documentation Impact
Update relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The seed imports through the validated world/character import path without errors.
- [ ] #2 The seed contains 6–10 principal locations and 12–20 fictional principal characters.
- [ ] #3 Every required initial-tension threshold passes, including the shared historical misconception and launchable major arc.
- [ ] #4 Content-safety review confirms no real person, personal data, or prohibited default content.
- [ ] #5 Section 5.1: Mistwood is the only configured public world for MVP; warmup/test worlds cannot appear in the public world index or routing surface.
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
