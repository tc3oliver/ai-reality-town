---
id: ART-135
title: Deliver dynamic view accessibility baseline
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 15:59'
updated_date: '2026-08-24 15:12'
labels:
  - prd-2.0
  - v2-j
  - epic-o
dependencies:
  - ART-126
  - ART-120
priority: high
type: feature
ordinal: 135000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-Q004 (PRD 2.0 §12 Epic Q) — realizes NFR2-006 (PRD 2.0 §16)

**Problem / Context:** A canvas-rendered animated map is inherently hostile to keyboard and assistive technology users, and continuous ambient motion is a vestibular risk. PRD 2.0 §22 makes Reduced Motion and a non-map alternative view release gates. FR-Q004 exists so this non-functional requirement has a traceable requirement id and a named owner rather than being implied across other tasks.

**Goal:** The dynamic world is comprehensible and navigable without using the map canvas.

**Scope:**
- Equivalent non-map list of characters, locations and scenes.
- Keyboard focus for primary characters and scenes.
- Reduced Motion support, including disabling ambient movement, environmental animation and replay auto-play.
- Animation and status state never conveyed by colour alone.
- Readable text alternatives for important information.

**Out of Scope:** Graph and timeline accessibility (ART-94, carried forward per PRD 2.0 §13).

**Dependencies:** ART-126 (responsive experience), ART-120 (ambient and environmental animation).

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** None.

**Test Requirements:** Keyboard navigation tests, Reduced Motion behaviour tests, non-map alternative view tests, and a check that state is not colour-only.

**Validation Commands:**
- `npm run check`
- Accessibility checks over the live surface.

**Documentation Impact:** Update the accessibility documentation with the dynamic surface.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An equivalent non-map list of characters, locations and scenes is available
- [x] #2 Primary characters and scenes are keyboard focusable
- [x] #3 Reduced Motion disables ambient movement, environmental animation and replay auto-play
- [x] #4 Animation and status states are not conveyed by colour alone
- [x] #5 Important information has a readable text alternative
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
The live map is the one P0 surface whose accessibility cannot be settled from markup: its centre is a canvas, and every claim that matters is about what a browser does with one on the page — whether Tab really reaches the controls with a ring that is actually painted, whether Reduced Motion really stops the animation, whether the canvas is really inert to assistive technology, whether axe passes on the page as it renders. jsdom has no layout, no focus ring and no animation. So this is a Playwright suite on ART-137's harness, desktop and mobile, against WCAG 2.1 A/AA tags — 15 tests per project, 30 green — and it deliberately does NOT restate what liveMap.a11y.test.tsx and publicPages.a11y.test.tsx already cover.

AC#1: the map's signpost link is FOLLOWED to /live/<worldId>/text, which renders no canvas, carries characters, locations and scenes as text, and is axe-clean. AC#2: a control is reached BY KEY, activated with Enter, focus moves into the card and returns to the trigger on close; 25 tabs run forward without a trap; the canvas has no tabindex, role or handler; the focus ring is measured as painted. AC#3: with the preference emulated, no auto-play, manual replay still works, nothing under main has a transition or animation >=1ms. AC#4: during playback all three time states are on screen with distinct words, distinct COMPUTED border-left-style and distinct aria-hidden glyphs — read from the engine, the only place a data-state selector becomes a border. AC#5: four animationStates produce four distinct card readings in words.

WHAT REDUCED MOTION SUPPRESSES, AND WHAT IT MUST NOT. Ambient drift and environmental animation are seed-derived and suppressed; CANON-DRIVEN MOVEMENT IS NOT, deliberately — the character really did move, and hiding it would misrepresent the world. Auto-play is suppressed, the replay stays available. This is why the suite does not assert 'the canvas stops changing': an earlier version did and failed, correctly, because the fixture has one character mid-walk. A pixel comparison cannot tell ambient drift from Canon movement, so suppression is proven where it can be isolated — ambientMotion.test.ts and environmentAnimation.dom.test.tsx.

THREE THINGS THE WRITING TURNED UP. (1) The text Live View rendered NOTHING under the E2E fixture, because the fixture's live:<worldId> payload carried only the arcs the story overlay reads. The map suite could never have caught it — the map does not read characters, locations or recentEvents — and the non-map equivalent is a release gate. Fixed by completing the payload; fixtureWorld.test.ts covers it. (2) test.use({ reducedMotion: 'reduce' }) did not reach the page, and neither did a beforeEach: the whole group was asserting things about the ordinary page and passing for the wrong reason. Caught only because each test checks the emulation is real before concluding anything from it — a check that stays in for exactly that reason, and the emulation now happens inside each test immediately before the navigation it governs. (3) locator.focus() does not match :focus-visible, which is a heuristic about how focus ARRIVED; focusing directly measured 'outline: none' and would have reported a defect that does not exist. The control is now reached by Tab.

VERIFICATION. npx playwright test liveAccessibility: 30/30 across desktop and mobile. npm run check green — 150 suites, 2270 passed, 5 pre-existing skips, build succeeds. No product change was needed for any acceptance criterion: ART-118/120/121/126/131 had already built the behaviour, and what was missing was evidence that it holds in an engine. The one code change is the E2E fixture completion above.

NOT COVERED, unchanged by this task: graph and timeline surfaces (ART-94, carried forward per PRD 2.0 §13) and the human-in-the-loop checks in docs/accessibility.md §4.

See docs/accessibility.md §6.
<!-- SECTION:FINAL_SUMMARY:END -->
