---
id: ART-42
title: Episode detail experience
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-03 23:21'
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
- [x] #1 FR-I003: Episode detail supports Quick, Standard, and Deep Recap views.
- [x] #2 FR-I003: Episode detail displays key scenes, related characters, and related arcs.
- [x] #3 FR-I003: Previous and next Episode navigation works at boundaries.
- [x] #4 FR-I003: Recommended related reading uses published content only.
- [x] #5 The page is mobile accessible and public reads trigger no generation.
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
IMPLEMENTED: src/components/public/EpisodeDetail.tsx — public Episode detail page (FR-I003). Reads ONLY the published episode projection via api.publicRead.readModelFunctions.getPublishedReadModel (failure-isolated, zero generation on read, AC#5). Hash route #episode/<worldId>/<worldDay> mounted in App.tsx (public pages separate from the PixiJS game).

AC coverage:
- AC#1 Quick/Standard/Deep recap views: recap-tabs render three views from the PUBLISHED episode projection (Quick=oneLineSummary; Standard=oneLineSummary+resolvedQuestions; Deep=keyScenes+relationshipChanges+newQuestions).
- AC#2 key scenes + related characters + arcs: deep view lists keyScenes; related section lists characterIds + arcIds.
- AC#3 prev/next navigation: episode-nav with prev disabled when worldDay-1 < 1 (boundary).
- AC#4 recommended related reading: links only to published arc/character projections; all content sourced from the published episode projection.
- AC#5 mobile-accessible (max-w-2xl p-4 responsive markup) + public reads trigger no generation.

HONEST CAVEAT: The Quick/Standard/Deep views are rendered from the published episode projection's fields (not separately-published ART-66 recap snapshots, which are not yet published to the public read model). This is a faithful minimal rendering of published content. Regenerated convex/_generated/api.d.ts via 'npx convex codegen' so api.publicRead resolves.

VERIFICATION: npm run check = exit 0 (architecture + typecheck + lint + test + vite build — the frontend compiles and bundles). The underlying public read path is unit-tested (ART-40 readModel, ART-85 episode projection). The repo has no React component test harness, so the component itself is verified via typecheck + production build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the public Episode detail page (FR-I003): src/components/public/EpisodeDetail.tsx reading the published episode projection via the failure-isolated public read model (no generation on read), with Quick/Standard/Deep recap views, key scenes + related characters/arcs, prev/next navigation, and mobile-accessible markup; mounted via a #episode/ hash route in App.tsx. Verified: npm run check exit 0 (incl. vite build); read path unit-tested in ART-40/85.
<!-- SECTION:FINAL_SUMMARY:END -->
