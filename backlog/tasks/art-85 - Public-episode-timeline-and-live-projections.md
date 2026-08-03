---
id: ART-85
title: Public Episode and Timeline projections
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 16:20'
updated_date: '2026-08-03 17:19'
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
- [x] #1 Episode projection includes only eligible published editorial content and all detail/list query fields.
- [x] #2 Timeline defaults to major events and retains Arc, Character, Event Type, and Episode-link keys.
- [x] #3 Both remain last-known-good during simulation failure and refresh after corrections.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED: convex/publicRead/episodeTimelineProjection.ts (pure): buildEpisodeProjection (eligible published editorial content only — ELIGIBLE_EPISODE_STATUSES ready/published; throws on withheld/failed, AC#1; projects detail+list fields), buildTimelineProjection (defaults to importance >= TIMELINE_MAJOR_IMPORTANCE 0.7; retains Arc/Character/EventType/Episode-link keys, AC#2; ordered by worldDay/timeSlot/eventId), EpisodeTimelineError. episodeTimelineProjectionFunctions.ts (wiring): rebuildEpisodeProjection (world-day) + rebuildTimelineProjection (world) internalMutations publish via commitReadModelVersion (modelKind episode/timeline). Extended readModel.ts READ_MODEL_KINDS + schema.ts modelKind union + readModelFunctions.ts modelKindValidator with 'timeline' (extensible infra). Public reads reuse ART-40 getPublishedReadModel; both projections are last-known-good during simulation failure (AC#3). Zero canon writes.

PRD TRACEABILITY: §13.10 Episode / §13.8 World Event timeline -> doc-1.

VALIDATION: npm run check = exit 0. Architecture boundaries valid. typecheck clean. lint clean. Tests: 506 passed (+7 from convex/publicRead/episodeTimelineProjection.test.ts). build OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added publication-safe Episode and major-event Timeline projections (§13.10/§13.8): pure builders (Episode projects only eligible published editorial content, AC#1; Timeline defaults to major events retaining Arc/Character/EventType/Episode-link keys, AC#2) + rebuild wiring publishing them as episode/timeline read-models via ART-40 (last-known-good + idempotent refresh, AC#3). Extended the read-model modelKind set with 'timeline'. Verified: npm run check exit 0; 506 tests pass (+7); architecture boundaries valid; typecheck/lint/build clean.
<!-- SECTION:FINAL_SUMMARY:END -->
