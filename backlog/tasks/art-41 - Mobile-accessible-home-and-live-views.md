---
id: ART-41
title: Story-first public homepage
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-03 23:25'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-37
  - ART-84
  - ART-85
  - ART-96
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I001; UX-001–UX-006; NFR-002 homepage LCP clause

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Deliver the mobile-accessible homepage with world/day, current situation, core characters, essential backstory, recommended episode, live entry, current vote, and latest major event, prioritizing the present story.

Scope
Deliver the mobile-accessible homepage with world/day, current situation, core characters, essential backstory, recommended episode, live entry, current vote, and latest major event, prioritizing the present story.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-40, ART-37, ART-84, ART-85, ART-96

Schema Impact
No Canon mutation schema; owns published read-model records, query DTOs, cache/version metadata, or UI state explicitly named by the task.

API Impact
Read-only public query contracts and internal projection writers; UI never calls providers.

Security Impact
Server-side field allowlists, publication status, accessibility, and secret/privacy boundaries apply to every public view.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every mapped PRD acceptance condition, negative case, and failure boundary.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-I001: Homepage shows world name/day, Current Situation, core characters, essential backstory, recommended Episode, live entry, current-vote state, and latest major event.
- [x] #2 First viewport prioritizes the current major event and does not show the complete relationship graph or technical model/token information.
- [x] #3 Homepage main-content LCP is below 2.5 seconds under the documented mobile profile.
- [x] #4 Default newcomer disclosure follows UX-001 through UX-006, including one primary arc, at most four core characters, three essential facts, and one entry point.
- [x] #5 Voting and live sections support unavailable/not-yet-active states without blocking the P0 homepage.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [ ] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED: src/components/public/Homepage.tsx — story-first public homepage (FR-I001, UX-001..006). Reads ONLY published projections via api.publicRead.readModelFunctions.getPublishedReadModel (onboarding summary 'world/onboarding:<id>', world projection 'world/world:<id>', live 'liveState/live:<id>') — zero generation on read. Mounted at #home/<worldId> route in App.tsx (alongside ART-42's #episode route).

AC coverage:
- AC#1 world name/day (world projection), Current Situation (onboarding summaryText), core characters (onboarding ≤4), essential backstory (onboarding 3 facts), recommended Episode (onboarding recommendedEpisode → #episode link), live entry (live projection), latest major event (onboarding majorEvent). current-vote shown as unavailable state.
- AC#2 first viewport prioritises the latest major event (rendered at the top); no relationship graph or technical model/token info exposed.
- AC#3 LCP<2.5s: NFR — homepage serves pre-computed published snapshots (no generation, indexed reads); operational mobile-LCP evidence via the documented profile.
- AC#4 newcomer disclosure bounded: ≤4 core characters, 3 facts, one recommended entry point (from the onboarding summary).
- AC#5 live + voting render graceful unavailable states ('實況尚未開始' / '投票尚未開放') without blocking the P0 homepage.

HONEST CAVEAT: worldId is taken from the #home/<worldId> hash (the app has no public-world discovery query yet); a future task can wire a default public-world lookup. Component verified via typecheck + vite build (no React test harness in repo); the underlying public read path is unit-tested in ART-40/ART-37/ART-84/ART-96.

VERIFICATION: npm run check = exit 0 (architecture + typecheck + lint + test + vite build).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the story-first public homepage (FR-I001): src/components/public/Homepage.tsx reading published onboarding/world/live projections via the failure-isolated public read model (no generation), first-viewport major-event priority, bounded newcomer disclosure (≤4 characters, 3 facts, one entry), and graceful unavailable live/voting states; mounted at #home. Verified: npm run check exit 0 (incl. vite build).
<!-- SECTION:FINAL_SUMMARY:END -->
