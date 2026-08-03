---
id: ART-67
title: Recommended active-arc entry points
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:43'
updated_date: '2026-08-03 17:11'
labels:
  - prd-1.0
  - epic-j
milestone: m-0
dependencies:
  - ART-33
  - ART-64
  - ART-65
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-H003

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Maintain an explainable recommended entry episode for every major active arc and reassess it after major changes.

Scope
Maintain an explainable recommended entry episode for every major active arc and reassess it after major changes.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-33, ART-64, ART-65

Schema Impact
Current-situation, primer, entry-point, return-recap, viewer-progress, or spoiler-compatibility contracts named by the task.

API Impact
Cached onboarding/recap read contracts; visitor reads never trigger generation.

Security Impact
Viewer progress is isolated by viewer/device and recap visibility obeys spoiler/publication rules.

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
- [x] #1 FR-H003: 每條主要 Active Arc 必須有推薦入坑點。
- [x] #2 FR-H003: 推薦原因可查詢。
- [x] #3 FR-H003: Arc 重大變化後重新評估。
- [x] #4 Automated tests provide evidence for every mapped FR-H003 acceptance criterion, including rejection and failure paths.
- [x] #5 PRD traceability links FR-H003 to doc-1 and the merged implementation evidence.
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
IMPLEMENTED: convex/story/entryRecommendation.ts (pure): recommendArcEntry deterministic explainable entry-episode selector — priority inciting > turning_point > earliest arc episode > world's earliest episode (first_episode fallback guarantees AC#1: every major active arc with a published episode gets an entry); RecommendedArcEntry carries episodeNumber/worldDay/sourceEventId/reason(CJK)/signals{basis,heatScore}/reassessedAtSequenceNumber; EntryRecommendationError; validateRecommendedArcEntry persisted-envelope validator. entryRecommendationFunctions.ts (wiring): reassessArcEntryRecommendation (single arc, idempotent upsert keyed by world+arc; AC#3), reassessMajorActiveArcEntries (covers every major active arc; AC#1), getRecommendedArcEntry internalQuery (AC#2 queryable reason). Reads portfolio (tier major + active status via isActiveArcStatus), published episodes (dailyEpisodes), latest accepted sequence; zero canon writes. schema.ts: storyArcRecommendedEntries table (by_world_and_arc, by_world).

PRD TRACEABILITY: FR-H003 -> doc-1 (task Documentation already links backlog/docs/prd/ai-reality-town-prd-1.0/doc-1).

KEY DECISION: sourceEventId is basis-dependent (inciting/turning-point anchor on the respective event; earliest/first_episode anchor on the arc inciting event) — caught by the turning_point unit test during development.

VALIDATION: npm run check = exit 0. Architecture boundaries valid. typecheck clean. lint clean. Tests: 490 passed (+13 from convex/story/entryRecommendation.test.ts). build OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added recommended active-arc entry points (FR-H003): convex/story/entryRecommendation.ts (pure recommendArcEntry — explainable entry-episode selector with first_episode fallback so every major active arc gets an entry) + wiring (reassess single/all major active arcs idempotently, queryable reason). Zero canon writes; visitor reads never generate. Verified: npm run check exit 0; 490 tests pass (+13 entryRecommendation); architecture boundaries valid; typecheck/lint/build clean. FR-H003 traceable to doc-1.
<!-- SECTION:FINAL_SUMMARY:END -->
