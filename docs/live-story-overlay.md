# The Live Story Overlay (FR-O007, ART-125)

Modules: `src/components/live/storyOverlayModel.ts` (the pure display model),
`src/components/live/StoryOverlay.tsx` (the render layer),
`src/components/live/LiveMapView.tsx` (placement),
`src/components/live/LiveMapPage.tsx` (the two reads),
`src/index.css` (`.live-story-overlay`, `.live-story-overlay-summary`).

A map shows *what* is happening. It cannot show *why it matters*, *who is involved* or *where to
catch up* — and a viewer arriving at a world on day 40 needs all three before the map means
anything. PRD 2.0 UX2-004 therefore requires narrative context to be permanently available beside
the map, which is what this overlay is.

## 1. The content contract

Everything the overlay shows, and where each field comes from. Nothing else is read.

| Overlay field | Source | AC |
| --- | --- | --- |
| `worldDayLabel`, `timeSlotLabel` | the `PublicDynamicProjection` the map already holds (`worldDay`, `timeSlot`) | #1 |
| `activeSceneSummary` | the same projection's `activeScenes`, `status: 'ended'` excluded, first `STORY_OVERLAY_SCENE_BRIEF_LIMIT` titles named | #1 |
| `currentSituationText` | the published `onboarding:<worldId>` summary's `summaryText` (FR-H001 / ART-37) | #1 |
| `latestMajorEvent` | that summary's `structured.majorEvent.publicSummary` | #1 |
| `recommendedEntry` | that summary's `structured.recommendedEpisode`, linked as `#episode/<worldId>/<worldDay>` | #2 |
| `primaryArc` | the published `liveState`'s `activeArcs`, ranked (see §2) | #1 |

Three deliberate sourcing decisions:

- **The day, the slot and the scenes are not read again.** They arrive as props from the same
  projection the canvas is drawing. Deriving them a second way is precisely how the overlay and
  the map would come to disagree, which is what AC#4 forbids; passing them through makes
  disagreement impossible rather than unlikely.
- **The "latest major event" is the onboarding summary's, not the Live projection's
  `recentEvents`.** `recentEvents` is ordered by recency; `structured.majorEvent` is chosen by
  *importance*. "Why does this matter" is an importance question.
- **The arc TITLE can only come from `liveState`.** The dynamic projection's
  `activeScenes[].arcIds` carries ids alone, and an overlay that named an arc `arc-truce` would be
  answering a question nobody asked.

## 2. Which arc is "primary"

The backend publishes every active arc without ranking them, because "which arc matters most" is
a presentation question and another surface may answer it differently. The overlay ranks by
lifecycle stage — `climax` > `escalating` > `active` > `resolving`, the four members of
`ACTIVE_ARC_STATUSES` — and breaks ties by `arcId` ascending. An arc at its climax is what a
viewer arriving now should be told about; one already resolving is the least likely to explain
what is on screen.

Two properties this buys, both tested: the choice is **deterministic** (the same payload always
names the same arc, whatever order the backend published it in), and it is **total** — a status
this build has never heard of ranks last but stays eligible, so a future lifecycle stage degrades
to "shown last" rather than to "not shown".

`primaryStoryArc` is exported separately from `composeStoryOverlayViewModel` because the ranking
is the only judgement the module makes. `STORY_ARC_STATUS_PRIORITY` is pinned against
`convex/publicRead/liveState.ts`'s `ACTIVE_ARC_STATUSES` by a test rather than imported at
runtime — the two lists are otherwise related only by having been written by the same hand, and a
fifth lifecycle stage added server-side would silently rank last here with nothing to notice.

## 3. Reads, and why public viewing generates nothing (AC#3, AC#6)

The overlay adds exactly two reads to `LiveMapPage.tsx`, taking the page from four named queries
to six:

| Read | Model | Fires |
| --- | --- | --- |
| `getPublishedReadModel` | `modelKind: 'world'`, `modelRef: 'onboarding:<worldId>'` | on mount |
| `getPublishedReadModel` | `modelKind: 'liveState'`, `modelRef: 'live:<worldId>'` | on mount |

Both are the **same generic, failure-isolated read** the public pages already use — the homepage
reads these two exact models — so there is no new backend surface and no new failure mode.

**AC#6 holds by construction, not by care.** Both models are *precomputed*: they are rebuilt when
Canon commits and served from the public read-model store. A read cannot reach a generator,
because the read path has no generator in it. There is no cache-miss branch that falls back to
building one, which is the design ART-37 chose precisely so that per-visitor reads could never
trigger generation.

### 3a. The safety gate this task had to add first (FR-P004)

Routing `onboarding:<worldId>` onto the live map exposed that it was the one public TEXT surface
ART-132's safety filtering had never reached — the third instance of the same gap, after
`liveState` (ART-132 itself) and the Timeline projection (ART-124). `rebuildOnboardingSummary`
read `publicSummary` straight off `canonEvents`, harvested `fact_created` predicates and values
off their `stateChanges`, and copied the day's narration straight off `dailyEpisodes.keyScenes`.
All three land in `summaryText`, so a Scene an operator had withheld went on introducing the
world with its own refused sentence — on the homepage already, and on this overlay next.

Closed with ART-132's own machinery, imported rather than re-implemented, so the surfaces cannot
disagree about which events are refused: `readWithheldSceneLabels` (the bounded, inverted sweep),
then `sceneEventRows` + `withheldEventIds` + `redactWithheldSummaries` + `redactWithheldNarration`.

| Field | Gate |
| --- | --- |
| `majorEvent` | selected from the redacted event array, so a refused event carries no summary and the pick falls through to the next showable one |
| `facts` | events whose Scene is refused are skipped outright — `redactWithheldSummaries` drops only `publicSummary`, and a fact's predicate and value are LLM-authored public text that ART-124 brought inside the classifier's input |
| `scene` (episode narration) | `redactWithheldNarration` neutralises a key scene that narrates a refused event, and the pick falls through to the next non-empty scene |

Unlike the Timeline — which KEEPS a refused entry and nulls its text, because dropping a row
would silently renumber a public history — this surface SKIPS and re-picks. It has no positions
and no addressing, and a summary that led with `(無摘要)` would be strictly worse than one that
led with the best showable event.

`overridePostGenerationSafetyLabel` now runs `rebuildOnboardingSummary` beside
`rebuildLiveProjection`, in the same transaction, and reports both refreshes. Gating the rebuild
alone would have left the refused sentence published until the next natural Canon commit — which
on a paused or finished world never comes.

`onboardingSummaryFunctions.test.ts` proves the closure end to end. Each gated field is covered by
a PAIR of handler-level tests against the published payload: one that publishes the refused text
when nothing is withheld (so the fixture demonstrably routes it onto the surface, and the gated
test is not passing vacuously), and one that proves the gate removes it — plus the operator
override, the release, `human_review_required`, the no-provenance case, and redaction keyed by
event id rather than by array position.

**AC#3 likewise.** Neither read touches the Canon write store; both go through the published
read-model store, and `clientLive`'s declared module dependencies do not include `canon` at all.
`liveMapSurface.test.ts` asserts structurally that `StoryOverlay.tsx` and `storyOverlayModel.ts`
name no request or write API of any kind, and that `LiveMapPage.tsx` remains the only file in the
module that reads anything.

Unlike ART-124's two character-card reads, these are **not** `'skip'`-gated. The card is opened;
the overlay is always present, so gating it would mean gating it on nothing. The surface test
asserts the query names, the total (6) *and* the skip count (2) separately, because "six queries"
and "four queries on mount" are very different claims about a public page.

## 4. Collapsible, and never obscuring the map (AC#5)

The overlay is a native `<details>`/`<summary>`, rendered **open** by default.

- *Native, not a component.* There is no collapsible primitive in this codebase to follow, and a
  hand-built one would need its own `aria-expanded` wiring, keyboard handling and focus behaviour
  to be as good as the element browsers already ship. The rendered surface therefore carries no
  `aria-expanded` at all and no `<button>` — the disclosure is the browser's.
- *Open by default.* UX2-004 asks for the context to be permanently available; the reason AC#5
  asks for collapsibility is a small screen, so collapsing is the viewer's choice rather than the
  default. The world day and time slot live in the `<summary>` itself, so a viewer who has
  collapsed the panel still knows *when* what they are watching is happening.
- *Not an overlay layer.* Despite the name, it renders as an ordinary block-stacked `<section>`
  **before** `.live-map-canvas`, never as a positioned layer over it. A block sibling is
  structurally incapable of obscuring the canvas — no z-index or positioning decision could
  regress that.

Two suites pin that, deliberately split:

- `storyOverlayLayout.dom.test.tsx` **mounts `LiveMapView` for real** and asserts on the rendered
  DOM: the overlay and the canvas share a parent, the canvas follows the overlay in document
  order, neither contains the other, and no element inside the overlay carries a positioning or
  stacking utility class (`absolute`/`fixed`/`sticky`/`z-*`, prefixed variants included) or an
  inline style. The class assertion is the load-bearing one: this is a Tailwind project, so
  `className="absolute z-10"` would cover the map while passing any stylesheet sweep. The regex
  behind it is itself pinned both ways, so a negative sweep that matched nothing cannot pass
  forever. It lives in the `dom` project because `LiveMapView` imports `pixi-viewport`, whose
  named exports only that project's module mapping can resolve.
- `liveMap.a11y.test.tsx` covers the stylesheet: `.live-story-overlay` declares `position: static`
  and no `.live-story-overlay*` rule uses `absolute`/`fixed`/`sticky` or a `z-index`.

A source-text regex over `LiveMapView.tsx` was deliberately **removed** in favour of the mounted
test: it could be made to agree with almost any arrangement of the same identifiers, and it could
not see a `className` at all.

Placement is *above* the canvas rather than below it for the same reason the time-state banner is:
"why does this matter" has to be answerable before a viewer looks at the map, not after they
scroll past it.

## 5. Staying in sync with the map (AC#4)

The overlay holds no state and no cache of its own — it is a pure function of the payloads the
page hands it, recomputed by `useMemo` on their identity. So "stays in sync within a reasonable
interval" reduces to "the page re-renders", which the Convex subscription does whenever either
published model is rebuilt (that is, on every Canon commit).

The half that must never lag at all — day, slot, active scenes — is not subject to that at all:
it is *the same projection object* the canvas is rendering from, in the same render pass.

## 6. Degraded states, tracked per source

`undefined` (a read in flight) and `null` (a read that completed and found nothing published) are
kept apart, exactly as `characterCardModel.ts` keeps them apart for the character card. Collapsing
them shows "loading…" forever for a world whose onboarding summary has never been built.

The state is tracked **per source**, not once for the panel: `summaryStatus` governs the current
situation, the latest major event and the recommended entry point; `arcStatus` governs the primary
arc. The two reads resolve at different times, so one combined status puts the panel in a state
neither source is in — with a `null` summary beside a healthy arc list it read `ready`, suppressed
the "summary unavailable" notice entirely, and then asserted 「目前沒有可顯示的近期大事。」 as a
confirmed fact about a source that had never loaded; and during the loading phase a page-level
spinner rendered *above* every "there is none" empty state at once.

Each section therefore renders from its own source, through the `SourceState` helper:

| Source state | Condition | Situation / major event | Primary arc |
| --- | --- | --- | --- |
| `loading` | the read is in flight | `載入目前情勢中…` / `載入近期大事中…` | `載入故事線中…` |
| `unavailable` | the read completed, nothing published | `這個世界的故事摘要尚未建立…` / `近期大事尚未建立。` | `故事線資料尚未建立。` |
| `ready`, field absent | the model published, the field is genuinely empty | `目前沒有可顯示的近期大事。` | `目前沒有進行中的主線故事。` |
| `ready` | — | the text | the arc |

Only the third row may be phrased as a fact about the world, which is the whole reason the
distinction exists. An **empty** `activeArcs` array is `ready`, not `unavailable`: the model was
published and this world genuinely has no arc running.

The two degrade independently, so an unbuilt summary never hides a healthy arc and a pending arc
read never removes AC#2's recommended entry point. The active-scene section has no status of its
own — its data arrives with the projection the canvas is drawing, so if the overlay rendered at
all it is as current as the map. Every branch renders a sentence, so no section is ever a heading
over a blank region.

## 7. Defensive payload reads

Both published payloads reach the model through an `as` cast on an untyped stored value, so a
shape TypeScript was promised but the database does not hold is a real runtime case — and it
matters more here than on a public page, because this render sits inside `LiveMapErrorBoundary`,
which wraps the **whole** live map. A throw while composing the overlay would blank the canvas
too. Every path into either payload is therefore optional-chained to its last hop
(`summary?.structured?.majorEvent?.publicSummary`, matching `homeRoute.ts`), and `activeArcs` is
checked with `Array.isArray` rather than `?? []`, since iterating a malformed value would throw
just as readily as reading through a missing object.
