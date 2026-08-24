# Responsive live viewing layout

**Requirement:** FR-O008 (PRD 2.0 §12 Epic O) · **Task:** ART-126

The live map is the one public surface that is not a column of prose: a canvas, a story panel,
a character card, a scene list and the camera chrome, on everything from a phone held sideways to
a desktop monitor. This is the record of how that is arranged and, more usefully, of which
arrangements were rejected and why.

## The stage

`LiveMapView` renders one wrapper, `.live-stage`, holding exactly two children:

```
.live-stage
├── .live-map-canvas      ← first in the DOM
└── .live-story-overlay
```

`.live-stage` is a CSS grid. Below `64rem` it has one column, so the two stack and **the map
leads** (AC#2). At or above `64rem` it has two — `minmax(0, 3fr) minmax(0, 2fr)` — so **the map
and the overlay are on screen together** (AC#1).

Everything else on the page (replay chrome, character card, scene panel, camera chrome) stays a
full-width block below the stage at every width.

### Why the column count changes, and not the order

The obvious way to get "overlay above the map on desktop, map above the overlay on mobile" is a
flex or grid `order` that flips them per breakpoint. It is rejected here. Reordering visually
while leaving the DOM alone leaves the reading order disagreeing with the focus order, which is a
WCAG 1.3.2 / 2.4.3 failure — a sighted keyboard user tabs to a control that is not where their
eye is. Changing the number of columns instead keeps **visual order equal to DOM order at every
width**, so there is nothing to desynchronise.

That is why ART-126 moved the canvas ahead of the overlay in the markup rather than leaving
ART-125's order in place and overriding it in CSS. `liveResponsiveLayout.dom.test.tsx` asserts no
`order` or `*-reverse` declaration exists on any of the three selectors, so the rejected approach
cannot creep back in later.

### What this changed about ART-125

ART-125 rendered the story overlay **before** the canvas, on the reasoning that "why does this
matter" should be answerable before a viewer looks at the map. FR-O008 AC#2 asks for the opposite
on small screens and supersedes it. What ART-125 AC#5 actually required — that the overlay is
collapsible and **never obscures the map** — is untouched: the two are still block siblings in
normal flow, neither contains the other, and `storyOverlayLayout.dom.test.tsx` still proves it on
the mounted tree.

## The page width

`PublicPageFrame` gained an opt-in `width` prop. Every existing page keeps `max-w-2xl`, which is
the comfortable measure for a line of Traditional Chinese prose. The live map — and only the live
map — asks for `wide` (`max-w-5xl`), because AC#1 is simply unreachable inside a 672px column: a
map and a panel side by side do not fit in it.

This is opt-in per page rather than a global widening so no episode, character or arc page
silently loses its measure.

## "Bottom sheet **or equivalent**"

AC#2 offers a choice. The equivalent chosen is an **in-flow card stack beneath the map**, not a
fixed-position sheet. Three reasons:

1. A sheet pinned to the bottom of the viewport covers the map — and the character card is *about*
   a character the viewer is looking at on that map, so covering it hides the answer. This is the
   same reasoning that made the card a block rather than a modal in ART-124, and the same
   guarantee FR-O007 AC#5 asks for from the panel beside it.
2. A correct sheet is a dialogue: it needs focus trapping, an escape key, and inert background
   content. There is no dialogue primitive in this codebase, and a half-built one is worse for a
   keyboard user than no sheet at all.
3. The card already solves the problem a sheet solves — "the thing I just opened is off screen" —
   by taking focus on mount (ART-124), which scrolls it into view. Pressing 角色卡 near the bottom
   of a long stacked page lands the viewer in the card either way.

## Small-screen disclosure

The story overlay's `<details>` starts **expanded on desktop and collapsed below the breakpoint**.
FR-O007 states outright that a mobile viewer is not required to be shown everything at once, and
below the breakpoint the overlay sits *under* the map — expanded, it pushes the replay chrome, the
scene panel and the camera chrome a screenful further down for someone who came to watch the map.
Above the breakpoint the overlay has its own column, costs the map no space, and PRD 2.0 UX2-004's
permanently-available context applies.

The decision comes from `useCompactViewport()`, a `matchMedia` hook mirroring `useReducedMotion`.
It declares `COMPACT_VIEWPORT_MAX_REM = 64` — the same number as the CSS media query — and the
test asserts the two agree, so the disclosure can never disagree with the layout about what
"compact" means. Where `matchMedia` is unavailable it reports **not** compact, which errs towards
showing the context rather than hiding it.

Because React writes `open` only when the value it last rendered changes, a viewer's own toggle
survives every re-render; it is re-decided only when the breakpoint is crossed, which is a resize
or a rotation, where re-deciding is the right behaviour anyway.

## Touch targets (AC#3)

Every `<button>` and every `<a>` on the live surface carries `.public-tap` (44×44 minimum, WCAG
2.5.5 / 2.5.8). ART-126 added it to the four standalone links that had been relying on the WCAG
2.5.8 *inline* exception, which does not apply to them: the text-live signpost, the story
overlay's recommended-entry link, and the character card's Episode and full-page links.

The test sweeps the whole mounted surface with the card open and asserts the offender list is
empty, so a new control cannot be added without one.

## Blocking overflow (AC#4)

Three separate causes, each closed:

| Cause | Fix |
| --- | --- |
| Long unbroken identifiers (`7:evening:mistwood-mill`, arc ids, participant ids joined with 、) set the block's min-content width and push the page sideways | `overflow-wrap: anywhere` on `.public-page`. `anywhere`, not `break-word`: only `anywhere` also shrinks the intrinsic min-content width, which is the half that stops the overflow |
| A grid track's automatic minimum is `auto`, so the canvas would refuse to shrink and widen the grid past the viewport | `minmax(0, …)` on every track |
| `.live-map-canvas` had `min-height: 280px`, which **beat** its own `min(70vh, 640px)` cap. A phone in landscape is around 360px tall, so the map plus the page header left nothing else on screen | `height: clamp(200px, 60vh, 640px)`, with a `dvh` repeat for browsers that can measure the viewport left after the mobile URL bar, and a short-landscape rule (`orientation: landscape` and `max-height: 32rem`) taking it down to `clamp(140px, 55vh, 320px)` |

## What is verified, and what is not

`liveResponsiveLayout.dom.test.tsx` splits each criterion into the half a DOM can settle (what
exists, what contains what, what order, which classes, what happens on a press at a small
viewport) and the half only the stylesheet can (`@media` rules, track definitions, clamp bounds),
and asserts both. jsdom applies no CSS, so neither half alone would mean anything.

What no test here covers is **real layout in a real engine at a real viewport**. No headless
browser runs in this repo yet; that is ART-137 (FR-O008's browser E2E across desktop and mobile in
both orientations). This suite is the structural floor under it, not a substitute for it — and the
release gate ART-138 is where the browser evidence is required.
