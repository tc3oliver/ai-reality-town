# Visual Replay (FR-O013 / FR-O014, ART-121)

Modules: `convex/publicRead/visualReplay.ts` (derivation), `convex/publicRead/visualReplayValidators.ts`
(the Convex `v` mirror), `convex/publicRead/visualReplayFunctions.ts` (the public query and the
read-time text resolver), wired into `rebuildLiveProjection` in `convex/publicRead/liveStateFunctions.ts`.
Client: `src/components/live/replayPlayback.ts`, `replaySession.ts`, `timeStateLabel.ts`,
`ReplayControls.tsx`, `TimeStateBanner.tsx`, wired into `LiveMapPage.tsx`.

A viewer arriving on `/live` between Canon slots sees a world where nothing recently happened.
Visual Replay fixes that by retelling, from data that has already been accepted and already been
published, the one to three most recent important completed scenes — then returning to the
current ambient state. RISK2-009 is the risk this whole feature exists to manage: a replay
mistaken for live activity would corrupt the product's core honesty promise. Every design choice
below is in service of making that mistake structurally hard rather than merely discouraged.

## Scene selection

`buildVisualReplay` groups accepted events into scenes with `groupSceneEvents` — the same
`(worldDay, timeSlot, locationId)` grouping ART-122 built for the live active-scene panel, reused
rather than re-implemented so the two never disagree about what counts as a scene.

`selectReplayGroups` then does three things, in this order:

1. **Drop the current slot.** Any group whose `(worldDay, timeSlot)` matches the latest accepted
   event's is excluded before anything else is considered. This is what makes RISK2-009 a
   data-selection property rather than a labelling promise: a scene still under way is simply not
   in the set a replay can be built from, so no client-side relabelling could ever present live
   activity as history or the reverse.
2. **Score and take the top three.** Each surviving group is scored by the highest
   `SceneArcMembership.importance` among its events (via `importanceBySequence`), tie-broken by
   descending max sequence number, then by ascending `sceneId`. The top `REPLAY_MAX_SCENES` (3)
   survive.
3. **Re-order to run forwards.** Importance decided *which* scenes; a replay is a story being
   retold, and a viewer reads it forwards, so the surviving groups are re-sorted into chronological
   order (ascending minimum sequence number) before anything else touches them.

Zero surviving groups (a brand-new world, or a world whose only activity is the slot in progress)
means `buildVisualReplay` returns `null`. That is deliberate, not an error state: PRD 2.0's failure
handling for this feature is "skip straight to the ambient state," so the caller commits nothing
and the client renders the live map exactly as it would with no replay at all.

### Participants and positions

For each surviving scene, `resolveSceneSpatials` (also reused from ART-122) resolves the
participant list and arc memberships. Positions are then folded from the *whole* accepted history,
not just the scene's own events (`foldLocations`): a participant already standing in the room named
no `character_location_changed` inside the scene at all, so their start position comes from
wherever they last arrived before the scene began, and their end position from wherever they stood
after its last event.

A participant whose pre-scene location is unknown, or whose location has no active Visual Binding,
is **dropped**, never guessed — the same refusal `visualSyncPlanner` makes for an unbound location
on the live map, applied here for the same reason: a position Canon never recorded must not appear
on screen.

### Steps

One `move` step per participant who actually changed position (duration from the existing
`travelDurationMs` over tile distance — a participant who stood still produces no step at all,
not a zero-length one), then one `eventCard` step per event whose text reference resolves
(`REPLAY_EVENT_CARD_MS` = 4 seconds each, long enough to read a sentence, short enough to sit
through).

## Duration fitting

PRD 2.0 asks for roughly 20–60 seconds per scene (`REPLAY_SCENE_MIN_MS` / `REPLAY_SCENE_MAX_MS`).
`fitSceneDuration` makes that true without ever dropping content:

- **Too short** is padded with one trailing `wait` step for the remainder, so a scene with little
  in it still reads as a scene rather than a flicker.
- **Too long** is compressed in two stages. Trailing `wait` steps are dropped first, because
  padding is the one thing that carries no content. If that alone is not enough, every remaining
  step's duration is scaled down proportionally (rounded, with the rounding residual added to the
  last step so the parts always sum to the whole). An `eventCard` step is **never** dropped to make
  a scene fit — silently omitting a scene's only published sentence would be a worse failure than
  one that reads a little quickly.

## The reference-only contract (AC#10)

No step in a built replay stores text. A `dialogue` or `eventCard` step carries an **address** — a
`publicSummaryId` (or `publicExcerptId`) plus the `publicationVersion` that was current when the
replay was built — and the sentence is resolved at *read* time, in `visualReplayFunctions.ts`,
never at build time. `REPLAY_FORBIDDEN_FIELDS` (every plausible free-text key, plus the whole of
`PUBLIC_DYNAMIC_FORBIDDEN_FIELDS`) is checked recursively by `assertVisualReplay` on every write
and every read, so a stray text field cannot survive even as an oversight.

This is not a stylistic preference. A stored copy would survive a withhold: if the editorial
pipeline later retracts an episode, a payload holding the retracted sentence verbatim would keep
serving it until something rebuilt the replay. An address cannot do that, because a version that no
longer matches the current publication record simply resolves to nothing.

### Address formats

| Ref kind | Address | Governed by |
| --- | --- | --- |
| `episodeScene` | `episode:<worldId>:<worldDay>#scene:<index>` (`episodeSceneSummaryId`) | The `publicationRecords` row for `episode:<worldId>:<worldDay>` — the exact `contentRef` the post-commit editorial pipeline already maintains. |
| `canonEventSummary` | `canonEvent:<eventId>` (`canonEventSummaryId`) | Nothing that can change: see below. |
| `publicExcerpt` | Reserved. `refKind: 'publicExcerpt'` validates; `buildVisualReplay` never produces one. | FR-O004 / ART-123's future dialogue-excerpt store. |

An `episodeScene` reference is only ever emitted when the episode is `ready` **and** the current
publication record's status is `ready` or `published` (`REPLAY_PUBLISHED_RECORD_STATUSES`) —
`withheld`, `superseded` and every pre-approval state are deliberately excluded at emission time,
not just at resolution time.

### Why `canonEventSummary`'s version is a constant

`CANON_EVENT_SUMMARY_VERSION` is always `1`. Accepted Canon events are append-only and never
edited in place (CLAUDE.md §6), so an event's `publicSummary` is immutable by construction and a
monotonic version has nothing to count. This is a **documented partial-lifecycle limitation**,
not an oversight: there is today no way to withhold an individual event summary once it has been
accepted. Building one, if it is ever needed, is ART-132's call to make — this task ships the
address shape that would carry a real version if one existed.

### Why `dialogue` steps are declared but dormant

`ReplayDialogueStep` is a full member of the `ReplayStep` union — types, validators, forbidden-field
checks, everything — and `buildVisualReplay` never produces one. This is the same "declared but
dormant" pattern the codebase already used for `motionType: 'replay'` itself before this task
existed to produce it. The published dialogue-excerpt store a `dialogue` step would address is
FR-O004 / ART-123's job to build; declaring the shape now means that task **widens** an existing
contract instead of redefining one, and a dedicated test (`visualReplay.test.ts`) asserts the
builder never emits one, so a future regression would be caught immediately.

### The resolver's version-and-status gate

`resolveReplayTexts` (`visualReplayFunctions.ts`) walks every distinct reference a replay names
(`replayTextReferences`, pure and DB-free) and resolves each independently:

- **`episodeScene`** — point-read the current `publicationRecords` row for the scene's
  `contentRef` (`by_current` index). Text is emitted **only if both halves of the gate hold**: the
  record's `version` matches the step's `publicationVersion` exactly, **and** its `status` is
  `ready` or `published`. A step whose episode has since been withheld, superseded, or re-versioned
  resolves to nothing — the reference is simply absent from the response, and the client renders a
  placeholder rather than a sentence that may no longer be true.
- **`canonEventSummary`** — looked up in the **already-published** `liveState` read model's
  `recentEvents` array, never by scanning `canonEvents` directly. The public read path consults
  published snapshots only; reaching into Canon for a sentence would mean serving text that never
  passed through the read model's own allowlist. An event that has aged out of `recentEvents`
  resolves to nothing, the same honest outcome as a withheld episode.
- **`publicExcerpt`** — unreachable today; nothing produces one.

An unresolved reference is **absent** from the response's `texts` array, never a stored or cached
placeholder string. That absence-on-mismatch behaviour is the whole mechanism FR-P004 / ART-132
will build invalidation on: this task's obligation is the guarantee that no retracted sentence can
be served until ART-132 does its own work, which is a property of the version gate above, not of
anything ART-132 has to build first.

## Client playback state machine

The backend stores *relative* durations (`durationMs`, never `startedAt`/`arriveAt`) because
playback begins whenever a viewer's browser begins it — an absolute instant stored server-side
would be a claim about a moment that has not happened yet. `replayPlayback.ts` turns those relative
durations into the absolute `PublicCharacterMotion` windows the existing renderer already consumes.
There is no second rendering path: `composeReadOnlyWorldViewModel` interpolates a synthesised
replay motion exactly as it interpolates a live one, and ART-120's ambient drift already refuses to
overlay a `replay`-typed motion.

Three phases (`ReplayPhase`): `idle`, `playing`, `finished`.

| Function | Effect |
| --- | --- |
| `beginReplay(replay, nowMs)` | The **only** function that produces `playing`. Records `replayId` and the viewer-local `playbackStartMs`. |
| `advanceReplay(replay, state, nowMs)` | `playing → finished` once `nowMs - playbackStartMs >= replay.totalDurationMs`, or immediately if the replay in state no longer matches the one passed in (superseded by a newer one). Never anything else. Returns the *same* object when nothing changes, so a caller can call it on every frame and only re-render on the one that ends playback. |
| `skipReplay(state)` | `playing → finished` unconditionally, from any point (AC#8). |
| `replayFrame(replay, state, nowMs)` | The motions and the active text reference to draw at `nowMs`, or `null` when nothing is playing. `null` the instant playback passes its end — which is what makes the return to the live ambient state (AC#2) automatic rather than a separate teardown step. |

The one transition that matters for AC#7 ("never loops or repeats automatically"): `advanceReplay`
can move `playing → finished` and nothing else. It can never move `finished → playing`. The only
function that produces `playing` is `beginReplay`, and the only callers of that are the
once-per-session auto-play effect and the viewer pressing "重播今日事件".

**No new timers.** `LiveMapPage.tsx` advances playback inside the existing `useMotionClock` rAF
tick that already drives live-motion interpolation — the same `nowMs` that animates a live walk
also decides whether replay has ended. A replay therefore costs the animation frames the map was
already spending, and `liveMapSurface.test.ts`'s "mounts no polling timer" assertion stays true
with a replay in flight.

## Session-once auto-play (AC#5)

`replaySession.ts` answers "has this replay already auto-played in this viewing session?" using
`sessionStorage`, keyed by `replayId`. This architecture has no server-side session and no viewer
identity (`docs/public-read-only-guarantee.md`) — inventing one so a replay could remember itself
would be a far larger concession than the feature is worth. A browser tab's lifetime **is** the
viewing session a viewer would recognise, and `sessionStorage` is scoped to exactly that: it clears
when the tab closes, so tomorrow's visit legitimately auto-plays again. `localStorage` would
outlive the session and wrongly suppress a replay the viewer never saw.

Because `replayId` embeds the highest replayed Canon sequence number
(`replay:<worldId>:<sequence>`), a newly completed slot produces a new id and its replay auto-plays
on its own merits — it is not suppressed by a mark left by a previous replay.

**Fails closed.** Every failure path — a throwing `setItem` (Safari private mode), no
`sessionStorage` at all (jsdom), an exhausted quota — answers `hasAutoPlayed() === true`. Auto-play
firing repeatedly because the mark that was supposed to stop the second one could not be recorded
would violate "at most once" in the wrong direction; a suppressed auto-play in an unusual
environment leaves the manual "重播今日事件" button as the way in, which is the safe failure.

`StorageLike` is a narrow two-method interface (`getItem`/`setItem`) injected rather than reading
the global directly, so the fail-closed behaviour is unit-testable without a browser.

## Time-state labelling (AC#9, FR-O014)

`timeStateLabel.ts` composes zero or three `TimeStateBadge`s, rendered by
`TimeStateBanner.tsx` as an always-present `role="status" aria-live="polite"` region. Live state
(no replay in flight) shows exactly one row — `now` — so the banner is never conditional on replay
being active; a banner that only appeared during playback would leave "is this live?" unanswered
for the rest of the session, which is the exact question RISK2-009 is about.

During playback, all three states are shown together, because the honest statement needs all
three at once: what you are watching, when it happened, and what the world is actually at.

| State | Label | Meaning |
| --- | --- | --- |
| `replay` | 重播 | What is on screen right now is a recording. |
| `earlier` | 稍早 | The Canon day and slot the recording happened in. |
| `now` | 現在 | The Canon day and slot the world is actually at. |

**Not by colour alone.** Each badge carries three independent signals: visible text (`label`), a
distinct `aria-hidden` glyph (`⟲` / `◷` / `◉`) so the shape differs even in a greyscale screenshot,
and a `data-time-state` attribute the stylesheet keys a distinct **border style** off
(solid/dashed/double, in `src/index.css`) in addition to colour. `announcement` states the whole
row as one sentence for the `aria-live` region. Strip the stylesheet and the three rows are still
distinguishable by text alone; that is a dedicated test assertion, not an inference. This follows
the non-colour-state convention `docs/accessibility.md` records for ART-116's freshness
vocabulary.

## What ART-132 still has to build

> **Status: delivered.** ART-132 landed the safety half of this list, though not in the shape
> sketched below. Rather than filtering at read time, `rebuildLiveProjection` now drops the
> `publicSummary` of every event whose Scene the safety gate refuses
> (`redactWithheldSummaries`) *before* it builds either read model — so a withheld sentence is
> never written into `recentEvents`, and the `canonEventSummary` reference that pinned it stops
> resolving through the same absence path a withheld episode already used. That placement
> matters: a read-time filter would have had to reach into `canonEvents` to learn which Scene an
> event came from (a public read touching the simulation's tables, ruled out above) and would
> have left the refused sentence in the published payload, where the last-known-good fallback
> would go on serving it. The operator-facing half is
> `overridePostGenerationSafetyLabel`, which appends to the `safetyStatusOverrides` ledger and
> runs the rebuild in the same transaction. `CANON_EVENT_SUMMARY_VERSION` is still a hardcoded
> `1` — withholding is per Scene, not per sentence. See `docs/dynamic-safety-filtering.md`.

This task ships the replay schema, its construction, and its playback mechanics — the reference
shape and the version gate that make invalidation *possible*. It deliberately does not build:

- **Publication-status change detection.** Nothing here watches for a withhold or supersede event
  and reacts to it; the resolver simply answers correctly, on every read, given whatever the
  publication record says *right now*.
- **Replay invalidation or rebuild triggered by a safety/publication status change.** The stored
  replay payload itself is not touched when an episode is withheld — only the *text resolution* for
  that step goes silent. A per-scene rebuild that drops the now-unresolvable scene entirely, or
  that proactively refreshes the whole replay, is ART-132's to build on top of the
  `invalidateReadModel` hook the `visualReplay` read-model kind already exposes.
- **Per-canon-event-summary withholding.** `CANON_EVENT_SUMMARY_VERSION` being a hardcoded `1` is
  the concrete limitation ART-132 would need to lift if an individual canon-event summary ever
  needs to be withheld independently of the event itself.

## Out of scope (unchanged from the task boundary)

Generating any new narrative content; visualizing the live *active* scene (FR-O003 / ART-122,
already built and reused here); dialogue presentation and the published excerpt store dialogue
steps would address (FR-O004 / ART-123); replay play/skip-rate metrics (ART-133's observability
lane); formal browser E2E (ART-137).
