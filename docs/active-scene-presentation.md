# Active Scene Presentation (FR-O003 / ART-122)

How the public map decides what "the thing happening now" is, where it is, who is in it, and
what happens to it when it ends.

Producer: `convex/publicRead/activeScenePresentation.ts` (pure).
Contract: `PublicActiveScene` in `convex/publicRead/publicDynamicProjection.ts`.
Consumers: the map's `ActiveScenePanel` + camera focus targets, and the text Live view.

---

## 1. The decision: a scene is a group of accepted Canon events

> A scene is the set of accepted Canon events sharing `(worldDay, timeSlot, locationId)`.

Everything below follows from that one sentence.

### Why the previous binding was wrong

Before ART-122, `PublicActiveScene` was three text fields (`title`, `summary`,
`sourceEventIds`) derived **only** from a `dailyEpisodes` row once it reached
`status === 'ready'`. That is the *narrated* artifact: one LLM-gated editorial pass per world
day. A world day has five public slots, so for roughly four fifths of every day the map had
no scene at all — which is exactly what AC#7 objected to. The contract had been bound to the
wrong producer: the narrated artifact instead of the structural one.

Accepted Canon events already carry `locationId`, `participantIds` and the slot; the arc
layer already indexes them by sequence number. So rebinding needs **no new table, no new
event type, and no new module dependency**, and it refreshes on every Canon commit (five
times a day) rather than once.

There is deliberately no `scene_started` / `scene_ended` Canon event type, and ART-122 did
not add one. A scene is *derived*, not declared, so it cannot drift out of agreement with
the events it summarises.

### Sources that were rejected, and why

| Source | Why not |
| --- | --- |
| `GroupedScene` (`convex/simulation/sceneGrouping.ts`) | The one place a scene object with location and participants already exists — and disqualified twice. `architecture/module-boundaries.json` forbids `publicRead` → `simulation`; and a scene **withheld by post-generation safety still has a `GroupedScene` row**, so reading it would publish precisely what the safety pass refused. It also carries internal reasoning fields. |
| `sceneSimulationRuns` | Raw provider output, including dialogue, which the public contract forbids outright. |

Neither is a judgement call available to a future edit. Making either reachable from
`publicRead` — by widening the boundary or any other means — reintroduces a content-leak
path that no amount of downstream filtering closes.

---

## 2. Resolution rules (AC#6)

`resolveSceneSpatials(events, { arcIdsBySequence, excludedCharacterIds })` recovers each
field by tracing the scene's events. All rules are exact, not heuristic:

| Field | Rule |
| --- | --- |
| `locationId` | The most frequent `event.locationId` among the traced events, ties broken by **ascending** `locationId`. If no event names one, the most frequent `character_location_changed.toLocationId` (where the character *arrived* — `fromLocationId` is not even present in the module's input type). If still none, **the field is omitted entirely** — never fabricated. An unplaceable scene is simply unfocusable. |
| `participantCharacterIds` | Sorted, duplicate-free union of `event.participantIds`, filtered through `excludedCharacterIds()`, so a scene never lists a dead or deactivated character the map itself refuses to draw. |
| `arcIds` | Sorted, duplicate-free union of `storyArcEventClassifications.memberships[].arcId`, joined by `sourceEventSequenceNumber`. |
| `startedAt` / `endedAt` | The `acceptedAt` of the **lowest** and **highest `sequenceNumber`** event in the traced set — Canon time, never a clock read. |
| `sceneId` | `` `${worldDay}:${timeSlot}:${locationId}` `` — fully derived, so an unchanged world re-derives an identical id and the read model's `contentHash` dedup keeps working. |

Every tie-break and every sort is there for determinism. An id list arriving in Convex row
order would change the payload's hash between two rebuilds of an unchanged world and append
a spurious version row each time.

### Title and summary

- If the traced events intersect a **published** key scene's `sourceEventIds`, the scene
  adopts that key scene's `title` and `summary`. This is a graceful upgrade: once the day's
  episode lands, the scene gains narration that has already passed the editorial
  post-generation safety classification. First match by index, so the rule stays predictable.
- Otherwise the title is synthesised as `` `${locationId} · ${timeSlot}` `` and the summary is
  the traced events' `publicSummary` values joined in Canon order.
- `publicSummary` is the **only** textual field the module can read. `metadata`, a state
  change's `reason`, memory content and knowledge content are absent from `SceneEventLike`
  altogether, so reading one is a compile error rather than a review finding. An event whose
  only human-readable text sits in a private field yields an **empty** summary — the correct,
  smaller failure.

---

## 3. Currency and degradation (AC#7, AC#8)

The current world time is the last accepted event's `(worldDay, timeSlot)` — derived inside
the resolver from the same event list the projection derives its own `worldDay` / `timeSlot`
from, so the two cannot disagree about what "now" means.

1. Partition all accepted events by `(worldDay, timeSlot, locationId)`. Events with no
   resolvable location are dropped.
2. A group is **`active`** exactly when its `(worldDay, timeSlot)` equals the current world
   time. All active groups are emitted, ordered by **descending** max `sequenceNumber`, so
   the newest activity leads.
3. **AC#8** — if no group is active, emit exactly **one** presentation: the group with the
   highest max `sequenceNumber` among all earlier slots, with `status: 'ended'` and `endedAt`
   set. The map degrades to the most recent completed scene rather than showing nothing.
4. If there is no placeable group at all (a world with no history), emit `[]`.

`endedAt` is published **only** on an `ended` scene. Publishing the latest event's
`acceptedAt` as the end of a scene still under way would assert a conclusion Canon has not
reached, and the map would render a live scene as finished.

The rebuild reports which path fired as `activeSceneMode`
(`canon` | `episode` | `degraded` | `none`) and `activeSceneCount` on
`rebuildLiveProjection`'s result, so an operator can see it without reading the payload. A
run of `degraded` means the world has stopped producing placeable events; `none` means it
never has.

---

## 4. The privacy gate (AC#4), and its boundary with ART-132

Four gates apply on this read path, all cheap and all applied here:

1. **Canon acceptance** — only accepted `canonEvents` rows are ever read. A scene withheld by
   post-generation safety never commits, so it structurally cannot appear.
2. **Field gate** — only `publicSummary`, and a `keyScene.summary` that already passed the
   editorial safety classification, can become the public `summary`. Enforced by the
   narrowness of `SceneEventLike` and pinned by a test that scans the module's code (comments
   stripped) for private field names.
3. **Episode gate** — the key-scene upgrade path still reads only `status === 'ready'`
   episodes.
4. **Whitelist gate** — `PUBLIC_DYNAMIC_FORBIDDEN_FIELDS` names `trigger`,
   `dramaticPressure`, `keyActions`, `dialogueHighlights` and `rumors` as defence in depth.
   Nothing on this path produces them; the cheapest moment to forbid a field is before
   anything can emit it.

**Deferred to FR-P004 / ART-132**, deliberately: a per-scene publication-status state
machine, operator withhold/resume of a live scene, and consulting a `publications` table on
this read path. `publicationStatus` ships as a single-member union (`'published'`) so ART-132
widens an enum the client already understands rather than introducing a field shape it has
never seen.

---

## 5. Back-compatibility: why every new field is optional

`PublicActiveScene` gained eight fields (`sceneId`, `locationId`,
`participantCharacterIds`, `arcIds`, `status`, `publicationStatus`, `startedAt`, `endedAt`).
**Every one is optional, and that is load-bearing rather than lazy.**

`assertPublicDynamicProjection` and `assertPublicRuntimeSnapshot` both validate against a
strict field allowlist that **throws** on an unrecognised shape, and both run when a *stored*
payload is read back (`serveRuntimeSnapshot` throws rather than degrading). A required field
would therefore make every row already in `publicRuntimeSnapshots`, and every last-known-good
`liveState` payload FR-O010 falls back to, fail on read — taking the public map dark with no
way to rewrite the rows.

Two tests in `runtimeSnapshot.test.ts` pin both directions: a pre-ART-122 scene shape still
validates, and a fully-populated one does too.

`RUNTIME_SNAPSHOT_SCHEMA_VERSION` is deliberately **not** bumped: optional fields do not
require it, and a bump would hard-fail every existing row.
`PUBLIC_DYNAMIC_RUNTIME_VERSION` went 2 → 3 and `LIVE_PROJECTION_SCHEMA_VERSION` 2 → 3,
because those are advisory signals to a client, not stored-row gates.

### Field naming

PRD 2.0 §14.6 calls the two text fields `publicTitle` / `publicSummary`. They are `title` /
`summary` in this contract because that is what it has published since ART-115 and what
every existing consumer reads. Renaming them would break the Live view, the runtime snapshot
and the client for **zero** privacy gain — the values are identical either way, and what
makes them public is the gate they passed, not the prefix on the key.

| PRD 2.0 §14.6 | This contract |
| --- | --- |
| `publicTitle` | `title` |
| `publicSummary` | `summary` |

---

## 6. Client behaviour

- `focusTargetsFrom` emits one `kind: 'scene'` focus target per scene whose `locationId`
  resolves to a known map footprint, centred on the same point that location's own target
  uses. A scene with no matching footprint is **silently skipped** — a target is a promise
  that pressing it shows you something, and the alternative (centring at the origin) points
  the camera at the map's corner.
- Auto-follow points at `primarySceneLocationId(scenes) ?? primaryLocationId(motions)`. The
  character-density heuristic `primaryLocationId` is **retained as a documented fallback**,
  not dead code: a world whose events name no location, and a last-known-good payload
  predating ART-122, both still reach it.
- The camera memo depends on `projection.activeScenes`, never on the animation clock's
  `nowMs`. A fresh `targets` array per tick would restart the viewport tween thirty times a
  second and make the camera judder.
- An **ended** scene links to `#episode/<worldId>/<worldDay>`, the deep link the Episode
  list, arc and character pages already use — AC#5 is satisfied by linking to what exists
  rather than by building a second recent-events surface. An active scene has no link: its
  day has not been narrated yet.
- Both interactive surfaces (`ActiveScenePanel.tsx`, `CameraControls.tsx`) are real
  `<button>` elements beside the canvas, never Pixi pointer handlers, so
  `src/components/world/` keeps the "no handler anywhere in the renderer" property ART-113
  proved. `liveMapSurface.test.ts` asserts the panel names no request API.

---

## 7. Related

- `docs/public-dynamic-projection.md` — the contract this scene lives in.
- `docs/public-runtime-snapshot.md` — the durable last-valid view.
- `docs/live-view-navigation.md` — camera and focus behaviour.
- `docs/prd-2.0-requirement-matrix.md` — FR-O003 traceability.
