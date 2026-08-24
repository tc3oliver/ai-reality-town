# Public design system

**Requirement:** FR-P003 (PRD 2.0 §12 Epic P, RISK2-006) · **Task:** ART-131

PRD 2.0 RISK2-006 names the problem precisely: the public pages "render as plain dark documents
resembling an admin console", and that is a primary reason the product still reads as a technical
demo. This is the record of the language that replaced them and, more usefully, of what was
actually causing it.

## What was actually wrong

Three things, in order of how much they mattered:

1. **The pages were set in a terminal font.** `PublicPageFrame` carried `font-body`, which is
   `'VCR OSD Mono', monospace` — a pixel face with no CJK coverage at all, so every Chinese glyph
   fell back to a generic monospace. Monospace *is* the visual signature of an admin console. This
   single class did more to make the pages read as tooling than any colour choice.
2. **Tailwind preflight had stripped every control's appearance.** `.public-tap` sized buttons and
   did nothing else, so every button on every page rendered as bare text.
3. **There was no surface.** Content sat directly on the body gradient with no card, no border and
   no elevation, so a page was an undifferentiated column of headings and paragraphs.

Colour was the *least* of it. A palette applied to those three problems would still have looked
like an admin console in colour.

## Tokens

Declared on `.public-page`, overridden in a `prefers-color-scheme: dark` block. Nothing outside
this block names a colour literal — which is what lets the contrast harness resolve every one of
them and compute the ratio in CI rather than trusting a one-off measurement.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--public-surface` | `#ffffff` | `#15191c` | Card background |
| `--public-surface-sunken` | `#e9edef` | `#0b0e10` | Nested card, chip, button |
| `--public-border` | `#b3bcc2` | `#39434a` | Decorative hairline |
| `--public-border-strong` | `#5f6a72` | `#8d99a1` | Any border that carries meaning |
| `--public-text` | `#14181b` | `#f2f5f7` | Body ink |
| `--public-muted` | `#4a4a4a` | `#c9c9c9` | Secondary ink |
| `--public-link` | `#0842a0` | `#9ecbff` | Links |
| `--public-accent` | `#7a3b12` | `#f0b060` | Heading rail, live state, pressed toggle |
| `--public-accent-soft` | `#f7ecdd` | `#241a10` | Pressed / hovered control fill |

The accent is a warm amber-brown drawn from the same hue family as the world's pixel art and the
`.game-title` gradient (`#fec742 → #dd7c42`), so the public pages read as part of the product
rather than as its console.

### Two border tokens, on purpose

`--public-border` measures under 2:1 against its surface, and that is fine: WCAG 1.4.11's 3:1
applies to boundaries **required to identify a component**, and nothing is identified by a card's
hairline. Anything whose border *is* a signal — the status chip, whose border-style is one of its
three non-colour state signals — uses `--public-border-strong` (5.5:1 light / 6.1:1 dark). The
distinction is asserted, not merely intended.

### Three backgrounds, not one

Before ART-131 there was one background, the body gradient, and the contrast assertions measured
against it. Cards introduced a second and nested cards a third, so a token could have cleared AA
on the page and failed on a card with nothing noticing. Every ink token is now checked against all
three, in both schemes — 24 ratios, worst case **6.1:1 light / 9.3:1 dark**.

The harness also had to learn to resolve `var(--token)` before measuring. Without that it would
have been computing the luminance of the *string* `"var(--public-muted)"`, which parses to `NaN`,
and every `toBeGreaterThanOrEqual` would have passed forever. `the token resolver actually
resolves` pins that both ways.

## Type

`--public-font-body` is a real reading stack (`system-ui` plus the common CJK families).
`--public-font-chip` keeps `VCR OSD Mono` — but **only** on the status and metadata chips, where it
is a short numeric label rather than a paragraph of Chinese it cannot render. That is the one place
the pixel face reads as the world's own typography instead of as a terminal.

The scale (`h1`/`h2`/`h3`) is declared once on `.public-page`, not as `text-*` utilities repeated
on every heading of every page, because repeated utilities are exactly how the five surfaces drifted
apart in the first place.

## Cards, applied by structure

Every public page already renders its content as `<section class="… mt-4" aria-labelledby>` inside
a single `<main>` — a shape ART-93 established for accessibility reasons. The card treatment
attaches to **that shape**:

```css
.public-page main > section,
.public-card { background: var(--public-surface); border: 1px solid var(--public-border); … }
```

Two consequences worth stating. Almost no page markup changed, so this task cannot have altered
what any page *says* (AC#6). And a section added later gets the treatment without anyone
remembering to ask for it.

The test asserts both halves: every one of the six surfaces really does render `main > section`
(a page that wrapped its regions in a `div` would silently opt out and look like the odd one, with
nothing failing), **and** the rule that styles that shape exists.

`.public-card` is the same treatment for the nested cases the structural rule cannot reach — an
Episode row, a character row, a scene inside a list.

### `.public-rows` is opt-in, and that is the point

A blanket `li + li { border-top }` inside cards would have been tidy — except the live surface's
camera chrome renders its focus targets as `<ul class="flex flex-wrap">` of buttons, and the rule
would have drawn a line above every button in a wrapped row. A structural selector cannot tell
those two kinds of list apart, so the lists that want row treatment say so.

## Status vocabulary

`publicStatusBadge.ts` (pure) composes descriptors; `PublicStatusChips.tsx` draws them. One place
each, so five surfaces cannot render the same state four different ways.

| State | Label | Glyph | Border |
| --- | --- | --- | --- |
| `live` | 直播中 | ● | solid, accent |
| `delayed` | 延遲 | ◐ | dashed |
| `paused` | 已暫停 | ‖ | double |
| `stale` | 資料過期 | ✕ | dotted |

**Three non-colour signals per state (AC#7)**, following the convention `TimeStateBanner`
established in ART-121: the visible label, a distinct `aria-hidden` glyph, and a `data-state`
attribute the stylesheet turns into a distinct border-style. The test strips the class *and* the
data attribute *and* the glyph's `aria-hidden` and checks the remaining text still tells the four
apart — so the claim survives greyscale **and** the stylesheet being off entirely.

`stale` is a state of its own rather than being reported as `paused`, and the distinction is the
honest one: a stale snapshot means the capture path has not confirmed anything for hours, so the
state it claims is a claim nobody has checked. Saying "paused" there would assert something about
the world that nothing currently knows.

An unrecognised, absent or in-flight state renders **no badge**. A future server state therefore
degrades to silence, which is the only safe direction — a badge that says the wrong thing about
whether a world is running is worse than no badge.

### Where the freshness value comes from

The homepage reads `getPublicRuntimeSnapshot`, an anonymous `query` already on the
`publicFunctionSurface` allowlist. On the homepage rather than only on the map because "is this
thing actually running?" is a question a visitor has *before* they open the map.

ART-128 removed that query's caller-suppliable `nowMs`, and that is what makes the badge worth
rendering at all: freshness is decided by the server clock, so no viewer can make a five-hour-old
snapshot report `live` by naming the instant themselves. `publicReadOnlyGuarantee.test.ts`
enumerates the client-reachable Convex surface exhaustively, so adding this reference had to be a
deliberate, reviewed act — which is exactly what that suite is for.

## Live surface

The live map is one of the five surfaces AC#4 names, so it is drawn from the same tokens. Before
ART-131 its panels used `border-color: currentColor`, which is not a shared decision — it is each
element picking its own. `.live-story-overlay` and `.live-map-canvas` now take the shared card
treatment, `.live-character-card` adds the accent rail to mark it as the thing the viewer just
opened, and the test asserts no `.live-*` rule reaches for `currentColor` as a border any more.

## What is verified, and what is not

Verified mechanically: every token's contrast on all three backgrounds in both schemes; the two
border tokens' different thresholds; the card shape present on all six surfaces and the rule that
styles it; the live surface drawing from the shared tokens; the terminal font gone from the frame
and surviving only on chips; controls drawn as controls; the pressed state signalled by weight and
border-width as well as colour; each chip state's distinct border-style; the greyscale-survival
proof; and the palette being non-monochrome (the accent's channel spread must exceed 48, where a
grey is 0).

Five fault injections confirmed those assertions are non-vacuous — including one that is the whole
reason the harness was extended: a muted ink that **still passes on the body background and fails
on the card surface**, which the pre-ART-131 assertions could not have seen.

**Not verified mechanically: AC#5's "no longer reads as an admin console".** That is a human
judgement and is recorded as one. What the tests establish is that a design system exists, is
applied on every surface, and is not monochrome — which is the mechanical part of the claim. The
aesthetic verdict belongs with the manual review checks in `docs/accessibility.md` §4 and, for the
release, with the ART-138 gate.

Also out of scope by the task's own terms: responsive rules (FR-O008 / ART-126, already delivered)
and accessibility compliance as a programme (NFR2-006 / ART-135). Nothing here regresses the
ART-93 floor — the whole `a11y` suite passes, including axe on every surface.
