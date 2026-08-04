# Public Experience Accessibility (NFR-009)

Owner task: **ART-93**. Requirement: **PRD 1.0 §14 NFR-009** (`backlog/docs/prd/ai-reality-town-prd-1.0/doc-1`).

Scope: the **P0 public experiences** only — Homepage (`#home/<worldId>`), Live
(`#live/<worldId>`), Episode list (`#episodes/<worldId>`), Episode detail
(`#episode/<worldId>/<worldDay>`), Character (`#character/<worldId>/<characterId>`)
and Story Arc (`#arc/<worldId>/<arcId>`).

Out of scope: the P1 relationship graph and timeline (ART-94), the PixiJS game
runtime, and production deployment.

NFR-009 requires the public interface to support, at minimum: keyboard
navigation, reasonable contrast, reduced motion, a non-map alternative view,
image alternative text, and mobile touch target sizes.

---

## 1. Test tooling decision: jsdom, scoped to accessibility specs only

This repository deliberately runs Jest **without a DOM environment**. Every
existing `*.test.ts` — including the six `*Route.test.ts` files that back these
very pages — tests pure functions and never renders a component. That is a
project convention, not an accident: the pages are thin render layers over pure,
unit-tested route/view-model modules.

Accessibility cannot be verified that way. Heading order, landmark structure,
accessible names and ARIA state are properties of *rendered markup*; `axe-core`
requires a DOM tree to walk. So the convention had to be relaxed — narrowly.

**Decision.** `jest.config.ts` now declares two projects:

| Project | Environment | Matches | Purpose |
| --- | --- | --- | --- |
| `unit` | node (default, **no DOM**) | everything except `*.a11y.test.tsx` | unchanged; the project-wide convention still holds |
| `a11y` | `jest-environment-jsdom` | `**/*.a11y.test.tsx` **only** | NFR-009 evidence |

Consequences and the reasoning behind them:

- The `unit` project explicitly lists `\.a11y\.test\.tsx$` in
  `testPathIgnorePatterns`, so a DOM-dependent spec can never silently leak into
  the pure suite. A new `*.test.ts` still gets no DOM and still cannot render a
  component.
- New dev dependencies are limited to `jest-environment-jsdom`, `jest-axe` and
  `@types/jest-axe`. **No component-testing library was added**: markup is
  produced with `react-dom/server`'s `renderToStaticMarkup` (already a
  dependency via `react-dom`) and injected into jsdom. That keeps the new
  surface as small as possible while still exercising the real components.
- The `a11y` project carries its own `ts-jest` transform because the repo
  `tsconfig.json` uses `jsx: "preserve"` (Vite compiles JSX at build time);
  `ts-jest` has to emit real JavaScript, so JSX is compiled for that project
  only. The shared tsconfig is untouched.
- Each P0 page now additionally exports a **presentational view** component
  (`HomepageView`, `LiveViewBody`, `EpisodeListView`, `EpisodeDetailView`,
  `CharacterPageView`, `ArcDetailView`) that takes an already-composed view
  model. The default export still performs the `useQuery` reads and renders it.
  This is the same "thin render layer over pure logic" split the pages already
  used, extended one step so the markup can be rendered without a Convex client
  — no mocking, no test-only branches in production code.

Reviewers extending this: put accessibility specs in `*.a11y.test.tsx`. Do not
widen the `a11y` project's `testMatch`, and do not move `testEnvironment` to the
top level.

---

## 2. NFR-009 coverage matrix

`✅ auto` = asserted by `src/components/public/publicPages.a11y.test.tsx` (axe
rules, rendered-markup assertions, or computation over the real stylesheet).
`📋 review` = code/stylesheet review recorded in §3.
`👤 human` = **outstanding**; needs a person on real hardware, see §4.

The suite covers all six P0 experiences, each in both a populated and an
empty/unpublished state, and Episode detail in all three recap depths.

| NFR-009 requirement | Automated | Outstanding |
| --- | --- | --- |
| Keyboard navigation (reachability, tab order, no traps) | ✅ all 6 pages | 👤 real-browser walkthrough (§4.1) |
| Visible focus | ✅ indicator is declared for every public control | 👤 visual confirmation (§4.1) |
| Reasonable contrast | ✅ ratios computed from the tokens, light + dark scheme | — |
| Reduced motion | ✅ guard present; no page-level motion (§3.3) | — |
| Non-map alternative | ✅ Live renders no map surface and carries the equivalent text | — |
| Image alternative text | ✅ no images today; `alt` enforced if one appears (§3.4) | — |
| Mobile touch targets | ✅ 44px declared and applied to standalone controls | 👤 rendered measurement (§4.2) |
| Responsive / mobile usability | — | 👤 320px + 400% zoom reflow (§4.3) |
| Landmarks, `lang`, heading order | ✅ all 6 pages | — |
| Link/button text out of context | ✅ all 6 pages | — |
| Screen-reader announcement | — | 👤 VoiceOver/NVDA pass (§4.4) |

Run the automated evidence:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --selectProjects a11y
```

It is also part of `npm test`, and therefore of `npm run check`.

---

## 3. Findings and fixes

### 3.1 Structure, landmarks and naming

| # | Finding | Pages | Fix |
| --- | --- | --- | --- |
| 1 | Each page duplicated its own `Frame`; the back link was the **first child of `<main>`**, putting navigation inside the main landmark. | all 6 | Shared `PublicPageFrame` moves the back link into `<nav aria-label="頁面導覽">` outside `<main>`. |
| 2 | All public copy is Traditional Chinese but `index.html` declares `<html lang="en">` for the English game runtime, so assistive tech picked the wrong voice/dictionary (WCAG 3.1.2). | all 6 | `lang="zh-Hant"` on the public subtree in `PublicPageFrame`. `index.html` is unchanged, so the English game UI keeps its own language. |
| 3 | Regions were named with an **English `aria-label`** (`aria-label="Latest major event"`) that overrode and contradicted the visible Chinese `<h2>`. | Homepage, Live, Episode list, Episode detail, Character, Arc | Replaced with `aria-labelledby` pointing at the visible heading, so the announced name is the visible name. |
| 4 | Episode detail's deep recap jumped **h1 → h3** (the recap block had no `<h2>`). | Episode detail | Added an `<h2>回顧</h2>` region heading; scene titles stay `<h3>`. |
| 5 | Episode list's filter and list regions had an English `aria-label` and **no heading at all**. | Episode list | Added visible `<h2>篩選</h2>` / `<h2>故事列表</h2>` and `aria-labelledby`. |
| 6 | Error and loading states rendered a page with **no `<h1>`** at all. | all 6 | Every state now renders the page `<h1>`. |

### 3.2 Controls, links and keyboard

| # | Finding | Pages | Fix |
| --- | --- | --- | --- |
| 7 | The recap selector was a `<nav>` of buttons whose selected state was expressed with `className="active"` — **a class no stylesheet defines**. The current recap depth was therefore neither visible nor announced. | Episode detail | Now a `role="group"` with `aria-label="回顧深度"`, `aria-pressed` on each button, and a real visible selected style. `<nav>` was also wrong: these controls change depth in place, they do not navigate. |
| 8 | Character positions rendered as `he-jun → 磨坊`. The arrow is not announced by screen readers, so the relationship was lost. | Live | Now `he-jun 位於 磨坊`. |
| 9 | `從第 3 集開始 →` and `← 返回首頁` carried a decorative arrow inside the accessible name. | Homepage, all frames | Arrows removed from link text; the destination is stated in words. |
| 10 | Every "近期大事" row rendered the same `本日故事 →` link text, so a screen reader's link list showed N identical entries (WCAG 2.4.4). | Character | Per-item `aria-label` (`本日故事:<event>`), which still starts with the visible label (WCAG 2.5.3). |
| 11 | Episode detail linked to `#character/<id>` and `#arc/<id>`, but those routes require `#character/<worldId>/<id>` and `#arc/<worldId>/<id>`; the back link went to a bare `#home`. Every one of these was a **dead end for keyboard and pointer users alike**. | Episode detail | Links now carry the worldId. Asserted by test. |
| 12 | Live linked arcs as `#arc/<arcId>` — same dead-end defect. | Live | Fixed and asserted. |
| 13 | Prev/next buttons read only `← 上一集` / `下一集 →`. | Episode detail | Now name their destination day. |
| 14 | The vote region rendered an **empty `<p>`** when voting was available. | Homepage | Renders `投票已開放。`. |

No `tabindex` greater than zero, `aria-hidden` wrapper or `inert` attribute
exists on any P0 page, so **focus order equals DOM order equals reading order**.
That is asserted for all six pages rather than assumed.

### 3.3 Reduced motion — finding and guard

**Finding: the P0 public pages declare no animation or transition of their own.**
The only `@keyframes` in `src/index.css` is `moveStripes`, used by
`.game-progress-bar-progress`, which belongs to the PixiJS game runtime and is
never rendered on a public route. No public page sets an inline
`style="animation:…"` or `transition:…`, and none uses a Tailwind
`animate-*`/`transition-*` utility. There was therefore nothing on these pages to
guard, and no motion was invented in order to have something to guard.

Because the stylesheet is shared with the game runtime, a
`@media (prefers-reduced-motion: reduce)` block was still added to
`src/index.css`. It neutralises animation, transition and smooth scrolling
globally, so the requirement holds for every surface and stays true if a public
page later adopts motion. The "no inline motion" property is regression-guarded
by the automated suite.

### 3.4 Image alternatives — finding

**Finding: the P0 public pages render no images.** There is no `<img>`,
`<svg>`, `<canvas>`, CSS background image or `role="img"` on any of the six
pages — they are text-only by design (FR-I002 explicitly calls for
"summary/essence only, no game-quality animation"). There was consequently
nothing to caption. The automated suite asserts that any `<img>` introduced
later must carry an `alt` attribute, and separately that the Live view renders
no image or canvas surface at all.

### 3.5 Contrast, focus ring and touch targets

Previously the public pages relied on user-agent defaults and Tailwind
`opacity-60/70/80` utilities. Opacity is not a contrast guarantee, and the
default link colour was an outright failure in the dark colour scheme. The
`src/index.css` block added by this task replaces both with explicit tokens.

Measured against the worst-case body background of each colour scheme
(light `#d6dbdc`, dark `#000000`), using the WCAG 2.1 relative-luminance
formula:

| Token | Light | Dark | Threshold |
| --- | ---: | ---: | ---: |
| Body text (`#000` / `#fff`) | 15.0:1 | 21.0:1 | 4.5:1 |
| `.public-muted` (`#4a4a4a` / `#c9c9c9`) | 6.3:1 | 12.7:1 | 4.5:1 |
| `.public-page a` (`#0842a0` / `#9ecbff`) | 6.5:1 | 12.4:1 | 4.5:1 |

The dark-scheme link colour is the important one: the user-agent default
`#0000EE` on the dark-scheme black background measures **≈2.2:1**, a clear
WCAG AA failure that the pages shipped with.

Other additions:

- `:focus-visible` draws a 3px `currentColor` outline with a 2px offset on every
  link, button and select inside `.public-page`. It inherits the text colour, so
  it remains visible in both colour schemes.
- `.public-tap` gives standalone controls (back link, recap tabs, episode
  paging) a 44×44 CSS-pixel minimum; the filter selects use `min-h-[44px]`.
  Links inside a sentence intentionally do **not** get it: WCAG 2.5.8 exempts
  inline links, which are sized by their line box, and forcing 44px on them
  would break the prose.

---

## 4. Review record and outstanding manual checks

Two different things are recorded here, and they are kept strictly apart.

**Reviewed and closed in this task.** These were verified by reading the
rendered markup and the stylesheet, and — crucially — each one is now pinned by
an assertion in `publicPages.a11y.test.tsx`, so it is reproducible in CI rather
than being a one-off observation:

- Landmark structure, `lang="zh-Hant"` subtree, single `h1` and heading order,
  on all six pages in both populated and empty states.
- Accessible names for every link and button, including the "reads sensibly out
  of context" property and the WCAG 2.5.3 label-in-name property.
- Tab-order integrity: no positive `tabindex`, no `aria-hidden` ancestor and no
  `inert` attribute on any control, on any page. Focus order therefore equals
  DOM order equals reading order.
- Contrast ratios for body text, `.public-muted` and links, computed from the
  declared tokens against the worst-case background of **both** colour schemes.
- Presence of the focus indicator, the 44px target declaration, and the
  reduced-motion guard; plus the finding that no P0 page declares motion.
- The Live view's non-map equivalence (§4.4).

**Outstanding — requires a human on real hardware.** These could not be
performed in this task and are **not** claimed as done. They need a browser,
assistive technology and/or a physical device, none of which are available to
the automated pipeline. jsdom applies no layout and no CSS, so nothing below can
be inferred from the suite above.

### 4.1 Real-browser keyboard walkthrough and visible focus

Not yet performed. What to do: run `npm run dev` and tab through all six routes
in Chrome and Firefox, in both `prefers-color-scheme` settings.

Confirm: the focus ring is genuinely perceivable on the back link, recap
buttons, episode paging buttons, filter selects and in-content links; `Enter`
activates links and `Enter`/`Space` activate buttons; changing the recap depth
does not throw focus away from the pressed button; no focus trap occurs; and the
`disabled` "上一集" control on world day 1 is skipped without stranding the user.

Why it matters despite the automation: the suite proves nothing is *removed*
from the tab order and that an outline is *declared*, but it cannot prove the
outline is actually rendered and perceivable against real painted pixels.

### 4.2 Rendered touch-target measurement

Not yet performed. What to do: in device emulation (for example iPhone SE
375×667 and Pixel 7 412×915) inspect the rendered box of the back link, the
three recap buttons, both paging buttons and both filter selects, and confirm
each is ≥44 CSS px in its smaller dimension with adequate spacing between
adjacent targets.

Why it matters: `min-height`/`min-width` can be defeated by a flex or grid
parent, and only layout can show that. The suite proves the declaration exists
and is applied to the right elements, not the final geometry.

Note on the deliberate exception: links inside a sentence (for example the
recommended entry point on the Arc page) are **not** given a 44px box. WCAG 2.5.8
exempts inline links, which are sized by their line box, and forcing 44px would
break the prose. They are not adjacent to other targets.

### 4.3 Responsive reflow

Not yet performed. What to do: check each route at a 320px viewport and at 400%
browser zoom on a 1280px viewport, confirming no horizontal scrolling, no
clipped or overlapped content, and that the filter row wraps rather than
overflowing (WCAG 1.4.10). The layout is a single `max-w-2xl` column with no
fixed or sticky elements, so this is expected to pass, but it has not been
observed.

### 4.4 Screen-reader announcement

Not yet performed. What to do: a VoiceOver (Safari) and/or NVDA (Firefox) pass
over all six routes, using the rotor/element list to confirm:

- one `main` landmark plus the labelled `頁面導覽` navigation per page, and the
  labelled `集數導覽` on Episode detail;
- a single `h1` and a correctly nested outline, with regions announcing their
  visible Chinese headings rather than the English strings removed by this task;
- no repeated identical `本日故事` entries in the Character page's link list;
- the recap buttons announcing their pressed/unpressed state on toggle;
- content read with Chinese pronunciation, confirming the `lang="zh-Hant"`
  subtree overrides the document's `lang="en"`.

Why it matters: axe checks the accessibility tree's *shape*; only a real screen
reader shows what is actually spoken.

### 4.5 Non-map alternative (AC#3) — reviewed and closed

The Live view **is** the accessible non-map equivalent, and this one is fully
evidenced by automation. It exposes the same live world state the animated map
conveys visually — world clock, locations, character positions, active scenes,
recent events and running arcs — as plain readable text, and renders no canvas,
SVG, image or `role="img"` element. Both halves of that claim are asserted. The
Homepage now links to it explicitly (`開啟文字實況(不需地圖)`); before this task
the text Live view had no entry point from the Homepage at all.

This matches the PRD's own P0 stance for FR-I002 — summary/essence only, no
game-quality animation — so no separate "text mode" toggle is warranted: there
is no non-text mode of the Live experience to toggle away from.

**Known limitation (recorded, not fixed here):** the PixiJS map runtime keys off
the AI Town world identifier from `api.world.defaultWorldStatus`, which is a
different identifier namespace from the canon `worldId` the public routes use. A
deep link from the map to `#live/<worldId>` is therefore not derivable on the
client today. Bridging the two namespaces is a separate change and is not
required by NFR-009, which asks for an equivalent accessible view — which
exists, and is reachable from the public Homepage.

---

## 5. Not covered here

- P1 relationship graph and timeline accessibility — **ART-94**.
- The PixiJS game runtime itself, which is the visual runtime (ADR-0001) and not
  a P0 public experience.
- Production deployment.
- The four human-in-the-loop checks in §4.1–§4.4, which remain open.
