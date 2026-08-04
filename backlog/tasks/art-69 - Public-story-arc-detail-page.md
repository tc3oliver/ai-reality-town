---
id: ART-69
title: Public story arc detail page
status: Done
assignee: []
created_date: '2026-08-02 15:43'
updated_date: '2026-08-04 07:24'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-95
  - ART-38
  - ART-67
  - ART-64
  - ART-65
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I006

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Deliver the complete public Story Arc page, including premise, question, status, people, backstory, turning points, entry, episodes, clues, questions, and outcome.

Scope
Deliver the complete public Story Arc page, including premise, question, status, people, backstory, turning points, entry, episodes, clues, questions, and outcome.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-40, ART-95, ART-38, ART-67, ART-64, ART-65

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
- [x] #1 FR-I006: Arc page displays Title, Premise, Current Question, Status, Core Characters, Essential Backstory, Inciting Event, Latest Turning Point, Recommended Entry, Related Episodes, Known Clues, Unresolved Questions, and resolved Outcome when present.
- [x] #2 All displayed fields come from publication-safe arc/read projections.
- [x] #3 Archived and resolved arcs remain queryable without appearing as active context.
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
Implemented the public Story Arc detail page as the sixth page in the public-page series, following the established pure-logic + thin-render split (homeRoute/liveRoute/episodeListRoute/timelineRoute/characterRoute).

Files
- src/components/public/arcRoute.ts (new, pure, DOM-free): parseArcRoute('#arc/<worldId>/<arcId>'), ARC_ACTIVE_STATUSES + isActiveArcStatus (mirrors convex/story/lifecycle.ts: active|escalating|climax|resolving), ARC_FORBIDDEN_KEYS + forbiddenKeysInArcViewModel, composeArcViewModel.
- src/components/public/arcRoute.test.ts (new): 15 tests, pure jest, no jsdom.
- src/components/public/ArcDetailPage.tsx (new): thin render layer, zero business logic.
- src/App.tsx: import + '#arc/' hash-route branch, matching the five existing public-page branches.

Data sources (verified against the running dev deployment, not just fixtures)
- Published arc projection: getPublishedReadModel({worldId, modelKind:'arc', modelRef:'arc:<arcId>'}) built by rebuildArcProjection -> buildArcProjection (convex/publicRead/relationshipArcProjection.ts). Field names taken directly from the ArcProjection type, not guessed.
- Published arc primer (ART-38): same modelKind 'arc' with modelRef 'primer:<arcId>'. The primer is genuinely needed, not decorative: the arc projection carries coreCharacterIds (ids only) and latestTurningPointEventId (id only), while the primer supplies the core-character display NAMES and the human-readable turning-point summary. The primer summary is only attached when primer.structured.turningPoint.eventId matches the arc projection's latestTurningPointEventId, so a stale primer can never mislabel a newer turning point.
- unresolvedQuestions: the arc projection's list wins; the primer's bounded list (which seeds itself from currentQuestion) is the fallback. This matters in practice - see live evidence below.

Privacy / publication boundary (AC#2)
composeArcViewModel builds the view model from NAMED fields only and never spreads or copies the input payload, replicating the ART-43 characterRoute defence-in-depth idiom over the server-side allowlist. The headline test smuggles hiddenTruth/secretPlan/plannedTwist/privateGoal/knowledge/memory/prompt/rawModelOutput/adminNotes/secret/token into the arc payload and asserts that neither the keys nor their values reach the view model.

Active-context handling (AC#3)
statusLabel = { status, label, isActiveContext }. Resolved and archived arcs still compose fully (title, premise, episodes, clues, outcome all render, so the page stays queryable) but report isActiveContext:false and are badged '(非進行中故事線)' in the header, so they never present as active mainline.

Accessibility (keeps ART-93 tractable)
Single h1 + h2 per section, aria-labelled sections, plain <a> links (keyboard-navigable by default), no images so no alt-text surface, no interactive non-semantic elements.

Live verification against real data (world 'mistwood', dev deployment)
npx convex run publicRead/readModelFunctions:getPublishedReadModel '{"worldId":"mistwood","modelKind":"arc","modelRef":"arc:arc:mistwood:50"}' -> published v23, contentHash rmhash:512ae46b, servedFrom 'current'. Real payload keys exactly matched the ArcProjectionPayload type (schemaVersion, worldId, arcId, title, premise, currentQuestion, status, coreCharacterIds, essentialBackstory, incitingEventId, latestTurningPointEventId, recommendedEntry, relatedEpisodes, knownClues, unresolvedQuestions, outcome).
The real payload was then fed through parseArcRoute + composeArcViewModel + forbiddenKeysInArcViewModel in a throwaway jest harness (deleted before commit); it produced: title 'Arc from world day 2 (noon)', status resolving -> label 收束中 / isActiveContext true, 2 core characters resolved to display names 'He Jun' and 'Zhao Ming' via the primer with hrefs #character/mistwood/he-jun and #character/mistwood/zhao-ming, incitingEventId mistwood#event#50, latestTurningPoint mistwood#event#74 WITH the primer summary attached, recommendedEntry ep3/day2 -> #episode/mistwood/2, 2 related episodes (ep3/day2, ep4/day3), 5 backstory facts, 36 known clues, and forbiddenKeysInArcViewModel = [].
Note this exercised a real behaviour a fixture alone would not have: the live arc projection's own unresolvedQuestions array is EMPTY, and the page correctly fell back to the primer's question ('How will he-jun settle what happened at mistwood-mill?').
Also confirmed live: arc ids contain colons ('arc:mistwood:50'), so the route was explicitly tested for colon-bearing and percent-encoded arc ids.

Honest gap (AC#1 outcome field)
The projection DOES carry a real 'outcome' field (populated by rebuildArcProjection from arcConsequenceSummaries where scope==='world'), so no field is missing and nothing was fabricated. However every arc currently in the live world is at status 'resolving' or earlier, so no live arc has a non-null outcome yet; the resolved-outcome render path is proven by unit test only, not by live data. Likewise primer character 'role' is null in live data, so the role suffix renders empty in practice.

Validation: npm run check -> exit 0 (check:architecture, test:architecture, typecheck, lint, jest 71 suites / 696 tests, vite build). Focused command: NODE_OPTIONS=--experimental-vm-modules npx jest src/components/public/arcRoute.test.ts -> 15/15 passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered the complete public Story Arc detail page (FR-I006) as src/components/public/arcRoute.ts (pure, DOM-free route parsing + view-model composition + publication-boundary guard), arcRoute.test.ts (15 pure jest tests, no jsdom), ArcDetailPage.tsx (thin render layer, zero business logic), and a '#arc/<worldId>/<arcId>' branch in src/App.tsx — the sixth page in the public-page series, following the same split as the five shipped siblings.

The page renders every FR-I006 field (title, premise, current question, status, core people, essential backstory, inciting event, latest turning point, recommended entry, related episodes, known clues, unresolved questions, outcome) from the published 'arc:<arcId>' projection (ART-65/ART-95) plus the bounded 'primer:<arcId>' primer (ART-38), both read through the failure-isolated getPublishedReadModel with no generation on read (AC#2). The primer is load-bearing: it supplies the core-character display names and the turning-point summary that the arc projection only carries as bare ids, and its summary is attached only when its eventId matches the projection's latestTurningPointEventId. Resolved and archived arcs compose fully so they stay queryable but report isActiveContext:false and are badged inactive, so they never present as active mainline (AC#3).

Verified: npm run check -> exit 0 (check:architecture, test:architecture, typecheck, lint, jest 71 suites / 696 tests, vite build). Focused command: NODE_OPTIONS=--experimental-vm-modules npx jest src/components/public/arcRoute.test.ts -> 15/15 passed.

Verified against LIVE data, not fixtures alone: the real published mistwood arc (modelRef 'arc:arc:mistwood:50', version 23, contentHash rmhash:512ae46b, servedFrom 'current') was fed through parseArcRoute + composeArcViewModel + forbiddenKeysInArcViewModel and produced status resolving -> 收束中/active, core characters resolved to 'He Jun' and 'Zhao Ming' with #character/mistwood/... hrefs, incitingEventId mistwood#event#50, turning point mistwood#event#74 with its primer summary attached, recommendedEntry ep3/day2 -> #episode/mistwood/2, 2 related episodes, 5 backstory facts, 36 known clues, and zero forbidden keys. That run exercised two behaviours a fixture would have missed: the live arc's own unresolvedQuestions array is empty and the page correctly fell back to the primer question, and live arc ids contain colons ('arc:mistwood:50') so colon-bearing and percent-encoded route ids are explicitly tested.

AC#1 is checked with one documented caveat: the projection does carry a real 'outcome' field (populated by rebuildArcProjection from arcConsequenceSummaries where scope==='world'), so no field is missing and no data was fabricated, but every live arc is still at status 'resolving' or earlier, so the resolved-outcome render path is proven by unit test only rather than by live data. Primer character 'role' is likewise null in live data today.

PR https://github.com/tc3oliver/ai-reality-town/pull/114 opened with auto-merge enabled (DoD #14 left unchecked until GitHub completes the merge).
<!-- SECTION:FINAL_SUMMARY:END -->
