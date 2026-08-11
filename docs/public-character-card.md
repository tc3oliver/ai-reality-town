# The Public Character Card (FR-O006, ART-124)

Modules: `src/components/live/characterCardModel.ts` (the pure display model),
`src/components/live/CharacterCard.tsx` (the render layer),
`src/components/live/CameraControls.tsx` (the open affordance),
`src/components/live/LiveMapPage.tsx` (the two conditional reads),
`src/index.css` (`.live-character-card`, `.live-character-portrait`).

Clicking a character is the primary path from "who is that" to narrative understanding. It is
also the most direct private-data exposure risk on the live map: everything a viewer wants from
a character card sits next to, and is often derived from, the things they must never see.

## 1. The field contract

Everything the card shows, and where each field comes from. Nothing else is read, and the model
is built from NAMED fields only — it never copies or spreads its inputs.

| Card field | Source | AC |
| --- | --- | --- |
| `name`, `occupation`, `publicProfile`, `publicGoal`, `emotionalState` | the published `character:<id>` projection (§13.2 allowlist, ART-84) | #1, #2, #3 |
| `spriteAssetKey` | `mistwoodCharacterSpriteKeys` — the same roster the renderer draws from | #6 |
| `locationLabel` | the `PublicCharacterMotion`'s `semanticLocationId`, named through `mistwoodLocationFootprints`; the projection's `currentLocationId` when the character has no published motion | #2 |
| `movementLabel` | the motion's `motionType` | #2 |
| `activityLabel` | the motion's `animationState` | #2 |
| `activeArcs` | `activeScenes[].arcIds`, scoped to `status: 'active'` scenes naming this character in `participantCharacterIds` | #3 |
| `recentEvents` | the `timeline:<worldId>` read model, filtered by `characterIds`, newest `CHARACTER_CARD_RECENT_EVENT_LIMIT`; safety-gated at rebuild time (see §5) | #3 |
| `characterHref` | `#character/<worldId>/<characterId>` | #4 |

**Never shown, and structurally unreachable:** `privateProfile`, `privateGoal`, undisclosed
Knowledge, private memories, prompts, raw model output, operator annotations. Also absent, though
server-allowlisted: `fear`, `personality`, `values`, `age`, `financialState`, `healthState` — the
card shows what AC#1–#3 name and stops there, and the full page is one link away.

Three independent defences carry AC#5, on purpose:

1. the projection is field-allowlisted server-side (`buildCharacterProjection`) and, since
   ART-124, safety-gated per contributing scene (see §4);
2. `composeCharacterCardViewModel` constructs from named fields, so a forbidden key in the
   payload has no route into the model (`characterCardModel.test.ts` feeds a poisoned source and
   asserts the absence of both the KEYS and the VALUES as literal strings);
3. `CharacterCard.tsx` prints named model fields, so even a view model that somehow carried a
   private field would render none of it (`liveMap.a11y.test.tsx`).

## 2. Why the card opens from a button, not from the sprite

The natural gesture is clicking the character on the canvas. The natural implementation is a
Pixi pointer handler, and it is refused three ways: `src/components/world/Character.tsx` is
`eventMode="none" interactiveChildren={false}`, `readOnlyWorldSurface.test.ts` greps the whole of
`src/` for a handler near character rendering, and a canvas hit test is unreachable by keyboard
and invisible to assistive technology regardless.

So the affordance is a second `<button>` beside each character's existing focus button in
`CameraControls.tsx` — "角色卡", named per character (`查看 <id> 的角色卡`) because every row
renders the same visible text. `characterIdFromFocusTargetId` recovers the character from the
focus target id by deriving the namespace from `characterTargetId` itself, so the two cannot
drift apart.

The card renders as a block-stacked section between the scene panel and the camera chrome, not
as an overlay. There is no dialogue pattern in this codebase to follow, a correct one needs focus
trapping to be worth having, and covering the canvas would hide the character the card is about.

Not being a modal does not excuse it from managing focus, though, and it renders *below* its own
trigger — so without intervention a keyboard user presses "角色卡" and the new content lands
behind them in the tab order. Three things close that:

- the card is `tabIndex={-1}` and takes focus on mount, keyed on `characterId` so a payload
  arriving for the same character (loading → ready) does not yank focus back off whatever the
  viewer moved to;
- an `sr-only` `role="status" aria-live="polite"` line names whose card is open, which is what
  announces a switch from one character to another when the card re-renders in place;
- `LiveMapView` records `document.activeElement` when a card is opened and restores focus to it
  on close, so closing does not drop focus on `<body>`. It is captured there rather than plumbed
  through `CameraControls` as a per-row ref, because that component's entire contract is that it
  only calls state setters.

This is covered behaviourally, not just structurally. `characterCardFocus.dom.test.tsx` is the
one test in the repo that mounts a component and dispatches a real click: it renders
`LiveMapView`, presses the trigger, asserts `document.activeElement` is the card, closes it, and
asserts focus is back on the exact button that opened it. It has to mount, because the `a11y`
project renders through `renderToStaticMarkup` — no effects, no events — so it can prove the card
is *focusable* but never that focus *moves*, which is precisely where a regression would hide.
Both halves are mutation-checked: deleting the focus-on-mount fails the open test, and deleting
the restore fails the close test.

## 3. Two reads, both skipped until a card is opened

The card needs two things the live map does not already hold: the character's identity fields and
the world timeline. Both are read in `LiveMapPage.tsx` — every read this feature makes has to be
there, which is why the selection state lives on the data layer rather than in `LiveMapView` —
and both go through the generic, failure-isolated `getPublishedReadModel` the public pages
already read through. No new backend surface, and no generation on read.

Both are `'skip'`ped while no card is open, so watching the map still costs exactly the two
queries it always did. `liveMapSurface.test.ts` asserts the query count, the names, AND the skip
count: "four queries" and "four queries on mount" are very different claims about a public page.

Location, activity and arc membership need no read at all — they are already in the dynamic
projection the map is drawing.

**Three read states, not two.** `useQuery` returns `undefined` while a read is in flight, and
`serveReadModel` returns `null` when the read completed and no projection has ever been published
for that character. Collapsing them shows "loading…" forever for something that is not coming, so
`CharacterCardStatus` is `loading | unavailable | ready`. `unavailable` still renders the half
that needs no projection — location, movement, activity, portrait — plus the link to the character
page, since a card that could not load is exactly when a viewer most needs the page that can.
`CharacterPage.tsx` draws the same distinction.

## 4. Visual identity (AC#6)

The card resolves its portrait through the same `assetKey -> sheet` table the Pixi canvas draws
from: `useSpriteAssets()` in `LiveMapView`, keyed by `mistwoodCharacterSpriteKeys[characterId]`.
A palette variant therefore appears on the card recoloured exactly as it appears on the map,
including the documented degradation to the base texture where no canvas is available. The
portrait is the front-facing frame (`SPRITE_FRAME_ORDER[DEFAULT_PORTRAIT_FRAME]`), cut out of the
shared texture with `background-position` and rendered `image-rendering: pixelated` so the two
surfaces sample the same pixels the same way.

The test compares the card's key against what `composeReadOnlyWorldViewModel` actually resolved
rather than against a hand-written constant — a pinned expectation would keep passing if the two
lookups drifted the same way.

## 5. The safety gap this task also closed

Researching AC#5 surfaced a real hole rather than a theoretical one: a character's public
biography is LLM-writable after world creation, through the generic `fact_created` /
`character_state_changed` state changes a scene proposes, and was covered by no safety gate at
all — ART-132 scanned a scene's narrative text only. ART-124 widens the classifier's input and
gates the character projection on the resulting verdict.

Review then found the same class of leak on this card's own "recent major events" list: the
`timeline:<worldId>` projection copied `publicSummary` straight off the Canon rows with no gate,
so a scene an operator had withheld went on narrating itself here — and this task is what routed
that text onto the live map. `rebuildTimelineProjection` is now gated the same way, which fixes
the character page's identical list for free.

Both are documented where the rest of the gate is, in
[`dynamic-safety-filtering.md`](./dynamic-safety-filtering.md) §4a — including the fields the
classifier deliberately does *not* scan, and the consumers still ungated.

## 6. Known limitations

- **The active arc is shown by id, with the scene that puts the character in it.** Arc *titles*
  live in the arc projection, which is a third read this surface deliberately does not make; the
  scene title is the human-readable context that is already in the payload. The arc pages carry
  the full titles.
- **`recentEvents` is bounded to five.** The card sits beside a live canvas; the complete history
  is on the character page AC#4 links to.
- **No relationship graph.** Out of scope by the task's own statement — ART-44 owns it.
