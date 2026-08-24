---
id: ART-130
title: 'Connect Live, Episode, character and arc navigation'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 15:59'
updated_date: '2026-08-24 14:04'
labels:
  - prd-2.0
  - v2-h
  - epic-p
dependencies:
  - ART-122
  - ART-124
priority: high
type: feature
ordinal: 130000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-P002 (PRD 2.0 §12 Epic P)

**Problem / Context:** Live Town and the editorial surfaces currently exist as disconnected routes, so viewers cannot move between "what is happening now" and "what it means".

**Goal:** Continuous navigation in both directions between the live world and editorial content, without losing viewing context.

**Scope:**
- Ended active scenes link to the related Episode or event.
- Episodes link back to the related characters and their map locations.
- Story arcs link to their core characters or scenes currently on the map.
- Recommended entry openable directly from the live overlay.
- Preserve viewing progress and current focus across navigation.

**Out of Scope:** Overlay content (FR-O007); homepage entry (FR-P001).

**Dependencies:** FR-O003 active scene visualization; FR-O006 character card.

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** None.

**Test Requirements:** Navigation E2E in both directions asserting focus and progress are preserved.

**Validation Commands:**
- `npm run check`
- Browser E2E of live-to-Episode and Episode-to-map navigation.

**Documentation Impact:** Navigation map documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An ended active scene links to the related Episode or event
- [x] #2 An Episode links back to related characters and their map locations
- [x] #3 A story arc links to its core characters or scenes on the map
- [x] #4 The recommended entry can be opened directly from the live overlay
- [x] #5 Navigation preserves viewing progress and current focus
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

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two of the five criteria were already satisfied by earlier tasks, and are recorded as such rather than re-implemented: AC#1 (an ended scene links to its Episode) by ART-122's ActiveScenePanel, and AC#4 (the recommended entry openable from the overlay) by ART-125's StoryOverlay — both already asserted in liveMap.a11y.test.tsx.

WHAT WAS ACTUALLY MISSING. Episode -> character and arc -> character existed as links to the PAGES. Nothing answered 'where are they right now', which is the map. Both surfaces now render a per-row '在地圖上查看' link to `?focus=character:<id>&card=1` — the card too, not just the camera, because 'where is this person' and 'what are they doing' are one question and the camera alone answers half of it. The map link is an ADDITION, never a replacement: both pages still link to the character page beside it, and the test asserts that.

ONE NAMESPACE, ONE OWNER. The focus-target constructors moved from components/world/cameraModel into components/live/liveMapRoute, with cameraModel re-exporting them so no importer changed. The move was forced by the architecture check refusing clientPublic -> clientWorldReadOnly, and that refusal was right. The alternative was writing `character:${id}` a second time in components/public — two namespaces that happen to agree today, where changing the prefix in one silently stops every editorial link resolving and drops viewers at an unfocused map with NOTHING FAILING ANYWHERE. clientLiveRoute is the one module all three sides may depend on because it depends on nothing itself; clientWorldReadOnly gained it as a permitted dependency, a one-line change that cannot create a cycle. liveMapLinks.test.ts asserts the ROUND TRIP rather than a literal href for exactly that reason — a test expecting '/live/mistwood?focus=character%3Ahe-jun' would keep passing after the prefix changed while every real link was broken. Round trips cover ids needing escaping (&, =, /, CJK) and scene ids containing colons.

AC#5 uses two mechanisms, both already established here rather than invented. The camera is recorded per world in sessionStorage on every change and restored on the next mount: a viewer watching the mill who follows a scene to its Episode and comes back is looking at the mill again, not at the town view as if they had just arrived — navigation is only continuous if the return leg is. Replay progress needed nothing new; ART-121's replaySession already marks a replay auto-played per tab.

PRECEDENCE. An explicit ?focus= always wins over the remembered camera: a viewer who just clicked '在地圖上查看 何俊' is asking for 何俊 NOW, and restoring the mill they were watching an hour ago would ignore the thing they clicked. With neither, resolveLiveEntry returns `mode: undefined` — no opinion — so the map keeps its own default rather than this module becoming a second place that decides it. A card is never re-opened from memory: opening one is something a viewer does, and doing it for them every return is the page deciding on their behalf.

FAIL OPEN, unlike the replay mark. replaySession fails CLOSED because its failure mode is auto-playing repeatedly. This one's failure mode is merely arriving at the town view — the ordinary first-visit experience — so no storage, blocked storage, a throw on access, malformed JSON, a wrong field type and a stored zoomStep of 1e9 all answer 'nothing remembered', and nothing becomes unreachable. resolveLiveEntry is pure and lives outside the component precisely so all four branches and every malformed record are reachable from a unit test with a fake storage rather than only through a renderer.

VERIFICATION. npm run check green — 148 suites, 2254 passed, 5 pre-existing skips, build succeeds. New: liveViewSession.test.ts (round trip, per-world scoping, fail-open on every storage failure, totality over 12 malformed records, zoom bounding, and the four precedence branches), liveMapLinks.test.ts (round trips against the consumer, not against literals), and a11y assertions that both pages actually render the links with per-row accessible names starting with the visible label (WCAG 2.4.4 / 2.5.3), carrying the touch target, and staying axe-clean.

NOT COVERED. A real browser navigating and returning. No headless browser runs in this repo; that is ART-137, whose remit explicitly includes navigation in both directions. This is the structural floor under it, not a substitute.

See docs/live-editorial-navigation.md.
<!-- SECTION:FINAL_SUMMARY:END -->
