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
| `Character.tsx` | One animated sprite with idle / walking / speaking / thinking states. |
| `PixiViewport.tsx` | Drag, pinch and wheel camera. Camera state is local and never leaves the browser. |

The shell takes an already-read view model. It issues no query itself, which makes "public
reads never trigger generation" a property of composition rather than of this module's
discipline. Producing the motion data is FR-N003/FR-N010; composing the shell onto a live
page is FR-O001. Until then the shell renders the map with an empty character list, which
is a valid frame.

## Why a viewer cannot write

1. **No write API is reachable.** Nothing under the public roots names `useMutation`,
   `useAction`, `useConvex`, `ConvexHttpClient`, or the retired a16z input helpers.
2. **No heartbeat.** The hooks that kept the a16z engine alive were deleted with the engine
   (ART-112) and nothing replaced them. The shell schedules no backend work.
3. **No pointer events.** The tile container and every character container are
   `eventMode: 'none'` with `interactiveChildren: false`. A click on the map or on a sprite
   is not delivered to anything, so it cannot set a destination -- there is no handler for
   it to reach. Camera gestures are unaffected: the viewport handles its own.
4. **No control affordances.** The Interact and Freeze buttons, the chat panel and the
   conversation controls were removed with the engine and have no replacement.

## How it is enforced

- `architecture/module-boundaries.json` declares `clientPublic` and `clientWorldReadOnly`
  as modules that may depend only on `publicRead` and `shared` -- never Canon, Simulation,
  Story, Editorial or Operations -- and adds `readOnlyClientBoundary`, a list of world-write
  symbols that may not appear inside those roots.
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

Server-side enforcement is separate and stays owned by FR-O009: this boundary removes the
client's ability to ask for a write, not the backend's duty to refuse one.

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
- The text Live View (`#live/<worldId>`) stays routable and linked from both the homepage
  and the help page. It is the non-map equivalent required by NFR-009 AC#3, and it must
  remain reachable until ART-135 ships its replacement.
