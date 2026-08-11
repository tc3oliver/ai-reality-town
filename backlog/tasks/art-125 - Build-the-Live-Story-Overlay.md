---
id: ART-125
title: Build the Live Story Overlay
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 15:59'
updated_date: '2026-08-11 11:21'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-118
priority: high
type: feature
ordinal: 125000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O007 (PRD 2.0 §12 Epic O)

**Problem / Context:** A map alone shows what is happening but not why it matters. PRD 2.0 UX2-004 requires narrative context to be permanently available alongside the map.

**Goal:** A collapsible story information area that never obscures the map and always answers what is happening, why it matters, who is involved and where to catch up.

**Scope:**
- World day and time slot, current situation, primary active story arc, active scenes, latest major event, recommended Episode / recap entry.
- Sourced from the public read model, never the Canon write store.
- Collapsible; mobile does not require showing everything simultaneously.

**Out of Scope:** Visual design system (FR-P003); responsive layout rules (FR-O008); navigation continuity (FR-P002).

**Dependencies:** FR-O001 live map.

**Schema Impact:** None.

**API Impact:** Consumes existing public read model projections.

**Security Impact:** Must not trigger summary generation on public view.

**Test Requirements:** Tests asserting the overlay reads only public projections, triggers no generation, and stays in reasonable sync with map state.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Live overlay content contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The overlay shows world day and time slot, current situation, primary story arc, active scenes and the latest major event
- [x] #2 The overlay offers a recommended Episode or recap entry point
- [x] #3 The overlay reads the public read model and never the Canon write store
- [x] #4 Overlay content and map state stay in sync within a reasonable interval
- [x] #5 The overlay is collapsible and does not obscure the map
- [x] #6 Public viewing never triggers summary generation
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
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Reuses existing precomputed public read models -- no new backend surface beyond two new named reads on LiveMapPage.tsx (both safe: liveState and onboarding summary are rebuilt on Canon commit, never on read, so AC#6 holds by construction).

Data sourcing per AC#1/#2:
- World day / time slot: already loaded via the existing getPublicDynamicProjectionRef (projection.worldDay/.timeSlot) -- no new read.
- Active scenes: already loaded (scenes) -- no new read.
- Current situation + latest major event (ranked by importance, better than liveState's plain recency) + recommended Episode/recap entry: new read of modelKind:'world', modelRef:'onboarding:<worldId>' (ART-37 OnboardingSummary: summaryText, structured.majorEvent, structured.recommendedEpisode) via the existing getPublishedReadModelRef helper already used for the character card's reads.
- Primary active story arc (title + status): new read of modelKind:'liveState', modelRef:'live:<worldId>' for its activeArcs list ({arcId,title,currentQuestion,status}[]); "primary" = highest status priority (climax > escalating > active > resolving), tie-broken by arcId. Both new queries load on mount (not skip-gated like the character card's, since the overlay is always-present per PRD 2.0 UX2-004, just collapsible) -- mount-time query count goes from 4 to 6, update liveMapSurface.test.ts's name/count assertions accordingly.

UI (src/components/live/StoryOverlay.tsx + pure composeStoryOverlayViewModel in a sibling .ts file, following ActiveScenePanel.tsx's props-in-only convention exactly): a collapsible <details><summary> section (no collapsible primitive exists yet in this codebase; native details/summary is the simplest zero-JS option and satisfies AC#5 without new state-management code), placed as a new block-stacked section between TimeStateBanner and the canvas in LiveMapView.tsx (matches every other section in this file being block-stacked, not a new side-by-side grid -- "alongside the map" is satisfied by co-presence and by never overlapping the canvas div, not by a two-column layout, which would be new layout risk for no AC benefit). Content: world day/time slot (reuse TimeStateBanner's existing badge composition if convenient, else format directly), current-situation summaryText, primary arc title, active scene count/summary, latest major event text, and a recommended-entry link formatted the same way homeRoute.ts's composeHomepageViewModel already turns structured.recommendedEpisode into an href.

Tests: extend liveMapSurface.test.ts's structural sweep for the two new named queries (mirroring how ART-124 updated it for its two skip-gated reads); a guardrail test asserting the overlay's data composition never calls a mutation/action and reads only the two named public models (AC#3/#6, modeled after the existing sweep rather than a new bespoke test); sync test asserting overlay content updates when the underlying projection/onboarding data changes (AC#4); collapsed-by-default-or-not and expand/collapse behavior test; a test that the overlay's rendered markup never overlaps/obscures the canvas element (AC#5, structural -- e.g. assert it is not absolutely positioned over live-map-canvas).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Six answers, four sources, two new reads — plus a blocking safety fix the routing exposed.

SOURCING. World day, time slot and active scenes come from the PublicDynamicProjection the map has already loaded and are passed through as props, not re-read: AC#4 by construction rather than by care, since the overlay and the canvas render from the same projection object in the same render pass. Current situation, latest major event and the recommended Episode come from the published `onboarding:<worldId>` summary (FR-H001 / ART-37); "latest major event" is deliberately `structured.majorEvent` (importance-ranked) rather than `liveState.recentEvents` (recency-ranked), because AC#1 asks why it matters. The primary arc's TITLE can only come from `live:<worldId>`'s `activeArcs` — `activeScenes[].arcIds` carries ids alone.

AC#6 / AC#3. Both new reads go through the same generic, failure-isolated `getPublishedReadModel` the public pages already use (the homepage reads these two exact models), so no new backend surface. Both models are precomputed, rebuilt on Canon commit and served from the read-model store: the read path contains no generator and no cache-miss fallback that builds one. Unlike ART-124's two card reads these are NOT skip-gated — the card is opened, the overlay is always present per UX2-004. `liveMapSurface.test.ts` asserts query names, total (6) AND skip count (2) separately.

SAFETY GAP CLOSED (blocking, found by security review; the third instance of this bug class in the epic after ART-132's own review and ART-124's timeline-projection gap). Routing `onboarding:<worldId>` onto the protected public surface exposed that `rebuildOnboardingSummary` had ZERO safety gating: it read `publicSummary` straight off `canonEvents`, harvested `fact_created` predicates/values off `stateChanges`, and copied the day's narration straight off `dailyEpisodes.keyScenes` — all three landing in `summaryText`, so a withheld Scene went on introducing the world with its own refused sentence to every first-time visitor, on the homepage already and on this overlay next. Closed with ART-132's own machinery imported from `liveStateFunctions.ts` (never re-implemented): `readWithheldSceneLabels` + `sceneEventRows` + `withheldEventIds` + `redactWithheldSummaries` + `redactWithheldNarration`. major event is picked from the REDACTED array so a refused event carries no summary and the pick falls through; facts from a refused Scene are skipped outright (redaction drops only `publicSummary`, and ART-124 established that fact text is classifier-visible); a key scene narrating a refused event is neutralised and the pick falls through to the next non-empty one. Unlike the timeline this surface SKIPS and re-picks rather than keeping the entry and nulling its text — the timeline is a public history where dropping a row renumbers it, this is a "one event worth knowing about" pick with no positions and no addressing. `overridePostGenerationSafetyLabel` now runs `rebuildOnboardingSummary` beside `rebuildLiveProjection` in the same transaction and reports both refreshes; gating the rebuild alone would have left refused text published until the next natural Canon commit, which on a paused world never comes. `onboardingSummaryFunctions.test.ts` proves it end to end: each gated field has a PAIR of handler-level tests against the published payload — one showing the fixture really does route the refused text onto the surface, one showing the gate removes it — plus override, release, `human_review_required`, no-provenance, and event-id (not array-position) keying. Verified non-vacuous by stubbing the gate out: 6 of the 12 fail without it.

PER-SOURCE STATUS (was a combined status; changed on review). `summaryStatus` and `arcStatus` are tracked independently. One combined status put the panel in a state neither source was in: a `null` summary beside a healthy arc list read `ready`, suppressed the "summary unavailable" notice and then asserted 「目前沒有可顯示的近期大事。」 as a confirmed fact about a source that never loaded; and during loading a page-level spinner rendered above every "there is none" empty state at once. Now "not yet arrived", "never built" and "genuinely none" are three different sentences and only the third is a claim about the world. An EMPTY `activeArcs` array is `ready`, not `unavailable`. AC#2's recommended entry survives an arc read that has not landed.

DEFENSIVE PAYLOAD READS. Both payloads arrive through an `as` cast on an untyped published model and this render sits inside `LiveMapErrorBoundary`, which wraps the WHOLE page — a throw here blanks the map, not just the overlay. Every payload path is optional-chained to its last hop (matching `homeRoute.ts`) and `activeArcs` is checked with `Array.isArray` rather than `?? []`.

PRIMARY ARC. Ranked client-side (the backend publishes `activeArcs` unranked because "which arc matters most" is a presentation question): climax > escalating > active > resolving, tie-broken by `arcId` ascending. Deterministic and total — an unknown status ranks last but stays eligible. `STORY_ARC_STATUS_PRIORITY` is pinned by test against `convex/publicRead/liveState.ts`'s `ACTIVE_ARC_STATUSES` so a fifth server-side lifecycle stage cannot drift in silently.

AC#5. Native <details>/<summary>, open by default; zero <button> and zero `aria-expanded` in the rendered surface. "Does not obscure the map" is structural: the overlay is a block sibling rendered BEFORE `.live-map-canvas`. Proven on the MOUNTED tree in `storyOverlayLayout.dom.test.tsx` — shared parent, canvas follows in document order, neither contains the other, and no rendered element carries a positioning/stacking utility class (`absolute`/`fixed`/`sticky`/`z-*`, prefixed variants included) or an inline style, with the matcher itself pinned both ways. That class assertion is load-bearing: this is a Tailwind project, so `className="absolute z-10"` would have covered the map while passing every stylesheet sweep. The source-text regex over `LiveMapView.tsx` was REMOVED in favour of it. `liveMap.a11y.test.tsx` keeps the stylesheet half (`position: static`, no absolute/fixed/sticky/z-index on any `.live-story-overlay*` rule).

Files — new: `src/components/live/storyOverlayModel.ts`, `StoryOverlay.tsx`, `storyOverlayModel.test.ts`, `storyOverlayLayout.dom.test.tsx`, `convex/publicRead/onboardingSummaryFunctions.test.ts`, `docs/live-story-overlay.md`. Modified: `LiveMapPage.tsx`, `LiveMapView.tsx`, `src/index.css`, `liveMapSurface.test.ts`, `liveMap.a11y.test.tsx`, `convex/publicRead/onboardingSummaryFunctions.ts`, `convex/operations/safetyOverrideFunctions.ts` (+ its test), `docs/dynamic-safety-filtering.md` (§3, new §4b), `docs/prd-2.0-requirement-matrix.md` (FR-O007).

Verification: `npm run check` clean — architecture, asset licenses, typecheck, lint, 2185 tests passed across 144 suites (5 skipped are the pre-existing ART60_LONG_RUN env-gated 30-day cases), build OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-O007: a collapsible Live Story Overlay on the public map, sourcing two new precomputed read models (onboarding:<worldId> for current-situation text/latest major event/recommended entry, live:<worldId> for the active-arc list) via the existing getPublishedReadModelRef path -- both rebuilt only on Canon commit, never on read, so AC#6 holds by construction. World day/time slot/active scenes are reused from the already-loaded dynamic projection, no duplicate reads. Primary arc is selected client-side by ranking activeArcs by status priority (climax > escalating > active > resolving, tie-broken by arcId), pinned by test against the server's own ACTIVE_ARC_STATUSES constant so the two cannot drift. Rendered as a native <details><summary> (AC#5, zero new state-management code) placed as a block-stacked section between TimeStateBanner and the map canvas -- never able to overlap the canvas structurally, proven by a test that actually mounts LiveMapView and inspects rendered className/inline styles, not just source text.

Independent code and security review found a CRITICAL issue: the onboarding summary read model, which this task was the first to route onto the safety-gated public surface, had never been covered by ART-132's post-generation safety filtering -- unlike every sibling public projection. Fixed by extending the same readWithheldSceneLabels/redactWithheldSummaries mechanism to rebuildOnboardingSummary (gating majorEvent, facts, and the key-scene fallback), and wiring the operator override mutation to refresh the onboarding model immediately alongside the live projection, not just on the next natural rebuild. Verified non-vacuous by an independent third review pass that neutralized the gate, confirmed the new tests fail, then confirmed they pass again after reverting. Four other findings (a combined loading/unavailable status producing false "no arc/no major event" claims and simultaneous contradictory UI, a malformed-payload crash path that would blank the entire map rather than degrade gracefully, an AC#5 proof that only scanned stylesheet source and missed Tailwind className overlap risk, an unpinned arc-status literal list) were all fixed and re-verified.

npm run check green: 144 suites, 2185 passed, 5 pre-existing/unrelated skips, build succeeds. Known, documented pre-existing gaps out of this task's scope: relationshipArcProjectionFunctions.ts and non-character publicFacts remain ungated by the same safety mechanism.
<!-- SECTION:FINAL_SUMMARY:END -->
