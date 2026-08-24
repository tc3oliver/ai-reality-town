# Dynamic Viewing Analytics Events (FR-Q007 / ART-140, PRD 2.0 §17)

The seventeen live events, what each payload may contain, and why the default sink discards.

Related: `docs/dynamic-view-observability.md` (FR-Q001's operational metrics — a different
thing, see §6), `docs/public-read-only-guarantee.md` (the guarantee this must not weaken).

## 1. The constraint that shapes everything here

The task says to use "the existing compliant collection mechanism". **There isn't one.** ART-47
(the privacy-preserving analytics platform) is still To Do and this repo has no sink of any
kind.

More than that, the client structurally cannot invent one. `readOnlyClientBoundary` forbids
every client write primitive, and `convex/publicRead/publicReadOnlyGuarantee.test.ts` (ART-128 /
FR-O009) asserts the shipped bundle reaches exactly one Convex surface, a query. A reporting
mutation would not be an extension of that guarantee — it would be a hole in it.
`docs/dynamic-view-observability.md` reached the same conclusion for its two `client_external`
metrics and said so in as many words.

So ART-140 delivers **everything except the transport**:

| | |
|---|---|
| The contract | all seventeen events, declared once, with the payload each may carry |
| The privacy guarantee | an allowlist sanitiser at the one choke point, with adversarial tests |
| The emission points | real triggers in the live surface |
| The derivations | §18.1's two metrics, computed from the event stream |

The default sink discards, so shipping this changes **no network behaviour at all** — asserted
structurally by `analyticsSurface.test.ts`, which reads every file in the module for request,
timer and identifier APIs the way `liveMapSurface.test.ts` does for the live map.

That is the right half to build first. An event contract that is proven clean and emitted from
the right places is the expensive part, and writing the emission points at the same time as the
transport means a payload mistake ships to a collector rather than to a no-op.

## 2. The seventeen events

`live_view_opened`, `live_map_ready`, `live_map_failed`, `live_fallback_used`,
`live_character_selected`, `live_scene_selected`, `live_arc_opened`, `live_episode_opened`,
`live_camera_follow_enabled`, `live_camera_follow_disabled`, `live_zoom_used`,
`live_runtime_stale_seen`, `live_return_to_town`, `live_replay_started`,
`live_replay_completed`, `live_replay_skipped`, `live_replay_manual_triggered`.

Where each fires:

| Event | Trigger |
|---|---|
| `live_view_opened` | `LiveMapPage` mount, **before any data arrives** |
| `live_map_ready` / `live_fallback_used` | the degradation ladder's verdict (FR-O010) |
| `live_map_failed` | the ladder reporting `renderer-failed` |
| `live_character_selected` | opening a card, **or** focusing the camera on someone |
| `live_scene_selected` | focusing a scene from the panel |
| `live_arc_opened` | the homepage first screen's arc link — see §5 |
| `live_episode_opened` | the scene panel's Episode link, and the overlay's recommended entry |
| the four camera events | derived from a camera-mode transition — see §4 |
| `live_runtime_stale_seen` | the server's `delayed` or `stale` freshness verdict |
| the four replay events | the playback phase, plus the skip and manual controls |

`live_view_opened` fires before any data arrives, and that is deliberate: it is §18.1's
click-rate **denominator**, so it must fire for every viewer who reached the page including the
ones whose projection never loads. Gating it on a successful load would remove exactly the
sessions a click-rate is most interesting about, and the metric would look *better* the worse
the page performed.

A failed renderer produces both `live_map_failed` and `live_fallback_used`. They answer
different questions — "did the renderer break" and "how many sessions saw something other than
the map" — and collapsing them would make the second unanswerable for browsers that never had
WebGL in the first place.

## 3. The payload allowlist (AC#2, AC#3)

`ALLOWED_PAYLOAD_KEYS` is an **allowlist**, and that choice is the whole privacy design. A
denylist has to enumerate every private field that exists now and every one added later; these
events fire from components whose props carry a character projection, a story overlay view model
and a replay frame, so private-adjacent data is one property access away at every call site and
the first field someone forgets is the first leak. An allowlist fails the other way: an unknown
field is dropped and the event is merely less informative.

Allowed: `worldId`, `characterId`, `sceneId`, `arcId`, `locationId`, `worldDay`, `timeSlot`,
`degradationLevel`, `freshness`, `episodeNumber`, `zoomStep`, `replayId`, `sceneIndex`,
`sceneCount`, `reason`.

Note what is **not** there: no viewer id, no session id, no IP, no user agent, no free text.
`characterId` and friends are *world* identifiers already public on every Episode page, not
personal ones — and §17's click-rate cannot be computed without knowing which thing was clicked.

Three further rules, each with a reason:

- **Values must be scalars.** A nested object is refused rather than walked, because that is how
  a whole view model gets attached to an event by accident, and a recursive sanitiser would have
  to decide what is private *inside* it at every level.
- **A string longer than 64 characters is dropped, not truncated.** Every allowed key holds an
  identifier or an enum member; a longer value is, by elimination, prose. Truncating would still
  publish most of it. Every real Mistwood id fits, which the tests pin.
- **Sanitisation happens in `emitDynamicViewEvent`**, not at call sites. If it were the caller's
  job it would be a discipline; at the one choke point it is a structure, and a sink ART-47
  installs inherits it without having to know it exists.

## 4. Camera events are derived from a transition

`LiveMapView.setMode` is the single place every camera change already passes through, so the
camera events are computed from before-and-after rather than attached to each control. Two
reasons, and the second is load-bearing:

- A control added later emits correctly without anyone remembering to instrument it.
- Attaching them to controls would **double-count**. 「回到全鎮視角」 turns follow off *and*
  clears the focus, so a return button and a follow toggle each emitting their own event would
  report two interactions for one press, and §18.1's click-rate would be inflated by exactly the
  amount nobody would think to check.

**A bug this caught.** The first version detected the town view by `focusId === TOWN_TARGET_ID`.
That id names an entry in the focus *target list*; `CameraControls` maps it to `focusId: null`
before it ever reaches a camera mode, so no mode ever has it and `live_return_to_town` would
have fired **never** — silently, since a focus id matching no prefix is simply ignored. The DOM
test caught it. The town view is now `focusId === null && !follow`, which is exactly what the
button produces.

One consequence, stated rather than hidden: turning follow off while already unfocused produces
the same camera, so it counts as a return. That is the honest reading — with follow on the
camera sits on the primary *scene*, so switching it off does move the viewer to the town view.

The same DOM test caught a second wiring bug: the card-open event was emitted in `LiveMapPage`'s
handler rather than in `LiveMapView`'s wrapper, so any other caller supplying its own
`onOpenCharacterCard` would have emitted nothing.

## 5. `live_arc_opened` fires from the homepage

The live map renders the primary arc as **text** (ART-125), not as a link, so the live surface
has no arc to open. The homepage first screen's arc link (ART-129) is the only place on the
dynamic surface where a viewer can open one, so that is where the event fires. The alternative
was declaring the event unreachable, which would be true of the map and false of the product.

## 6. This is not FR-Q001

`docs/dynamic-view-observability.md` covers *operational* metrics — server-measured, read
through `inspectDynamicViewMetrics`, about whether the system is healthy. These are *product*
events about what viewers did. They are kept separate deliberately: merging them would put a
privacy surface into an operational read path and make one registry answer two questions.

The observability doc lists `activeViewerCount` with ART-136 as owner and `rendererErrorRate`
with ART-137. Neither is built by this task either, and for the same structural reason: both
need the browser to **report**, which is a client write. When ART-47 installs a sink,
`live_view_opened` and `live_map_failed` are the events those two metrics would be derived from.

## 7. Installing a sink (ART-47)

```ts
import { setAnalyticsSink } from './analytics/analyticsSink';

setAnalyticsSink((event) => {
  // `event.payload` is already sanitised. Do not re-derive it.
});
```

`emitDynamicViewEvent` swallows anything the sink throws. Analytics is the least important thing
on the page, and a viewer losing the live map because a telemetry call failed would be a far
worse defect than a missing event — the same reasoning `liveViewSession` fails open for a
remembered camera.
