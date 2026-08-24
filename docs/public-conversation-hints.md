# Public Conversation and Activity Hints (FR-O004 / ART-123)

How the map shows that people are talking, without showing what they said.

Related: `docs/character-motion-rendering.md` (the animation states this lights up),
`docs/dynamic-safety-filtering.md` (FR-P004, whose withhold this must survive),
`docs/active-scene-presentation.md` (where the scenes come from).

## 1. This lights up a contract that has been dormant since ART-115

`PublicAnimationState` has declared `speaking | thinking | activity` since ART-115. The
validators accept them. `CharacterStateIndicator` already **draws** the speech bubble and the
thought cloud — `characterAnimation.ts`'s `SPEECH_PRIMITIVES`.

No server code has ever produced any of the three. Both that file and
`docs/character-motion-rendering.md` name FR-O004 as the task that would, which is why the
task's Schema Impact is None and is right: this adds no field and no table. It produces values
the whole stack already knows how to carry and render.

## 2. No world-derived text on the canvas

AC#1 allows "a public dialogue summary, **status** or a short bubble". Choosing the existing
vector indicator over a `PIXI.Text` caption makes AC#2 and AC#3 structural on the map surface
rather than disciplinary: no projection text reaches the renderer, so none can leak there, and
there is nothing to remember to truncate or filter.

**Stated precisely, because the first version of this document got it wrong:** the canvas is
*not* text-free. `MapZoneLayer` draws the eight authored location names from `data/mistwood.ts`
— repository constants, identical on every deploy, public by construction. They are not a leak
surface and never become one.

The claim that matters, and the one the criteria need, is narrower: **no text on the canvas
comes from a projection payload.** `conversationHints.test.ts` pins that `MapZoneLayer` is the
only text constructor in the renderer, that it is fed from `footprint.name`, and that no
renderer file so much as reads a `summary`, `publicSummary`, `dialogue` or `summaryText` field.

The public summaries live in the DOM instead — the scene panel and the character card — where
they have already been through FR-P004's withhold substitution, can be read by a screen reader,
and can be selected.

## 3. State comes from participation; text comes from publication

A character reads as `speaking` because they are a participant in an **active scene**, decided
**without reference to `publicationStatus`**.

That is AC#5 directly: when there is no publishable text, the safe state is still shown. It also
preserves a guarantee FR-P004 already makes — ART-132 AC#4 requires that withholding text must
not move any character, and by the same reasoning it must not change their animation state
either, or the withhold would be visible on the map as a behaviour change.

This adds no leak surface, because a withheld scene's existence, location and participants are
*already* public: `activeScenePresentation` blanks only `title` and `summary`.

| Participants in an active scene | State |
|---|---|
| 2 or more | `speaking` |
| exactly 1 | `activity` |
| ended scene, or none | unchanged |

**`thinking` is never produced.** Nothing in Canon records that a character is thinking, and
inventing an inner state from a participant count is exactly the RISK2-008 violation the map
exists to avoid — asserting a world fact nobody accepted. The value stays declared and
renderable for whenever something does record it.

**Only an `idle` motion is refined.** A character mid-walk is on their way somewhere; a bubble
over a walking figure would claim they are standing talking. The published motion is the more
specific fact and keeps precedence, which also keeps ART-119's guarantee intact.

## 4. No second projection field

The short hint is a pure function of `summary`, which is already published and already
withhold-substituted.

Adding a second field — a separately truncated copy of the same published text — would create a
**second place the withhold substitution has to be applied**, which is a second leak surface,
for no new information. Instead the client derives it from the substituted summary: a withheld
scene's summary is `''`, so its hint is `''` **by construction**, with no second code path that
could be written wrongly.

`truncateForPublic` lives in `convex/shared` so the server and the client shorten identically —
two rules would mean the card and the panel disagree about where a sentence ends. The ellipsis
counts **inside** the budget: appending after truncating returns one character more than the
caller sized their column for, which is how a hint pushes a card wider on the one screen nobody
tested. Word boundaries are deliberately not respected, because Chinese has none and a rule that
only worked for the space-separated half would cut CJK arbitrarily while looking correct in
review.

## 5. What the card and the panel now say

The card gains two rows, both from the same active scene the map is drawing:

- 「與 X、Y 交談中」 — the other participants, as ids, because the projection publishes no
  display names and the camera controls and scene panel show ids too. Three surfaces, one name
  for each person.
- 「談話內容:…」 — the shortened published summary. **Absent, not blank**, when the text is
  withheld or unpublished: an empty row would imply the conversation had nothing in it, while
  the state row above still says they are talking.

Two scenes are never concatenated. A sentence neither scene published is exactly the derived
text FR-P004's provenance rule forbids, so the first active scene with any published text wins.

The scene panel now reads `publicationStatus`, which the client had never looked at, and marks a
withheld scene 「(內容審核中)」. The server had substituted the placeholder since FR-P004 — so
nothing leaked — but the panel presented that placeholder as though it were the scene's actual
title, with nothing saying the content was held back. The location and participants stay, because
the map is already drawing characters standing there and a scene vanishing from under them would
be a bigger lie.

## 6. Runtime version 4

`PUBLIC_DYNAMIC_RUNTIME_VERSION` goes 3 → 4. No field changed shape; `animationState`
**reinterprets** two values it has always declared. `docs/public-dynamic-projection.md` requires
a bump for a reinterpretation of an existing field, not only for a shape change — a client that
assumed `idle | walking` were the only reachable values is reading a different contract from one
that does not.

## 7. Three exhaustive guards named this work, all correctly

- `visualReplay.boundary.test.ts` pins the replay builder's dependency closure.
- `ambientMotion.boundary.test.ts` pins the client bundle's closure, including type-only edges.
- `activeSceneModel.test.ts` pins the panel's full display record.

Each had to be updated deliberately. `conversationState.ts` imports nothing but a type from
`publicDynamicProjection`, so it cannot be a route to the Canon seed — but the point of those
pins is that saying so is a reviewed decision rather than an assumption, and they did their job.
