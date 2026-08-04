---
id: ART-70
title: Viewer spoiler-mode data compatibility
status: In Progress
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:43'
updated_date: '2026-08-04 01:49'
labels:
  - prd-1.0
  - epic-j
milestone: m-0
dependencies:
  - ART-40
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-H005

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Ensure viewer/read schemas can later support Full Viewer Perspective, Public Information Only, and Watched Episodes Only without implementing the full P2 UI.

Scope
Ensure viewer/read schemas can later support Full Viewer Perspective, Public Information Only, and Watched Episodes Only without implementing the full P2 UI.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-40

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
- [x] #1 MVP viewer-progress and public-read schemas represent all three future spoiler perspectives without destructive migration.
- [x] #2 MVP need not expose complete spoiler-mode UI or behavior.
- [x] #3 Compatibility tests prove current visibility fields permit later watched-episode filtering.
- [x] #4 PRD traceability links FR-H005 to doc-1 and evidence.
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
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ART-70 viewer spoiler-mode data compatibility (FR-H005). Establishes the convex/viewer domain (already declared in module-boundaries.json, mayDependOn publicRead/safety/shared).

1. convex/viewer/spoilerMode.ts (pure): SPOILER_MODES = ['full','publicOnly','watchedOnly']; isVisibleUnderMode(item {visibility, worldDay}, mode, watchedWorldDays). Proves the 3 FR-H005 modes filter using ONLY current fields (visibility + episode-day provenance) + a watched set -> no destructive migration (AC#1/#3).
   - full: all (incl private); publicOnly: visibility != private; watchedOnly: visibility != private AND worldDay in watched.
2. convex/viewer/schema.ts: viewerTables.viewerEpisodeProgress (worldId, viewerKey, worldDay, episodeNumber?, watchedAt) indexed by_viewer_world_day. Forward-compatible declaration; NOT populated in MVP (AC#2). Unreferenced table -> codegen-safe like projections.
3. convex/viewer/spoilerMode.test.ts: compatibility tests (AC#3) for all 3 modes + private/public filtering + watched scoping.
4. Wire: spread viewerTables in convex/schema.ts; add convex/viewer to lint scope in package.json.
AC#4 PRD traceability FR-H005 -> doc-1. VALIDATE: npm run check (incl. architecture boundary for new viewer module).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Established the convex/viewer domain (pre-declared in module-boundaries.json; mayDependOn publicRead/safety/shared). Files: convex/viewer/spoilerMode.ts (pure SPOILER_MODES=['full','publicOnly','watchedOnly'] + isVisibleUnderMode + filterBySpoilerMode; filters over ONLY {visibility, worldDay} + watched set), convex/viewer/schema.ts (viewerEpisodeProgress table — forward-compatible, not populated in MVP per AC#2), convex/viewer/spoilerMode.test.ts (10 compatibility tests, AC#3). Wired: spread viewerTables in convex/schema.ts; added convex/viewer to lint scope in package.json. Architecture boundaries valid (11 modules). Focused test: npx jest --testPathPattern=viewer/spoilerMode -> 10 passed. Full: npm run check -> exit 0. PRD traceability (AC#4): FR-H005 -> doc-1 (PRD §FR-H005 劇透控制).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Viewer spoiler-mode data compatibility (FR-H005): new convex/viewer domain declares the three spoiler modes (full/publicOnly/watchedOnly) with pure filtering that runs over existing visibility + episode-day fields only, plus a forward-compatible viewerEpisodeProgress schema — so P2 spoiler UI needs no destructive migration. MVP declares modes + schema but no UI/population. 10 compatibility tests. Verified: npm run check exit 0 (architecture: 11 modules valid).
<!-- SECTION:FINAL_SUMMARY:END -->
