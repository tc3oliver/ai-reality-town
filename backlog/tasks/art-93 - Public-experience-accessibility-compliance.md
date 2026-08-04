---
id: ART-93
title: Public experience accessibility compliance
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 16:20'
updated_date: '2026-08-04 07:47'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-41
  - ART-42
  - ART-43
  - ART-68
  - ART-69
  - ART-86
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 93000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-009 for P0 public experiences

Problem / Context
Core public-test experiences require accessibility evidence independent of optional P1 graph/timeline work.

Goal
Verify keyboard navigation, contrast, reduced motion, image alternatives, touch targets, mobile usability, and non-map Live alternatives across P0 homepage, Live, Episode, Character, and Arc experiences.

Scope
P0 public experiences only.

Out of Scope
P1 relationship graph/timeline accessibility and production deployment.

Dependencies
ART-41, ART-42, ART-43, ART-68, ART-69, ART-86

Schema Impact
No product domain schema; owns accessibility evidence and UI adjustments for P0 public views.

API Impact
Consumes public read APIs only; accessible alternatives expose no additional private data.

Security Impact
Accessible alternatives obey identical server-side field allowlists and publication rules.

Validation Commands
npm run check; run automated accessibility checks and documented keyboard/manual review.

Test Requirements
Automated and manual evidence covers all P0 public experiences and every NFR-009 requirement.

Documentation Impact
Update accessibility and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All P0 interactive public controls are keyboard reachable with visible focus.
- [ ] #2 P0 views meet contrast, reduced-motion, image-alt, mobile touch-target, and responsive requirements.
- [x] #3 Live/map content has an equivalent accessible non-map view.
- [x] #4 Evidence covers homepage, Live, Episode detail/list, Character, and Story Arc experiences.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
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
1. Test-tooling decision (architecturally significant, recorded before coding).
   Constraint: this repo's jest has NO DOM environment on purpose; every *.test.ts is pure logic and never renders a component. NFR-009 cannot be verified without real rendered markup (axe needs a DOM tree). Decision: scope jsdom in NARROWLY instead of globally. jest.config.ts becomes two projects: `unit` (unchanged preset, explicitly ignores *.a11y.test.tsx, still no DOM) and `a11y` (jsdom + jest-axe, testMatch ONLY **/*.a11y.test.tsx, its own ts-jest transform because the repo tsconfig uses jsx:preserve). New devDeps: jest-environment-jsdom, jest-axe, @types/jest-axe. No @testing-library: markup is produced with react-dom/server renderToStaticMarkup (already a dependency) and injected into jsdom, which keeps the surface minimal. Rationale + the fact that this exception is confined to a11y specs is documented in jest.config.ts and docs/accessibility.md.
2. Make the five P0 pages renderable without Convex: each page file additionally exports a pure presentational view (HomepageView, LiveViewBody, EpisodeListView, EpisodeDetailView, CharacterPageView, ArcDetailView) taking an already-composed view model; the default export keeps doing the useQuery reads and renders it. No behaviour change, matches the existing 'thin render layer over pure logic' pattern.
3. Shared landmark chrome: new src/components/public/PublicPageFrame.tsx replacing the 5 duplicated Frame helpers. Adds lang=zh-Hant on the public subtree (document is lang=en, content is Chinese -> WCAG 3.1.2), a skip-to-content link, the back link moved OUT of <main> into <nav aria-label>, and <main id=public-main>.
4. Per-page fixes: replace English aria-label on sections with aria-labelledby -> the visible Chinese h2 (name/visible-label mismatch); fix heading skips (EpisodeDetail h1->h3, EpisodeList sections with no heading); EpisodeDetail recap tabs become a labelled button group with aria-pressed and a real visible selected state (the existing `.active` class has no CSS at all, so the selection is currently invisible and unannounced); fix EpisodeDetail character/arc/home hrefs that omit worldId and therefore dead-end; LiveView 'id -> location' arrow replaced with readable text; CharacterPage repeated '本日故事 →' link gets a per-item accessible name.
5. Contrast + focus + touch targets in src/index.css: explicit .public-page link colours for light AND dark scheme (default UA #0000EE on the dark-scheme black background is ~2.2:1 = a real failure), a .public-muted token replacing opacity-60/70/80 text (opacity math is not a contrast guarantee), a visible :focus-visible ring, and .public-tap 44x44 minimum on standalone controls (inline prose links use the WCAG 2.5.8 inline exception, documented).
6. Reduced motion: audit shows the five P0 pages declare no animation/transition of their own; the only keyframes in index.css belong to the game runtime. Record that finding AND add a prefers-reduced-motion: reduce guard so the shared stylesheet stays compliant.
7. Non-map alternative (AC#3): the Live view is already the text equivalent of live world state. Add the missing Homepage -> #live/<worldId> entry point, and assert in tests that the Live view renders no canvas/img/map element while still exposing locations, character positions, scenes, events and arcs as text. Document that the Pixi map runtime keys off a different (AI Town) world identifier namespace, so a map->public deep link is not derivable client-side.
8. Automated evidence: src/components/public/publicPages.a11y.test.tsx runs axe over every P0 page (loaded, empty, and error/route-invalid states) plus explicit structural assertions: single h1, no heading-level skip, every link/button has a non-empty accessible name, no img without alt, landmarks present, no inline style animation.
9. Manual/documented evidence: docs/accessibility.md records the NFR-009 matrix per page, what automation covers, what cannot be automated (screen-reader announcement, physical touch-target measurement, real-device mobile pass) with the reviewed result, and the jsdom decision.
10. Gate: npm run check green. Honest AC/DoD, implementation notes with evidence, PRD traceability NFR-009 -> doc-1, commit, push, PR, auto-merge, task to In Review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Test-tooling decision (architecturally significant)

This repo's jest deliberately has NO DOM environment: every *.test.ts is pure logic and never renders a component (the public pages are thin render layers over pure, unit-tested *Route.ts modules). NFR-009 cannot be verified that way -- heading order, landmarks, accessible names and ARIA state are properties of rendered markup, and axe-core needs a DOM tree.

Decision: scope jsdom in narrowly rather than globally. jest.config.ts now declares two projects:
- `unit`: unchanged preset, node environment, and it explicitly lists `\.a11y\.test\.tsx$` in testPathIgnorePatterns, so a DOM-dependent spec can never leak into the pure suite. A new *.test.ts still gets no DOM.
- `a11y`: jest-environment-jsdom + jest-axe, testMatch `**/*.a11y.test.tsx` ONLY, with its own ts-jest transform because the repo tsconfig uses jsx:preserve (Vite compiles JSX at build time). The shared tsconfig is untouched.

New devDeps limited to jest-environment-jsdom, jest-axe, @types/jest-axe. No component-testing library was added: markup is produced with react-dom/server renderToStaticMarkup (already a dependency) and injected into jsdom. To make that possible each page now also exports a presentational view (HomepageView, LiveViewBody, EpisodeListView, EpisodeDetailView, CharacterPageView, ArcDetailView) taking an already-composed view model, while the default export still does the useQuery reads -- the same "thin render layer over pure logic" split, extended one step, with no mocking and no test-only branches in production code.

Recorded in jest.config.ts, docs/DEVELOPMENT.md ("Test convention") and docs/accessibility.md section 1.

## Accessibility defects found and fixed (all 6 P0 pages)

Structure: back link was the first child of <main> (navigation inside the main landmark) -> moved to <nav aria-label> outside <main> via the new shared PublicPageFrame. Public copy is Traditional Chinese but the document is <html lang="en"> -> lang="zh-Hant" on the public subtree (WCAG 3.1.2). Regions were named with an English aria-label that overrode and contradicted the visible Chinese h2 -> aria-labelledby to the visible heading. Episode detail's deep recap jumped h1 -> h3 -> added <h2>回顧</h2>. Episode list's two regions had an English aria-label and no heading at all -> visible h2 added. Loading/error states rendered no h1 -> every state now has one.

Controls/links: the recap selector expressed its selected state with className="active" -- a class NO stylesheet defines -- so the current recap depth was neither visible nor announced; it was also wrongly a <nav>. Now role="group" + aria-pressed + a real visible selected style. Live rendered "he-jun -> 磨坊" with an arrow glyph screen readers do not announce -> "he-jun 位於 磨坊". Decorative arrows removed from link text. Character page repeated an identical "本日故事 →" link per row -> per-item aria-label (WCAG 2.4.4) that still starts with the visible label (WCAG 2.5.3). Episode detail linked #character/<id> and #arc/<id> and a bare #home, but those routes require the worldId -- every one was a dead link; Live had the same defect on #arc/<arcId>. All fixed and asserted. Homepage vote region rendered an empty <p>.

Contrast: pages relied on UA defaults plus Tailwind opacity-60/70/80, and opacity is not a contrast guarantee. Replaced with explicit .public-muted and .public-page a tokens for both colour schemes. The significant failure: the UA default link colour #0000EE on the dark-scheme black background measures ~2.2:1 (AA needs 4.5:1). New values measure 6.3-12.7:1; the ratios are computed in CI, not just asserted in prose.

Focus/targets: added :focus-visible (3px currentColor outline) for public links/buttons/selects, and .public-tap 44x44 on standalone controls. Inline prose links intentionally excluded under the WCAG 2.5.8 inline exception.

## Reduced motion and image alternatives -- findings, not inventions

Reduced motion: the P0 pages declare NO animation or transition of their own. The only @keyframes in index.css is moveStripes, used by the game runtime progress bar, never rendered on a public route. Nothing on these pages needed guarding, and no motion was invented in order to guard it. A prefers-reduced-motion: reduce block was still added because the stylesheet is shared with the game runtime, and the finding itself is regression-guarded by a test asserting no public component uses a motion utility and that moveStripes remains the only keyframes.

Image alternatives: the P0 pages render no <img>, <svg>, <canvas>, CSS background image or role="img" -- they are text-only by design (FR-I002: summary/essence only). Nothing to caption; the suite enforces alt on any image introduced later.

## Non-map alternative (AC#3)

The Live view already IS the text equivalent of the animated map, so no text-mode toggle was warranted -- there is no non-text mode to toggle away from. Two real gaps were closed: the Homepage had NO link to the Live view at all (added, "開啟文字實況(不需地圖)"), and Live's arc links were dead. Asserted: Live renders no canvas/svg/img/role=img, and exposes world clock, locations, character positions, active scenes, recent events and arcs as text.

Known limitation recorded (not fixed, out of scope): the PixiJS map keys off the AI Town world id from api.world.defaultWorldStatus, a different identifier namespace from the canon worldId the public routes use, so a map -> #live/<worldId> deep link is not derivable client-side. NFR-009 asks for an equivalent accessible view, which exists and is reachable from the public Homepage.

## Verification evidence

- npx jest --selectProjects a11y -> 34 passed, 34 total. Covers all 6 P0 experiences in populated AND empty/unpublished states, Episode detail in all 3 recap depths, plus keyboard reachability, non-map equivalence, link-target resolution and stylesheet checks.
- axe rule engagement was confirmed with a throwaway negative fixture: axe reported button-name, heading-order and image-alt on deliberately broken markup, so the suite is not passing vacuously.
- npm test -> 78 suites, 943 tests passed, across both projects (the pre-existing 909 pure tests still run with no DOM).
- npm run typecheck -> clean. npm run build -> ok; verified the new tokens survive into dist (public-muted, public-tap, prefers-reduced-motion, #0842a0, #9ecbff, min-height:44px all present in the emitted CSS).
- npm run check: architecture + test:architecture + typecheck pass, test + build pass. `npm run lint` aborts in this agent worktree with "ESLint couldn't determine the plugin @typescript-eslint uniquely" because the worktree is nested inside the parent repo and eslint resolves two node_modules trees. This is environmental, not a code defect: .eslintrc.cjs is untouched by this branch and the identical run with plugin resolution pinned to the worktree passes clean -- `npx eslint --resolve-plugins-relative-to . convex/canon ... convex/operations` -> exit 0, zero findings. CI runs from the repo root and is unaffected.

## Honest AC status

AC#1, AC#3, AC#4 checked. AC#2 left UNCHECKED on purpose. Contrast, reduced motion and image-alt are fully evidenced, and the 44px target and reflow-safety are structurally asserted, but a RENDERED touch-target measurement and a real 320px/400%-zoom reflow observation were not performed -- jsdom applies no layout and no browser was available. Those two, plus a real-browser focus-visibility walkthrough and a screen-reader pass, are written up as open items in docs/accessibility.md section 4.1-4.4 rather than being claimed as done. DoD#1 is therefore also left unchecked.

PRD traceability: NFR-009 -> backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 (AI Reality Town PRD 1.0, section 14 NFR-009).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ran the NFR-009 accessibility pass over the five P0 public experiences (Homepage, Live, Episode list + detail, Character, Story Arc) and fixed what it found.

Real defects fixed, not cosmetic: the recap selector's selected state used a CSS class no stylesheet defines, so the current recap depth was neither visible nor announced; Episode detail and Live linked to #character/<id>, #arc/<id> and a bare #home while those routes require the worldId, so they were dead ends; the back link sat inside <main>; regions were named with English aria-labels that overrode the visible Chinese headings; the deep recap skipped h1 -> h3; the Chinese content was served under lang="en"; character positions were conveyed by an arrow glyph screen readers do not announce; the Character page repeated an identical link label per row; and the user-agent default link colour measured ~2.2:1 against the dark-scheme background, an outright WCAG AA contrast failure. Contrast now uses explicit measured tokens (6.3-12.7:1), with a visible :focus-visible ring and 44px targets on standalone controls.

Reduced motion and image alternatives were findings rather than work: the P0 pages declare no motion of their own (the only @keyframes belongs to the game runtime) and render no images at all. Both are documented and regression-guarded rather than invented. For AC#3 the Live view already was the text equivalent of the map, so the gap was reachability: the Homepage had no link to it, which it now has.

Test tooling: this repo deliberately runs jest with no DOM, but accessibility cannot be asserted without rendered markup. jsdom + jest-axe were scoped to a separate `a11y` jest project matching *.a11y.test.tsx only; the `unit` project explicitly ignores those files, so the project-wide "we do not render components" convention still holds everywhere else. No component-testing library was added -- react-dom/server plus jsdom. Recorded in jest.config.ts, docs/DEVELOPMENT.md and docs/accessibility.md section 1.

Verified: npx jest --selectProjects a11y -> 34/34 (all 6 pages, populated and empty states, all 3 recap depths); axe rule engagement confirmed against a deliberately broken fixture so the suite is not passing vacuously; npm test -> 78 suites / 943 tests across both projects; typecheck clean; build ok with the new tokens confirmed present in the emitted CSS. `npm run lint` aborts only in this nested agent worktree on duplicate @typescript-eslint plugin resolution -- environmental, .eslintrc.cjs untouched, and the same run pinned to the worktree passes with zero findings.

AC#1/#3/#4 checked. AC#2 left unchecked on purpose: contrast, reduced motion and image-alt are proven and the 44px targets and reflow safety are structurally asserted, but a rendered touch-target measurement and a real 320px/400%-zoom reflow check were not performed, since jsdom applies no layout and no browser was available. Those, plus a real-browser focus walkthrough and a screen-reader pass, are written up as open items in docs/accessibility.md section 4.1-4.4 rather than claimed as done.
<!-- SECTION:FINAL_SUMMARY:END -->
