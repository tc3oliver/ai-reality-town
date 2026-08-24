---
id: ART-131
title: Establish the unified public visual design system
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 15:59'
updated_date: '2026-08-24 13:52'
labels:
  - prd-2.0
  - v2-h
  - epic-p
dependencies:
  - ART-125
priority: high
type: feature
ordinal: 131000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-P003 (PRD 2.0 §12 Epic P, RISK2-006)

**Problem / Context:** Public pages currently render as plain dark documents resembling an admin console. PRD 2.0 RISK2-006 identifies this as a primary reason the product still reads as a technical demo.

**Goal:** One coherent visual language across live, homepage, Episode, character and arc surfaces.

**Scope:**
- Background, surface, border and accent colours.
- Card treatments for story arc, character, event and Episode.
- Character sprite / portrait containers.
- World day, time slot and status indicators, including Live, Paused, Delayed and Stale.
- Type hierarchy and information density.

**Out of Scope:** Responsive rules (FR-O008); accessibility compliance (NFR2-006).

**Dependencies:** FR-O007 live overlay.

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** The visual layer must not alter Canon semantics.

**Test Requirements:** Visual consistency checks across the five public surfaces; a test that status is not conveyed by colour alone.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Design system reference.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Background, surface, border and accent colours are defined and applied
- [x] #2 Story arc, character, event and Episode cards share consistent treatments
- [x] #3 World day, time slot and Live, Paused, Delayed and Stale states have defined indicators
- [x] #4 Live, homepage, Episode, character and arc surfaces share one design language
- [x] #5 Public pages no longer read as an admin console or a plain monochrome document
- [x] #6 The visual layer does not alter Canon semantics
- [x] #7 Colour is never the only way to identify a state
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
1. TOKENS. Define the palette as CSS custom properties on `.public-page` (surface, sunken, border, border-strong, text, muted, accent, accent-soft) with a `prefers-color-scheme: dark` override, replacing the two ad-hoc literals `.public-muted`/`.public-page a` currently carry. Extend the existing contrast harness in publicPages.a11y.test.tsx with a `var(--x)` resolver so every token is contrast-checked against BOTH the body background and the new card surface — a card surface is a second background the old assertions never covered.
2. TYPE. The single biggest reason these pages read as an admin console is that `.public-page` carries `font-body` = VCR OSD Mono, i.e. a terminal font (CJK falls back to a generic monospace). Public pages move to a real reading stack (system-ui + CJK families), and the pixel font is kept deliberately for numeric/status chips, where it reads as world flavour rather than as a terminal. Type scale + heading rule declared once.
3. CARDS. Style BY STRUCTURE rather than by adding a class to every element: every public page already renders `<section class='<name> mt-4' aria-labelledby>`, so `.public-page main > section` gets the card treatment and almost no TSX changes — which keeps AC#6 (no Canon semantics touched) trivially true and minimises regression surface. A `.public-card` class covers nested cards (episode rows, character rows, arc rows). The live surface's existing `.live-story-overlay`/`.live-character-card` borders are re-pointed at the same tokens so live shares one language with the rest (AC#4).
4. STATUS INDICATORS. New `PublicStatusBadge` + pure `publicStatusBadge.ts` model covering the four runtime freshness states (live/delayed/paused/stale) plus world-day and time-slot chips. Each state carries THREE non-colour signals — visible label, distinct aria-hidden glyph, distinct border-style — following the convention TimeStateBanner already established, so AC#7 holds in greyscale and with the stylesheet off.
5. APPLY. Homepage reads the already-allowlisted anonymous query `getPublicRuntimeSnapshot` so the freshness badge is genuinely rendered rather than merely defined; world-day/time-slot chips on homepage, live and episode surfaces; arc status and character alive/active rendered through the same badge.
6. TESTS. Extend publicPages.a11y.test.tsx: token contrast on both backgrounds in both schemes, the five surfaces all carry the card treatment, the badge's three-signal property proven by stripping class and data attributes and checking the states are still distinguishable by text alone, and a non-monochrome assertion (accent saturation) for AC#5. New unit tests for the badge model.
7. DOCS. docs/public-design-system.md as the design reference; update docs/accessibility.md's colour table; mark FR-P003 in docs/prd-2.0-requirement-matrix.md.
8. npm run check, then finalize.

SCOPE NOTE: AC#5 ('no longer reads as an admin console') is ultimately a human judgement. What is asserted mechanically is that a design system is defined and applied on all five surfaces and that the palette is not monochrome; the subjective half is recorded as a manual check rather than claimed as machine-verified.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#5 is checked on the mechanical half only, and that is stated rather than glossed: the tests establish that a design system exists, is applied on all six surfaces, and is not monochrome (the accent's channel spread must exceed 48; a grey is 0). 'No longer reads as an admin console' is an aesthetic judgement and is recorded as a manual check alongside docs/accessibility.md §4, to be signed off at the ART-138 release gate.

Validation: npm run check green — 146 suites, 2228 passed, 5 pre-existing skips, build succeeds. Built CSS read directly to confirm both the light and dark token blocks, the card rule and the chip rule survive Tailwind JIT and minification. Five fault injections proved the assertions non-vacuous: grey accent -> 2 failures; a muted ink that still passes on the body background but fails on the card surface -> 1 (this is the case the pre-ART-131 harness structurally could not see, and the whole reason it was extended); two chip states sharing a border-style -> 1; font-body restored to the page frame -> 1; role=status moved back onto the <ul> -> 3.

One self-inflicted defect caught by this suite while writing it: role='status' was initially placed on the <ul> itself. An ARIA role replaces the element's implicit one, so that stripped the list role and left every <li> without a valid parent (axe aria-required-parent) — a screen reader would have stopped announcing 'list, 4 items'. The live region is now a wrapper.

publicReadOnlyGuarantee.test.ts went red on the new getPublicRuntimeSnapshot reference, which is that suite working as designed: the client-reachable Convex surface is enumerated exhaustively so a new reference has to be added deliberately. It is an anonymous query already on the publicFunctionSurface allowlist, and the suite's own assertion then forces it to be a read.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Diagnosed before colouring. RISK2-006 says the public pages read as an admin console; the three actual causes, in order of how much they mattered, were: (1) the pages were set in a TERMINAL FONT — PublicPageFrame carried `font-body`, i.e. VCR OSD Mono, a monospace pixel face with no CJK coverage, so every Chinese glyph fell back to a generic monospace, and monospace is the visual signature of a console; (2) Tailwind preflight had stripped every control's appearance, so every button on every page rendered as bare text; (3) there was no surface at all — content sat directly on the body gradient with no card, border or elevation. Colour was the LEAST of it: a palette applied to those three problems would still have looked like an admin console, in colour.

TOKENS. The palette is CSS custom properties on `.public-page` with a full dark-scheme override, and no colour literal exists outside that block — which is what lets the contrast harness resolve every token and compute the ratio in CI instead of trusting a one-off measurement. Two border tokens, deliberately: the hairline measures under 2:1 and that is correct, because WCAG 1.4.11's 3:1 applies to boundaries REQUIRED to identify a component and nothing is identified by a card's hairline; anything whose border IS a signal (the status chip's border-style) uses `--public-border-strong` at 5.5:1 / 6.1:1.

THREE BACKGROUNDS, NOT ONE. Before this task there was one background — the body gradient — and every contrast assertion measured against it. Cards introduced a second and nested cards a third, so a token could have cleared AA on the page and failed on a card with nothing noticing. All ink tokens are now checked against all three in both schemes: 24 ratios, worst case 6.1:1 light / 9.3:1 dark. The harness also had to learn to resolve `var(--token)` first — without that it would have been measuring the luminance of the string "var(--public-muted)", which parses to NaN, and every assertion would have passed forever.

CARDS BY STRUCTURE. Every page already renders `<section class='… mt-4' aria-labelledby>` inside one `<main>` (the shape ART-93 established for accessibility), so the card treatment attaches to that shape rather than to a class added to every element. Consequence worth stating: almost no page markup changed, so this task structurally cannot have altered what any page SAYS (AC#6), and a section added later gets the treatment without anyone remembering. Both halves are asserted — all six surfaces really do render `main > section`, AND the rule that styles it exists. `.public-rows` is opt-in because a blanket `li + li { border-top }` would have drawn a line above every button in the live map's wrapped `<ul class='flex flex-wrap'>` of focus targets, and a structural selector cannot tell those two kinds of list apart.

STATUS VOCABULARY (AC#3/#7). One pure model + one render layer, so five surfaces cannot say the same state four ways. Each of live/delayed/paused/stale carries three non-colour signals — label, distinct aria-hidden glyph, distinct border-style keyed off `data-state` — following ART-121's TimeStateBanner convention. The test strips the class AND the data attribute AND the glyph's aria-hidden and requires the four to stay distinguishable by text alone, so the claim survives greyscale and the stylesheet being off entirely. `stale` is kept separate from `paused` on an honest distinction: a stale snapshot means the capture path has confirmed nothing for hours, so its claimed state is a claim nobody has checked; reporting it as paused would assert something about the world that nothing knows. Unknown, absent and in-flight all render NO badge, so a future server state degrades to silence rather than to a wrong claim. The value comes from `getPublicRuntimeSnapshot`, on the homepage rather than only the map because 'is this thing actually running' is a question a visitor has BEFORE they open the map.

VERIFICATION. npm run check green — 146 suites, 2228 passed, 5 pre-existing skips, build succeeds. Built CSS read directly to confirm both token blocks and the card/chip rules survive Tailwind JIT and minification. Five fault injections proved the assertions non-vacuous, one of which is the entire reason the harness was extended: a muted ink that STILL PASSES on the body background and fails on the card surface — invisible to the pre-ART-131 assertions.

TWO THINGS CAUGHT, BOTH BY EXISTING GUARDS. Writing this I first put `role='status'` on the `<ul>` itself; an ARIA role replaces the element's implicit one, so that stripped the list role and left every `<li>` without a valid parent (axe aria-required-parent) — a screen reader would have stopped announcing 'list, 4 items'. And publicReadOnlyGuarantee.test.ts went red on the new query reference, which is that suite working exactly as designed: the client-reachable Convex surface is enumerated exhaustively, so the addition had to be deliberate and the suite's own assertion then forced it to be a read.

WHAT IS NOT MACHINE-VERIFIED. AC#5's 'no longer reads as an admin console' is an aesthetic judgement and is recorded as one. What the tests establish is the mechanical half — the three named causes are each objectively removed and asserted, the system is applied on every surface, and the palette is not monochrome (the accent's channel spread must exceed 48; a grey is 0). The aesthetic sign-off sits with the manual review record in docs/accessibility.md §4 and the ART-138 release gate. Out of scope by the task's own terms: responsive rules (ART-126, already delivered) and the accessibility programme (ART-135). Nothing regresses the ART-93 floor — the whole a11y suite passes, axe included, on every surface.

See docs/public-design-system.md.
<!-- SECTION:FINAL_SUMMARY:END -->
