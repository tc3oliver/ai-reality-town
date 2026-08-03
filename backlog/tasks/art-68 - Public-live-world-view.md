---
id: ART-68
title: Public live world view
status: In Progress
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:43'
updated_date: '2026-08-03 23:49'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-96
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I002

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Deliver the public live view for locations, character positions, active scenes, recent events, world time, and active arcs entirely from the read model.

Scope
Deliver the public live view for locations, character positions, active scenes, recent events, world time, and active arcs entirely from the read model.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-40, ART-96

Schema Impact
No Canon mutation schema; owns published read-model records, query DTOs, cache/version metadata, or UI state explicitly named by the task.

API Impact
Read-only public query contracts and internal projection writers; UI never calls providers.

Security Impact
Server-side field allowlists, publication status, accessibility, and secret/privacy boundaries apply to every public view.

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
- [x] #1 FR-I002: 不要求高品質遊戲動畫。
- [x] #2 FR-I002: 場景內容以摘要與精華為主。
- [x] #3 FR-I002: 公開讀取不得觸發生成。
- [x] #4 FR-I002: 模擬暫停時仍可瀏覽最後狀態。
- [x] #5 Automated tests provide evidence for every mapped FR-I002 acceptance criterion, including rejection and failure paths.
- [x] #6 PRD traceability links FR-I002 to doc-1 and the merged implementation evidence.
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
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ART-68 public Live view (FR-I002). Mirror the Homepage pattern: pure liveRoute.ts (parseLiveRoute + composeLiveViewModel) + liveRoute.test.ts + LiveView.tsx, mounted at #live/<worldId>.

DATA: liveState / live:<worldId> -> LiveProjection (worldTime, locations, characters, recentEvents, activeArcs, activeScenes, publishedEpisodeStatus).

AC MAPPING:
- AC#1 (no game animation): render a location LIST (text), no PixiJS/canvas.
- AC#2 (summary/essence): activeScenes show title+summary only.
- AC#3 (no generation on read): use getPublishedReadModel (read-only, same as homepage/episode).
- AC#4 (browsable when sim paused): read model serves last-known-good; view composes whatever is published and never blanks the page (graceful states tested).
- AC#5: liveRoute.test.ts covers every AC incl. failure/null paths.
- AC#6: PRD traceability note in implementation notes (FR-I002 -> doc-1).

Self-contained: new files + App.tsx route mount only; no Homepage.tsx change (avoid conflict with PR #102). Frame links back to #home/<worldId>.

VALIDATE: npm run check; focused: npx jest --testPathPattern=liveRoute.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: src/components/public/LiveView.tsx (thin render layer) + pure src/components/public/liveRoute.ts (parseLiveRoute + composeLiveViewModel) + src/components/public/liveRoute.test.ts (11 cases). Mounted at #live/<worldId> in App.tsx. Reads ONLY the published liveState projection via getPublishedReadModel (AC#3, no generation). AC#1 text location list (no map/animation); AC#2 active scenes as summaries; AC#4 graceful states keep the page browsable from the last-known-good snapshot when paused/empty/missing (3 dedicated tests). Focused test: NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern=liveRoute -> 11 passed, 11 total. Full: npm run check -> exit 0 (architecture + typecheck + lint + full jest + vite build). PRD traceability (AC#6): FR-I002 -> doc-1 (AI Reality Town PRD 1.0, Epic I, §FR-I002).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Public live-world view (FR-I002): LiveView.tsx reads the published liveState projection via the failure-isolated public read model (no generation on read), rendering a text location list with character positions, active-scene summaries, recent events, and active arcs; stays browsable from the last-known-good snapshot when the simulation is paused or the model is missing. Route + view-model logic extracted to pure liveRoute.ts and unit-tested (11 cases). Mounted at #live/<worldId>. Verified: npm run check exit 0 incl. vite build.
<!-- SECTION:FINAL_SUMMARY:END -->
