---
id: ART-126
title: Deliver the responsive live viewing experience
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 15:59'
updated_date: '2026-08-24 13:31'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-125
  - ART-124
priority: high
type: feature
ordinal: 126000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O008 (PRD 2.0 §12 Epic O)

**Problem / Context:** The live surface combines a canvas map with overlay cards, which is the layout most likely to break on small screens. PRD 2.0 §22 makes mobile E2E a release gate.

**Goal:** A usable live experience on both desktop and mobile, in both orientations.

**Scope:**
- Desktop: map and story overlay visible together.
- Mobile: map-first with bottom-sheet or equivalent cards.
- Adequate touch target sizes for primary controls.
- No blocking overflow in portrait or landscape.
- Character and scene cards remain openable on small screens.

**Out of Scope:** Accessibility compliance (NFR2-006); visual design system (FR-P003).

**Dependencies:** FR-O007 story overlay; FR-O006 character card.

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** None.

**Test Requirements:** Responsive E2E across desktop and mobile viewports in both orientations, including opening character and scene cards on small screens.

**Validation Commands:**
- `npm run check`
- Browser E2E at mobile and desktop viewports.

**Documentation Impact:** Responsive layout notes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Desktop displays the map and story overlay simultaneously
- [x] #2 Mobile is map-first with bottom-sheet or equivalent card presentation
- [x] #3 Primary controls have adequate touch target sizes
- [x] #4 Neither portrait nor landscape produces blocking overflow
- [x] #5 Character and scene cards can still be opened on small screens
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
1. Widen the live page only: PublicPageFrame gains an optional `width` prop ('default' | 'wide'); every existing caller keeps max-w-2xl, LiveMapPage/LiveMapView asks for 'wide' (max-w-5xl). Without this AC#1 is unreachable — a 672px column cannot hold map and overlay side by side.
2. Introduce a `.live-stage` wrapper in LiveMapView holding exactly two children: the canvas container and the story overlay, IN THAT DOM ORDER. Single column by default (mobile: map first, AC#2); two columns at >=64rem (desktop: map and overlay simultaneously, AC#1). DOM order equals visual order at every width, so no CSS reordering and no focus/visual-order mismatch. This flips the overlay from before the canvas to after it — ART-125 AC#5 asked only that the overlay not obscure the map, which is unchanged and still asserted; the 'overlay first' ordering was an ART-125 design choice that FR-O008 AC#2 (map-first on mobile) now supersedes.
3. Responsive canvas sizing in index.css: replace the fixed `min(70vh, 640px)` + `min-height: 280px` (which exceeds a landscape phone's whole viewport) with `clamp(200px, 60vh, 640px)` plus a `dvh` override, and a short-landscape rule that shrinks it further. AC#4.
4. Blocking-overflow guard: `overflow-wrap: anywhere` on `.public-page`, so the raw ids the live surface prints (arcIds, participant ids, event ids joined with 、) can never force horizontal overflow. AC#4.
5. Touch targets (AC#3): give `public-tap` to the four standalone live links that still relied on the WCAG 2.5.8 inline exception — the text-live link, the character card's Episode and full-page links, and the overlay's recommended-entry link.
6. Small-screen disclosure: a `useCompactViewport` hook (matchMedia, mirroring useReducedMotion, defaulting to non-compact where matchMedia is absent) drives StoryOverlay's default open state, so mobile is not required to show everything at once (FR-O007) while desktop keeps UX2-004's permanently-available context.
7. Tests: update storyOverlayLayout.dom.test.tsx for the new order and assert stage siblinghood; add liveResponsiveLayout.dom.test.tsx asserting every rendered live control carries public-tap, the stage holds exactly the canvas and the overlay, the character card opens and is reachable from a narrow mount (AC#5), and the stylesheet's responsive rules exist and contain no viewport-exceeding fixed size (AC#4).
8. Docs: docs/live-responsive-layout.md recording the layout contract and why an in-flow card stack is the chosen 'bottom-sheet equivalent'; mark FR-O008 in docs/prd-2.0-requirement-matrix.md.
9. npm run check, then finalize.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: npm run check green — architecture + asset-license gates, typecheck, lint, 145 suites / 2204 passed / 5 pre-existing skips, vite build succeeds. Built CSS inspected directly (dist/assets/index-*.css) to confirm every new rule survives Tailwind JIT and minification: max-w-5xl{max-width:64rem}, .live-stage{display:grid;grid-template-columns:minmax(0,1fr);…}, @media (min-width:64rem){.live-stage{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}}, both clamp heights INCLUDING the dvh duplicate (the minifier keeps it, so the progressive-enhancement fallback works as intended), the short-landscape rule, and overflow-wrap:anywhere. Four fault injections proved the new assertions are non-vacuous: restoring min-height:280px -> 1 failure; removing one public-tap -> 6; moving the overlay back before the canvas -> 9; forcing the overlay always-open -> 11.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Made the live surface usable from a phone in landscape to a desktop monitor, by introducing one grid container rather than a set of breakpoint overrides.

WHAT CHANGED. LiveMapView now renders a single `.live-stage` holding exactly two block siblings — the canvas and the story overlay, in that DOM order. Below 64rem the stage is one column, so the map leads and the overlay is the card beneath it (AC#2); at or above 64rem it is two columns (minmax(0,3fr) minmax(0,2fr)), so both are on screen at once (AC#1). PublicPageFrame gained an opt-in `width` prop: every existing page keeps the max-w-2xl prose measure and only the live map asks for `wide` (max-w-5xl), because AC#1 is simply unreachable inside a 672px column.

THE DESIGN DECISION WORTH RECORDING. The obvious way to get 'overlay above the map on desktop, map above on mobile' is a CSS `order` flip. It was rejected: reordering visually while leaving the DOM alone desynchronises reading order from focus order (WCAG 1.3.2 / 2.4.3), so a sighted keyboard user tabs to a control that is not where their eye is. Changing the COLUMN COUNT instead keeps visual order equal to DOM order at every width. That is why the canvas was moved ahead of the overlay in the markup rather than left in ART-125's position and overridden in CSS — and the test now asserts no `order` or `*-reverse` declaration exists on any of the three selectors, so the rejected approach cannot creep back.

This does change ART-125's ordering choice (overlay first, so 'why does this matter' was answerable before the map). FR-O008 AC#2 asks for the opposite on small screens and supersedes it. What ART-125 AC#5 actually required — collapsible, and never obscuring the map — is untouched, and storyOverlayLayout.dom.test.tsx still proves it on the mounted tree, now additionally asserting the stage holds exactly those two children so nothing can be slipped between them.

AC#2's 'Bottom Sheet or equivalent' resolves to an in-flow card stack under the map, not a fixed sheet: a sheet covers the character the card is about (the same reasoning that made the card a block rather than a modal in ART-124, and the same guarantee FR-O007 AC#5 asks of the panel beside it), a correct sheet is a dialogue needing focus trapping that this codebase has no primitive for, and the problem a sheet solves is already solved by ART-124's focus-on-mount. The overlay's <details> additionally starts collapsed below the breakpoint — FR-O007 states outright that mobile need not show everything at once, and under the map an expanded panel pushes the replay chrome, scene panel and camera chrome a screenful down. That decision comes from useCompactViewport(), whose COMPACT_VIEWPORT_MAX_REM is the same number as the CSS media query and is asserted equal to it, so the disclosure and the layout cannot disagree about what 'compact' means.

AC#3: every button and link on the surface now carries .public-tap; four standalone links had been relying on the WCAG 2.5.8 INLINE exception, which does not apply to them.

AC#4 had three independent causes, each closed: unbreakable generated identifiers setting min-content width (overflow-wrap:anywhere on .public-page — `anywhere`, not `break-word`, because only `anywhere` also shrinks intrinsic min-content width); grid tracks whose automatic minimum is `auto` (minmax(0,…) on both); and — the real defect — `.live-map-canvas`'s `min-height: 280px`, which BEAT its own min(70vh,640px) cap and so was what actually applied, leaving nothing but map and header on a ~360px-tall landscape phone. Replaced with clamp(200px,60vh,640px) plus a dvh repeat and a short-landscape rule down to clamp(140px,55vh,320px).

VERIFICATION. npm run check green: 145 suites, 2204 passed, 5 pre-existing skips, build succeeds. New liveResponsiveLayout.dom.test.tsx splits every criterion into the half a DOM can settle (what exists, what contains what, order, classes, what a real press does at a compact viewport) and the half only the stylesheet can (@media rules, track definitions, clamp bounds) and asserts both — jsdom applies no CSS, so neither half alone would mean anything. The built CSS was read directly to confirm every rule survives Tailwind JIT and minification, including the dvh duplicate. Four fault injections proved the assertions are non-vacuous (restoring min-height:280px -> 1 failure; removing one public-tap -> 6; overlay back before the canvas -> 9; overlay forced always-open -> 11).

NOT COVERED, AND DELIBERATELY SO. Real layout in a real engine at a real viewport. No headless browser runs in this repo; that is ART-137 (FR-O008's desktop/mobile E2E in both orientations), and the browser evidence is collected at the ART-138 release gate. This suite is the structural floor under that, not a substitute for it — the task's own 'Browser E2E' validation command is therefore recorded as ART-137's, not claimed here. One deliberate cross-page effect to note: overflow-wrap:anywhere is on .public-page, so it applies to every public page, not just live; it only engages where text would otherwise overflow, and all public-page a11y suites pass unchanged.

See docs/live-responsive-layout.md.
<!-- SECTION:FINAL_SUMMARY:END -->
