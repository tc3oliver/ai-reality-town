---
id: ART-87
title: Major-event world timeline experience
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 16:20'
updated_date: '2026-08-04 01:33'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-85
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 87000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I008

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Deliver the filterable major-event timeline and Episode navigation without showing every low-importance event.

Scope
Deliver the filterable major-event timeline and Episode navigation without showing every low-importance event.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-40, ART-85

Schema Impact
No Canon mutation schema; owns published read-model records, query DTOs, cache/version metadata, or UI state explicitly named by the task.

API Impact
Read-only public query contracts and internal projection writers; UI never calls providers.

Security Impact
Server-side field allowlists, publication status, accessibility, and secret/privacy boundaries apply to every public view.

Validation Commands
npm run check; run the task-focused automated or documented manual validation and record exact evidence.

Test Requirements
Tests or documented human evaluation cover every acceptance criterion and applicable negative, retry, and privacy cases.

Documentation Impact
Update relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Timeline defaults to major events only.
- [x] #2 Arc, character, and Event Type filters work independently and together.
- [x] #3 Displayed events navigate to related Episodes when available.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [x] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ART-87 public Timeline page (FR-I008). Frontend-only — reuses the existing timeline projection (timeline / timeline:<worldId>, already filters to major events >= 0.7 importance, satisfying AC#1 'defaults to major events only').

Mirror episode-list pattern: pure timelineRoute.ts (parseTimelineRoute + filter + composeTimelineViewModel) + test + TimelineView.tsx + App.tsx mount at #timeline/<worldId>.

AC mapping:
- AC#1 defaults to major events: the projection is major-only by construction; the page renders its entries.
- AC#2 arc + character + eventType filters (independent and combined AND).
- AC#3 entries with episodeNumber link to #episode/<worldId>/<worldDay>.

Reads via getPublishedReadModel (no generation). VALIDATE: npm run check; smoke test newcomerAcceptance.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Frontend-only: reuses existing timeline projection (timeline / timeline:<worldId>) which is major-events-only by construction (importance >= 0.7), satisfying AC#1 'defaults to major events only' — the page renders the projection verbatim and never widens it (asserted in test). src/components/public/timelineRoute.ts (pure parseTimelineRoute + timelineEntryMatchesFilters + composeTimelineViewModel, 14 tests) + TimelineView.tsx (arc/character/event-type filter selects, episode links) mounted at #timeline/<worldId>. Reads via getPublishedReadModel (no generation). Focused test: npx jest --testPathPattern=timelineRoute -> 14 passed. Full: npm run check -> exit 0 (architecture + typecheck + lint + full jest + vite build). PRD traceability: FR-I008 -> doc-1.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Public major-event world timeline (FR-I008): TimelineView.tsx reads the published timeline projection (major-events-only by construction, AC#1) via the failure-isolated public read model (no generation), with independent + combined Arc/Character/Event-Type filters (AC#2) and episode deep-links when an event's day has a published episode (AC#3). Pure route/filter logic unit-tested (14 cases). Mounted at #timeline/<worldId>. Verified: npm run check exit 0 incl. vite build.
<!-- SECTION:FINAL_SUMMARY:END -->
