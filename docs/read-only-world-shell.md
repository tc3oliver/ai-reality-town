# Read-only World Shell (FR-N002 / ART-113)

The public Dynamic Viewing surface reuses the inherited PixiJS renderer but is structurally
incapable of writing to the world. This note records how that is arranged and how it is
enforced, so a later change cannot quietly reintroduce a write path.

## What the shell is

`src/components/world/` is the whole read-only renderer:

| File | Role |
| --- | --- |
| `worldViewModel.ts` | Pure. Turns published `PublicCharacterMotion` units (PRD 2.0 §10.4) plus a `characterId -> spriteKey` binding into interpolated sprite poses. No DOM, no Pixi, no query. |
| `ReadOnlyWorld.tsx` | `Stage` -> `PixiViewport` -> `PixiStaticMap` + `Character[]`, built only from the view model. Data props only; no callback anywhere in the tree. |
| `PixiStaticMap.tsx` | Blits the Mistwood tilemap (`data/mistwood.ts`, FR-N009) and its animated sprites. |
| `Character.tsx` | One animated sprite. Plays the walk cycle for its facing while moving, holds a still frame otherwise (ART-119). |
| `CharacterStateIndicator.tsx` | The drawn speech / thought / activity marker above a sprite. Vector shapes, not emoji (ART-119). |
| `characterAnimation.ts` | Pure. `PublicAnimationState -> indicator kind -> shape list`. No Pixi import (ART-119). |
| `renderQuality.ts` | Pure. Device probe to animation-clock tier. Total over a probe that reports nothing (ART-119). |
| `spriteSheetCache.ts` | One parsed spritesheet per asset key, shared by every character drawing with it (ART-119). |
| `PixiViewport.tsx` | Drag, pinch and wheel camera. Camera state is local and never leaves the browser. |
| `cameraModel.ts` | Pure. Where the camera looks, how far it zooms, how long the move takes. No DOM, no Pixi (ART-118). |
| `CameraController.tsx` | Renders null. Applies a `CameraView` to the viewport. Data props only (ART-118). |
| `MapZoneLayer.tsx` | The eight location footprints as labelled outlines, plus an optional collision tint (ART-118). |
| `webglSupport.ts` | Pure probe: can this browser create a WebGL context (ART-118). |

The shell takes an already-read view model. It issues no query itself, which makes "public
reads never trigger generation" a property of composition rather than of this module's
discipline. Producing the motion data is FR-N003/FR-N010.

ART-118 (FR-O001) composed the shell onto a live page for the first time and added the
camera. The camera *model* lives here because it produces nothing but view state; the
buttons that choose a camera deliberately do not, because this module may not carry a
handler — see [`live-view-navigation.md`](./live-view-navigation.md).

ART-119 (FR-O002) filled the character layer. All twelve residents now render, the
interpolation clock advances between projections so movement is continuous rather than a
jump per update, and the animation states carry drawn indicators. The sprite bindings arrive
as a compile-time constant from `data/mistwoodCharacters.ts`, **not** from a query and
emphatically not from `convex/visual` — see
[`character-motion-rendering.md`](./character-motion-rendering.md) §9 for why that import
would leak private Canon data into the browser bundle. Everything the character layer added
is data props and drawn shapes, so the four properties below are unchanged.

## Why a viewer cannot write

1. **No write API is reachable.** Nothing under the public roots names `useMutation`,
   `useAction`, `useConvex`, `ConvexHttpClient`, or the retired a16z input helpers.
2. **No heartbeat.** The hooks that kept the a16z engine alive were deleted with the engine
   (ART-112) and nothing replaced them. The shell schedules no backend work.
3. **No pointer events.** The tile container, the zone layer, every character container and
   ART-119's state indicator are `eventMode: 'none'` with `interactiveChildren: false`. A
   click on the map, a zone or a sprite is not delivered to anything, so it cannot set a
   destination -- there is no handler for it to reach. Camera gestures are unaffected: the
   viewport handles its own.
4. **No control affordances.** The Interact and Freeze buttons, the chat panel and the
   conversation controls were removed with the engine and have no replacement. ART-118's
   camera controls are DOM buttons in `src/components/live/`, outside this module on
   purpose, precisely so this property survives click-to-focus.

## How it is enforced

- `architecture/module-boundaries.json` declares `clientPublic`, `clientWorldReadOnly` and
  (since ART-118) `clientLive` as modules that may depend only on `publicRead` and `shared`
  -- never Canon, Simulation, Story, Editorial or Operations -- and adds
  `readOnlyClientBoundary`, a list of world-write symbols that may not appear inside those
  roots.
- `src/components/live/liveMapSurface.test.ts` is the same kind of scan for the one client
  module that *does* carry click handlers, and additionally proves the camera chrome names no
  request API at all (ART-118 / FR-O001 AC#4).
- `npm run check:architecture` fails the build on either violation;
  `npm run test:architecture` proves the policy rejects representative violations.
- `src/components/world/readOnlyWorldSurface.test.ts` is the product-side acceptance
  evidence (FR-N002 AC#7) and also covers control affordances and the non-map fallback
  route.
- `src/components/world/readOnlyWorld.dom.test.tsx` calls the scene component and walks the
  element tree it returns: the Mistwood map reaches the tilemap component, one sprite is
  emitted per bound motion at the expected pixel pose, an unbound character draws nothing,
  and no element in the tree carries a function prop, an `on*` prop or a pointer prop. It
  runs in the `dom` Jest project because `pixi-viewport` reads `window` at module load; it
  mounts no Pixi application and renders no markup.

Server-side enforcement is separate and is owned by FR-O009: this boundary removes the
client's ability to ask for a write, not the backend's duty to refuse one. That duty is now
discharged and audited — see **`docs/public-read-only-guarantee.md`** (ART-128), which
enumerates the whole client-reachable Convex surface, proves every public mutation refuses an
unauthenticated caller before reading any row, and records the two Critical findings it
closed. ART-128 also widened this boundary's roots from the two component directories to the
whole of `src`, since the app shell and the shared buttons ship in the same bundle and were
not being checked.

## Watch-only public experience

The a16z copy invited visitors to log in, press "Interact" and talk to agents. None of that
is possible any more, so the public surface no longer offers it:

- `#help` (`src/components/public/helpRoute.ts`) is the watch-only guide: watching,
  navigating, character cards, scenes and events, episodes and replay. `helpRoute.test.ts`
  asserts both halves -- the topics are covered, and joining/controlling/chatting are never
  offered.
- The Clerk sign-in entry point returns as `OperatorEntry`, labelled as operator sign-in.
  It authenticates (ART-105's `subject` lookup for `SIMULATION_OPS_OPERATORS` still works)
  and grants no world-control capability, because the public surface has none to grant. It
  renders only when `VITE_CLERK_PUBLISHABLE_KEY` is set, since `Authenticated` /
  `Unauthenticated` throw outside a `ConvexProviderWithClerk`.
- The text Live View stays routable and linked from the homepage, the help page and the map
  itself. It is the non-map equivalent required by NFR-009 AC#3, and it must remain
  reachable until ART-135 ships its replacement. ART-118 moved it from `#live/<worldId>` to
  `<base>/live/<worldId>/text`, the map route's sibling; the legacy hash redirects to the map
  with the world identifier preserved. See
  [`live-view-navigation.md`](./live-view-navigation.md).
