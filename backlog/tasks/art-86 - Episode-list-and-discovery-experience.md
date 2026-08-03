---
id: ART-86
title: Episode list and discovery experience
status: In Progress
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 16:20'
updated_date: '2026-08-03 23:53'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-85
  - ART-67
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I004

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Deliver Episode browsing by date, arc, and character with turning-point and recommended-entry markers.

Scope
Deliver Episode browsing by date, arc, and character with turning-point and recommended-entry markers.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-40, ART-85, ART-67

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
- [ ] #1 Episodes can be browsed by date.
- [ ] #2 Episodes can be filtered by Story Arc and character.
- [ ] #3 Turning Point and Recommended Entry episodes are visibly marked.
- [ ] #4 Filtering uses published data and remains accessible on mobile.
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ART-86 public Episode list (FR-I004).

BACKEND (new projection, mirrors episodeTimelineProjection pattern):
- convex/publicRead/episodeIndexProjection.ts (pure): buildEpisodeIndex() -> list of eligible episodes with {worldDay, episodeNumber, title, headline, arcIds, characterIds, isRecommendedEntry, isTurningPoint}, sorted by worldDay. isRecommendedEntry from storyArcRecommendedEntries (ART-67); isTurningPoint from arc latestTurningPointEventId membership in episode sourceEventIds.
- episodeIndexProjection.test.ts (pure tests).
- episodeIndexProjectionFunctions.ts: rebuildEpisodeIndexProjection internalMutation -> publishes via commitReadModelVersion as modelKind 'episode', modelRef 'episodes:<worldId>'. (Unreferenced internal mutation like siblings — no codegen risk.)

FRONTEND (mirrors homepage/live pattern):
- episodeListRoute.ts (pure): parseEpisodeListRoute (#episodes/<worldId>) + composeEpisodeListViewModel (date ordering, arc/character filter sets, marking). 
- episodeListRoute.test.ts (pure tests: filter logic, marking, mobile/data-only).
- EpisodeList.tsx: reads episode/episodes:<worldId> via getPublishedReadModel; client-side date browse + arc/character filters; marks Turning Point/Recommended Entry (AC#3); mobile-accessible (AC#4); published data only (AC#3 pub). Links to #episode/<worldId>/<day>.
- App.tsx: mount #episodes/<worldId>.

AC: #1 browse by date (ordered list), #2 filter arc+character, #3 mark TP/RecEntry + published-data-only, #4 mobile-accessible, #5 automated tests, #6 PRD traceability FR-I004->doc-1.
VALIDATE: npm run check (proves codegen-safe); smoke test newcomerAcceptance.
<!-- SECTION:PLAN:END -->
