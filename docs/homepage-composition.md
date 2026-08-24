# Homepage Composition (FR-P001 / ART-129)

The public homepage's first screen. What it shows, why it is one section rather than five,
where each field comes from, and which of its claims are machine-checked.

Related: `docs/public-design-system.md` (FR-P003, the tokens and card shape this renders with),
`docs/live-editorial-navigation.md` (FR-P002, the link namespace it targets),
`docs/dynamic-view-e2e.md` (FR-Q006, the browser harness that watches it).

## 1. The problem

PRD 2.0 §4.1 names the core product gap: the homepage presented text headings and lists, so a
visitor read *about* a world before ever seeing one. UX2-001 states the inversion — the viewer
should see the world first. The homepage already fetched everything needed to do that; it simply
rendered none of it above the fold.

## 2. What the first screen is

One `<section class="home-first-screen">`, holding, in order:

| Element | AC | Source |
|---|---|---|
| 「進入實況地圖」 lead action + 「改用文字實況」 | #1 | `liveMapHref` / `textLiveHref` (`live/liveMapRoute`) |
| Up to four residents, drawn, each the whole tile a link | #2 #3 #4 #5 | `onboarding:<worldId>` → `structured.characters` |
| Current situation (~30s) | #2 | `onboarding:<worldId>` → `summaryText` |
| Primary story arc + its open question | #2 #5 | `live:<worldId>` → `activeArcs` |
| 最新大事 | #2 | `onboarding:<worldId>` → `structured.majorEvent` |
| Up to two active scenes | #2 #5 | `live:<worldId>` → `activeScenes` |
| Recommended Episode | #2 | `onboarding:<worldId>` → `structured.recommendedEpisode` |

It is **one** section, not five. Five sections would be five `<h2>`s and five cards under the
design system's `main > section` rule — that is a table of contents, which is the thing UX2-001
is asking to stop doing. One section is one screenful.

### No new query

`activeArcs` and `activeScenes` are two more fields of the `live:<worldId>` model the homepage
**already** fetched for its 實況 section. The first screen therefore costs zero additional reads,
and Security Impact ("the public homepage must trigger no LLM call") is unchanged by construction:
nothing new is read, and what is read are published projections.

Both fields are optional and both are guarded with `Array.isArray` rather than `?? []`. The
payload is an untyped published model; a malformed one must degrade the first screen, not blank
the homepage.

## 3. Drawing the residents (AC#3, AC#4)

`CharacterSprite` cuts the front-facing frame out of the shared character texture with
`background-position`, using `CHARACTER_TEXTURE_URL`, `SPRITE_CELL_ORIGINS` and
`SPRITE_FRAME_SIZE` from `data/spritesheets/catalogue`.

### Why not the live map's portrait

`components/live/CharacterCard` draws the same thing through `useSpriteAssets()`, which
recolours palette variants on a `<canvas>` and returns a data URL. That machinery is in
`clientLive`, and `clientPublic` may not depend on `clientLive` — the reverse edge already
exists, so the import would be a cycle. Extracting it into a third module was the alternative,
and refactoring the live map's asset pipeline to put twelve 32×32 frames on the homepage is not
a trade worth making. `data/` is owned by no boundary module, so reading the catalogue directly
needs **no boundary change at all**.

### The one difference, stated rather than hidden

The homepage draws the **base** cell, not the palette-recoloured variant. Four of Mistwood's
twelve residents are palette variants of another's sprite (`pei-lan`/`f1`, `wu-zhen`/`f2`,
`fang-yue`/`f4`, `zhao-ming`/`f6`), so such a pair shows the same figure in the base palette on
the homepage. Their *binding* is still theirs — the sprite key is the identity FR-N004 assigns —
and their name is rendered beside them as real text.

### The key is the binding's key, not the asset key

`mistwoodCharacterSpriteKeys` maps to an **asset** key, which for a palette variant is suffixed
(`f6:mistwood-indigo-hair`). That is not a sprite key, `isSpriteKey` rejects it, and the first
implementation of this rendered `data-sprite="none"` for four residents because of it. The
resolution now goes through `MISTWOOD_CHARACTER_VISUALS.find(...)?.spriteKey` — the binding's
own base key — and `homeRoute.test.ts` pins that every Mistwood resident resolves to a key
`isSpriteKey` accepts.

A character with **no** binding renders `data-sprite="none"` rather than borrowing another
resident's appearance (FR-N004 AC#6). Their name still identifies them.

### Decorative, deliberately

The sprite is `aria-hidden="true"`. The character's name is beside it as real text, so announcing
the sprite as well would announce the same information twice. `image-rendering: pixelated` keeps
the 2× scale crisp instead of blurring a 32px frame.

## 4. The primary arc, and the drift it could cause

`pickPrimaryArc` ranks by status (`climax` → `escalating` → `active` → `resolving`), breaks ties
by `arcId`, and ranks an **unknown** status last while keeping it eligible — a lifecycle stage
added later degrades to "sorted last", not to "disappears from the homepage".

The table is **restated** from `components/live/storyOverlayModel.ts`, not imported, for the same
boundary reason as the sprite. A restatement that drifts would be worse than the duplication: the
homepage and the live overlay would name *different* arcs as "the" story, which is worse than
either naming none. So `homeRoute.test.ts` reads the other module's **source text** and asserts
both tables match it. Changing one without the other is a red test, not a silent divergence.

## 5. Where each link goes (AC#5)

| Click | Destination |
|---|---|
| A resident tile | `#character/<worldId>/<characterId>` |
| The primary arc | `#arc/<worldId>/<arcId>` |
| An active scene | `#episode/<worldId>/<worldDay>` |
| Recommended Episode | `#episode/<worldId>/<worldDay>` |

A scene's page **is** the day's Episode — that is FR-P002's continuity rule, not a shortcut. The
map link belongs to the live surface, which the first screen already offers as its lead action.

The whole resident tile is the `<a>`, not just the name: a 32px name beside a 64px sprite is a
target that misses on a phone, and the sprite is the part the eye goes to. `.public-tap` keeps it
at the WCAG 2.5.5 floor.

## 6. What is machine-checked, and what is not

**`homeRoute.test.ts`** (pure): the arc ordering including the unknown-status case, the
source-text drift pin against `storyOverlayModel.ts`, the scene cap, sprite-key resolution for
every Mistwood resident, and the `Array.isArray` degradation for a malformed payload.

**`publicPages.a11y.test.tsx`** (jsdom + axe): the first screen renders the live entry point, the
non-map equivalent beside it, drawn residents whose `data-sprite` matches the binding, and every
AC#2 field; heading levels still run h1 → h2 → h3; the whole page still passes axe.

**`e2e/dynamicView.spec.ts`** (real Chromium, desktop + Pixel 5): AC#3/#4 probe the actual
texture with `new Image()` — a `background-image` pointing at a 404 renders exactly like a
correct one in the DOM, so asserting the URL alone would assert nothing. AC#5 clicks through and
checks the destination. AC#6 reads `window.__ART137__` for attempted writes **and** watches the
browser's own network layer, which the fixture client cannot influence.

**Not machine-checked**: whether the first screen actually reads as "a living world" to a person.
That is the aesthetic half of UX2-001, recorded as human review here and at the ART-138 release
gate, exactly as FR-P003 recorded its own.

## 7. What moved

Two things left the 認識這個世界 disclosure section, for one reason: AC#2 puts both on the first
screen, and leaving the originals behind would state each of them twice on one page.

- **The cast list** was four names as text; it is now the drawn tiles on the first screen.
- **推薦入坑點** was a second link to the *same* Episode the first screen now recommends — one
  destination twice for anyone navigating by link. Its "尚未推薦" empty state moved with it, so a
  viewer can still tell "nothing recommended" from "the section is broken";
  `publicPages.a11y.test.tsx` pins both the single link and that empty state.

The disclosure section keeps 必知事實. Every other section of the homepage is untouched.
