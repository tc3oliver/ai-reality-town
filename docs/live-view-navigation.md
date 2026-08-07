# Live View Navigation (FR-O001 / FR-O005 / ART-118)

The public live world is a draggable, zoomable 2D map of Mistwood with a camera a viewer
can point at any location or character. This note records how the camera is arranged, why
its controls are DOM buttons rather than canvas clicks, and how "no camera operation can
command the world" is enforced rather than asserted.

Prerequisite reading: [`read-only-world-shell.md`](./read-only-world-shell.md), which owns
the renderer this page composes.

## Routes

| Route | Renders |
| --- | --- |
| `<base>/live/<worldId>` | The animated map (`components/live/LiveMapPage.tsx`). |
| `<base>/live/<worldId>/text` | The text Live View, the non-map equivalent required by NFR-009 AC#3. |
| `#live/<worldId>` | Retired. Redirects to the map with the world identifier preserved. |

`<base>` is the deployment prefix (`/ai-town`, from `vite.config.ts`). Every route shape
lives in one pure module, `components/live/liveMapRoute.ts`, which takes the base as a
*parameter* rather than reading `import.meta.env.BASE_URL`: Vite inlines that expression at
build time and Jest cannot see it, so a pure module that read it directly would be
untestable. `src/App.tsx` passes it in.

The route is a real path, not a hash, which means a hard navigation or a reload has to reach
the SPA. `vercel.json` rewrites `/ai-town/live/:path*` and `/live/:path*` to `/index.html`,
**before** the existing `/ai-town/:match*` rule — that rule would otherwise rewrite
`/ai-town/live/mistwood` to a nonexistent `/live/mistwood` file and serve a 404. `npm run
check` cannot catch a missing rewrite; it shows up only as a 404 on a deployed hard
navigation, which is why the legacy hash is kept as a working (redirecting) entry point: a
rewrite misconfiguration then degrades instead of making the feature unreachable.

## The camera

`components/world/cameraModel.ts` is the whole camera, as pure functions over plain data —
no DOM, no React, no Pixi, no clock. It is unit-tested in the plain `unit` Jest project,
which is what makes the two guarantees below checkable rather than eyeballed.

| Concept | Meaning |
| --- | --- |
| `CameraView` | Where the camera looks: `centerX`, `centerY`, `scale`, `transitionMs`. |
| `FocusTarget` | Somewhere it can be pointed: the town, one of the eight locations, or a character. |
| `CameraMode` | The viewer's intent: `follow`, `focusId`, `zoomStep`. This is React state and never leaves the browser. |
| `fitScale` | The scale at which the whole map fits. Also the camera's **minimum** scale. |
| `nextCamera` | The frame a mode resolves to. Pure, so "auto-follow off ignores the primary scene" is a unit test. |

An explicit focus beats auto-follow; a focus id that no longer resolves (the character left
the projection) degrades to the town view rather than freezing on a stale point. Returning
to the town view also switches auto-follow off, otherwise the primary scene would pull the
camera straight back.

### No runaway zoom (AC#6)

`clampScale` is a total function: NaN resolves to the lower bound, ±Infinity to the bound it
runs into, and a broken pair of bounds falls back to the module constants instead of
propagating garbage into `viewport.setZoom`. `clampZoomStep` saturates the button presses
themselves so repeated clicks cannot accumulate an effect they no longer have. The viewport
is independently clamped to `[fitScale, 3]`.

This replaced an inherited defect. `PixiViewport.tsx` opened on `.setZoom(-10)` — a
*negative* scale, so the world was drawn mirrored and ten times over — and derived its
minimum scale from a hardcoded `(1.04 * screenWidth) / (worldWidth / 2)`, which on a narrow
screen exceeded the scale at which the map fits: the map could not be zoomed out far enough
to be seen whole. Both are gone; the viewport now opens on `fitWorld(true)` and derives its
clamp from `fitScale()`. Because the bounds were also configured exactly once, in `create`,
a resize left the camera clamped to bounds computed for the old viewport; `applyProps` now
recomputes them whenever the screen or world size changes.

### Reduced Motion (AC#6)

`useReducedMotion` reads `(prefers-reduced-motion: reduce)` and feeds it into the camera
model, which resolves it to a transition of **exactly zero milliseconds**. `CameraController`
reads that as *snap* — it makes two imperative calls and schedules no tween at all, rather
than running one very fast. `PixiViewport` additionally removes the `decelerate` inertia
plugin and disables wheel smoothing, so a gesture stops when the finger does.

The stylesheet's `prefers-reduced-motion` guard cannot reach any of this: a pixi-viewport
tween is a JavaScript animation on a canvas, not a CSS one.

## Why the controls are DOM buttons

AC#3 requires click-to-focus a character and an active scene. The obvious implementation —
Pixi pointer handlers on the sprites and the map — is exactly what ART-113 removed, and what
`readOnlyWorldSurface.test.ts` and `readOnlyWorld.dom.test.tsx` structurally forbid anywhere
under `src/components/world/`.

So every affordance is a real `<button>` in `components/live/CameraControls.tsx`, laid out
beside the canvas:

| Control | Effect |
| --- | --- |
| 回到全鎮視角 | Town view, auto-follow off, zoom offset reset. |
| 拉近 / 拉遠 | One zoom step, saturating at the clamp. |
| 自動跟隨主要場景 | Toggles auto-follow. `aria-pressed` announces the state. |
| One button per location | Focus that location. |
| One button per published character | Focus that character. |

Three consequences, all of them the point:

1. The renderer keeps the property ART-113 proved: no handler, no `on*` prop, no interactive
   display object. A click on the canvas still reaches nothing.
2. Every control is keyboard-reachable and screen-reader-announceable for free (NFR2-006). A
   canvas hit test is neither.
3. Every handler is a `useState` setter one component up, so the controls have no way to
   reach the network even in principle.

## How AC#4 is proven

"No camera or navigation operation sends any character control command" is an absence, and a
behavioural test cannot prove an absence — it can only show that the interactions it happened
to exercise made no request. Four independent gates instead:

- **Module boundary.** `architecture/module-boundaries.json` declares `clientLive`
  (`src/components/live`), which may depend only on `clientPublic`, `clientWorldReadOnly`,
  `clientProvider`, `clientLiveRoute`, `publicRead` and `shared` — never Canon, Simulation,
  Story or Operations. `clientLiveRoute` is the pure URL module, owned separately with
  `mayDependOn: []` so the public pages can link through it without either module depending
  on the other.
- **Write-symbol gate.** `readOnlyClientBoundary` already covers the whole of `src` (ART-128),
  so the new directory is inside it with no new enforcement code: naming `useMutation`,
  `useAction`, `useConvex` or any Convex client constructor fails `npm run check:architecture`.
- **Surface scan.** `components/live/liveMapSurface.test.ts` reads every shipped file in the
  module and asserts that `CameraControls.tsx` and `ReplayControls.tsx` name no request API at all
  (`fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, `useQuery`), that exactly
  two named `useQuery` calls exist in the whole module — the live projection and, since ART-121
  (FR-O013), the visual replay, kept as a separate failure-isolated read rather than folded into
  the projection payload — that no file mounts a polling timer, and that nothing passes a handler
  into the renderer.
- **Runtime observation.** A recorded browser pass with the DevTools protocol's network
  domain attached: dragging, wheel-zooming, focusing a location, zooming with the buttons,
  returning to the town view and toggling auto-follow produced **zero** requests. See the
  checklist below.

## Scene focus

AC#3 asks for "focus an active scene", and since ART-122 (FR-O003) `PublicActiveScene`
carries the `locationId` needed to do it. `focusTargetsFrom` emits one `kind: 'scene'` target
per scene whose `locationId` resolves to a known map footprint, centred on the same point
that location's own target uses. A scene with no matching footprint is **silently skipped**:
a focus target is a promise that pressing it shows you something, and the alternative
(centring at the origin) points the camera at the map's corner.

Scene focus is reachable from two places, both of which resolve to the same
`FocusTarget` mechanism so they cannot disagree: the 聚焦場景 list in `CameraControls.tsx`,
and the 聚焦此場景 button on each scene in `ActiveScenePanel.tsx`.

Auto-follow points at:

```ts
primarySceneLocationId(scenes) ?? primaryLocationId(motions)
```

`primarySceneLocationId` prefers an `active` scene over the `ended` one AC#8 degrades to.

`primaryLocationId(motions)` — the location holding the most characters, ties broken by
ascending `locationId` — is **retained as a documented fallback**, not dead code. Two real
cases still reach it: a world whose events name no location at all (so no scene is
placeable), and a last-known-good payload persisted before ART-122, whose scenes carry no
`locationId`. In both, guessing from character density beats pointing the camera at nothing.

The camera memo depends on `projection.activeScenes`, never on the animation clock's `nowMs`
— a fresh `targets` array per tick would restart the viewport tween thirty times a second and
make the camera judder. See `docs/active-scene-presentation.md` for how a scene is derived.

## Replay controls and the camera during playback (FR-O013, ART-121)

`ReplayControls.tsx` adds two real `<button>`s beside the camera controls, following
`CameraControls.tsx`'s pattern for the same reasons given above: keyboard reachability, no
canvas handler, and each button a `useState` setter one component up. Only one is shown at a
time — "跳過重播" while a replay is playing, "重播今日事件" otherwise — and the manual trigger stays
available in every other state, including after auto-play has already fired once this session and
including under Reduced Motion. Full design of what a replay is and how it is built lives in
[`visual-replay.md`](./visual-replay.md).

**The camera does not gain a new mode for this.** While a replay frame is active,
`LiveMapPage.tsx` passes the replay's current scene location as `primaryLocationId` in place of
the live projection's answer — playback owns the camera for exactly as long as it runs, because a
replay whose scene the viewer cannot see on screen is not a replay. The moment the frame ends
(skip or natural completion), `primaryLocationId` reverts to the live answer automatically; there
is no separate teardown path, because the substitution is a plain value swap evaluated fresh on
every render rather than a mode the camera has to be told to exit.

Replay playback advances on the **same** `useMotionClock` tick that already drives live-motion
interpolation — no second timer, no polling — so a replay in flight does not change any of the
"no request on any camera or playback interaction" guarantees described below; `advanceReplay` and
`replayFrame` are pure functions over `nowMs`, exactly like the camera model itself.

## What the map draws

Three named layers, back to front, all `eventMode: 'none'` with `interactiveChildren: false`:

| Layer | Contents |
| --- | --- |
| `tilemap-layer` | The Mistwood tilemap and its animated sprites (`data/mistwood.ts`, FR-N009). |
| `zone-layer` | `MapZoneLayer`: the eight canonical location footprints as labelled outlines, plus an optional collision-grid tint (AC#2). |
| `character-layer` | Empty in this task. |

The character layer is mounted and positioned even though it draws nothing. No public query
publishes a `characterId -> spriteKey` binding yet — that is FR-O002 (ART-119) — and a layer
that appears only once it has contents is a layer whose z-order was never tested.
`readOnlyWorld.dom.test.tsx` asserts all three, in order.

## Why the WebGL fallback is informational

Pixi 7 ships no software renderer. The canvas renderer moved to separate `@pixi/canvas-*`
packages that this project does not install, and `Application` throws outright when no WebGL
context can be created. "Fall back to Canvas" would therefore mean adopting a whole second
rendering path for a case the text Live View already covers completely — it publishes the
same world state as screen-reader-readable text and is the NFR-009 AC#3 equivalent of the map.

So `webglSupport.ts` probes for a context *before* the stage is mounted, and
`LiveMapFallback.tsx` says what happened and hands the viewer to the text view.
`LiveMapErrorBoundary` covers the cases the probe cannot predict — a context that is created
and then lost, a rejected shader compile — and, because `useQuery` throws when the deployment
returns an error, it wraps the page from *outside* in `App.tsx`. A boundary below the read
would leave a blank page instead of a route that works.

A general staleness and degradation ladder is FR-O010 / ART-127. What this task owes is
narrower and absolute: never a blank page.

## Two defects this task closed

Neither was reachable before, because nothing had ever mounted the renderer on a route.

1. **`.setZoom(-10)`** (see *No runaway zoom* above): the map opened mirrored and 10x.
2. **Unmount crashed the app.** `pixi-viewport`'s `InputManager.destroy()` unconditionally
   dereferences `viewport.options.events.domElement`, but `@pixi/react`'s `Stage` destroys
   the whole `Application` in its own `componentWillUnmount` — which React runs *before* it
   removes children — leaving that null. Navigating away from the map threw
   `Cannot read properties of null (reading 'removeEventListener')` from inside React's
   commit phase, where no error boundary can catch it, and blanked the entire app.
   `detachViewportFromDom` restores a detached stub so the upstream `removeEventListener` is
   a no-op instead of a crash; the real listener is already gone with the destroyed
   renderer's canvas, and the rest of `Viewport.destroy()` still runs.

## Verification

`npm run check` covers the architecture boundaries, the surface scans, the camera model, the
route module, the accessibility suite and the build.

Automated browser E2E is **not** part of this task. The repository has no Playwright or
Cypress, and ART-137 (FR-Q006, "Build the dynamic live browser E2E suite") owns that
deliverable; adding a second, unowned browser-test framework here would duplicate its scope.
What substitutes is the structural evidence above plus a recorded manual browser pass. The
results of that pass are in the ART-118 implementation notes, including the two items it
could not settle: the automation browser throttled `requestAnimationFrame` to ~2 fps and
refused `Page.captureScreenshot`, so frame-level transition timing was checked at the
plugin level rather than frame by frame, and live character data could not be exercised
because the Convex deployment was disabled at the time.
