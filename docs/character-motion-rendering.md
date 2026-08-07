# Character motion and animation rendering (FR-O002 / ART-119)

How a published `PublicCharacterMotion` becomes a sprite walking across the live
map, and what is guaranteed about that translation.

- Pure view model: `src/components/world/worldViewModel.ts`
- Animation clock: `src/components/live/useMotionClock.ts`
- Quality tiers: `src/components/world/renderQuality.ts`
- Indicator vocabulary: `src/components/world/characterAnimation.ts`,
  `src/components/world/CharacterStateIndicator.tsx`
- Sprite resolution: `src/components/live/spriteAssets.ts`,
  `src/components/live/useSpriteAssets.ts`,
  `src/components/world/spriteSheetCache.ts`
- Shared roster and palette: `data/mistwoodCharacters.ts`, `data/spritePalette.ts`,
  `data/spritesheets/catalogue.ts`
- Producer side: [`public-dynamic-projection.md`](./public-dynamic-projection.md),
  [`visual-runtime-trajectory-planner.md`](./visual-runtime-trajectory-planner.md)

---

## 1. The interpolation contract

The projection publishes, per character, a single motion unit: `from`, `to`,
`startedAt`, `arriveAt`, `direction`, `animationState`, `motionType`,
`semanticLocationId` and `motionSequence`. The client owns exactly one decision
from it — where to draw the sprite *right now*:

```
progress   = clamp((nowMs - startedAt) / (arriveAt - startedAt), 0, 1)
tile       = from + (to - from) * progress
pixel      = tile * tileDim
```

Three properties follow, and each is a test:

- **Never extrapolates.** A motion whose window has not opened sits at `from`; a
  finished or zero-length one sits at `to`. A stale projection can park a
  character at a published position but cannot walk it off the map while the
  backend is down.
- **Stateless per frame.** Each frame is computed from `(motion, nowMs)` afresh,
  never from the previous frame, so nothing accumulates and no tick rate can
  drift the result.
- **Latest unit wins.** `motionSequence` decides, not array order, so a
  projection carrying an in-flight walk plus the idle that follows it renders one
  character rather than two.

`interpolatedTile(motion, nowMs)` and `isWithinSegment(motion, point)` are
exported for exactly this: the second is the predicate that proves the first
never leaves the published route.

## 2. Tile centres, not tile corners

The Visual Runtime places a character standing on tile `(tx, ty)` at its **centre**,
`(tx + 0.5, ty + 0.5)`. Positions are therefore half-integers, and the renderer's
clamp is bounded by the map's tile *count*, not its last tile index: on a 48-wide
map, `x = 47.5` is legal and clamping to `47` would shove every character in the
last column half a tile inwards. (ART-119 fixed exactly that off-by-half-tile
bug; `worldViewModel.test.ts` pins it.)

Pixels are the renderer's business alone. Nothing upstream of
`composeReadOnlyWorldViewModel` knows the tile dimension.

## 3. Direction to sprite frames

```
PublicDirection  ->  orientation degrees  ->  sheet animation
right                0                       'right'
down                 90                      'down'
left                 180                     'left'
up                   270                     'up'
```

`Character.tsx` reads `['right', 'down', 'left', 'up'][orientation / 90]` and
plays that animation while `isMoving` — which is `animationState === 'walking'`
**and** `progress < 1`, so an arrived walk stops rather than moonwalking on a
stale snapshot.

Each of `data/spritesheets/f1.ts`–`f8.ts` holds exactly four cycles of three
frames. There is no idle cycle, no blink, no gesture, no talk frame. A stationary
character therefore holds frame 0 of its facing, which is the "clear static
standby state" AC#3 asks for and what a still sprite has always meant in this art
style.

## 4. The five animation states: two live, three dormant

`convex/visualRuntime/motion.ts` declares `AnimationState = 'idle' | 'walking'`
and nothing in the runtime can produce anything else — the two producers
(`seedBootstrap.ts`, `visualSyncPlanner.ts`) emit only those. The published
union is wider:

| State | Produced today? | Indicator | Owner |
| --- | --- | --- | --- |
| `idle` | yes | none | — |
| `walking` | yes | none | — |
| `speaking` | no | speech bubble | FR-O004 / ART-123 |
| `thinking` | no | thought cloud | FR-O004 / ART-123 |
| `activity` | no | four-point star | FR-O004 / ART-123 |

ART-119 ships the *rendering* for all five, driven by fixtures. This follows the
precedent `PUBLIC_MOTION_TYPES` already set by declaring `ambient` (FR-O011) and
`replay` (FR-O013) before anything produced them: the client contract is widened
once, by the task that owns the rendering, rather than redefined later by the
task that owns the content.

`indicatorFor` is a total `Record` over the union rather than a `switch` with a
default, so adding a sixth state is a compile error here instead of a state that
silently renders as nothing.

## 5. Why the indicators are vector shapes

The inherited renderer drew `💬` and `💭` as Pixi `Text`. Two problems:

- **Emoji are OS fonts.** This repo bundles no emoji font, so the same world
  state renders as a colour emoji on macOS, a flat monochrome glyph on most
  Linux, and tofu where neither exists.
- **There are no sprite frames for it.** The sheets carry four walk cycles and
  nothing else, and PRD 2.0 §6 forbids introducing new art in v1.

So the indicators are drawn with `Graphics`. `characterAnimation.ts` describes
each as a pure list of `IndicatorPrimitive` shapes and
`CharacterStateIndicator.tsx` replays that list — which is what makes "the three
are visually distinct" a unit test over data rather than a screenshot review.

| Kind | Shapes | Why it reads apart |
| --- | --- | --- |
| `speech` | rounded rect + tail triangle + three dots | straight edges, a tail pointing at the speaker |
| `thought` | three overlapping circles + two trailing circles | round everywhere speech is straight |
| `activity` | one four-point star | sharp points, warmer colour |

The vocabularies are disjoint on purpose: a viewer reads the silhouette of a 32px
marker before the hue, and a colour-blind viewer may not read the hue at all.

## 6. The animation clock and quality tiers

Before ART-119 nothing advanced `nowMs`, so the map was a still frame that
updated only when a new projection arrived — a character *teleported* to wherever
the next projection put it. `useMotionClock` is the fix: a
`requestAnimationFrame` loop that reads `Date.now()` and gates how often that
value is published.

| Tier | Hz | Interval |
| --- | --- | --- |
| `high` | 60 | ~16.7ms |
| `medium` (default) | 30 | ~33.3ms |
| `low` | 10 | 100ms |

`detectRenderQualityTier` is total: `undefined`, `NaN`, zero and negative probe
values all resolve to `medium`, because `deviceMemory` is Chromium-only and
`hardwareConcurrency` can be absent or privacy-fuzzed. Tuning the thresholds
against real device data is FR-Q005 / ART-136; ART-119 ships the mechanism only.

### The invariant this exists to protect

> **No tick rate can change `semanticLocationId`.** Semantic identity comes from
> the projection; only pixel position comes from the clock.

`motionQualityTiers.test.ts` samples the same real multi-hop fixture on 60, 30,
10 and 1 Hz grids and asserts, in every tier: the semantic location, animation
state and motion type are identical at every sample; the final position equals
the published destination *exactly*; and no sample ever leaves the published
movement segment. A coarse grid skips frames, never the route.

The clock takes **no network action of any kind** — no query, no refetch, no
subscription. That is asserted structurally (`liveMapSurface.test.ts`) and at
runtime over sixty frames (`motionClock.dom.test.tsx`), and it is what keeps
"public reads never trigger generation" true while the map animates continuously.
For the same reason the module mounts no repeating timer: `requestAnimationFrame`
is the only driver, and where it is absent the clock simply never advances,
degrading to the pre-ART-119 behaviour (correct, merely not smooth).

## 7. Reduced Motion

Reduced Motion **does not stop character interpolation**. Freezing it would park
a walking character mid-street and then snap it to its destination on the next
projection — which is precisely the teleport AC#6 forbids. What Reduced Motion
does instead:

- collapses camera transitions to zero milliseconds (a snap, not a fast
  animation) — see `cameraModel.ts`;
- holds the state indicators static, which they already are by construction;
- may cap the quality tier at `medium` via `cappedTier`.

## 8. Sprite resolution and palette variants

Twelve residents, eight inherited sprites. Four characters reuse a base sprite
through a palette variant — see
[`character-visual-binding.md`](./character-visual-binding.md) for the colour
model. In the browser:

- **Base sprites resolve synchronously**: the inherited texture plus the
  committed frame data, both compile-time constants. Eight of twelve are on
  screen on the first render.
- **Palette variants resolve asynchronously**: the texture is drawn into an
  offscreen canvas, `applyPaletteVariant` is applied via
  `getImageData`/`putImageData`, and the result is exported with `toDataURL`.

The **whole** 384x256 texture is recoloured, never a cropped 96x128 cell. The
frame rectangles committed in `f1.ts`–`f8.ts` are absolute in the shared image
(`f5`'s `down` frame sits at y=128), so cropping would invalidate every one of
them and force a second, variant-only coordinate set to be maintained. The cost
is that a variant's HSV window can incidentally match pixels in another sprite's
cell of the copy — harmless, because a variant texture is only ever drawn with
its own base sprite's frames.

Where no canvas or no 2D context exists, or the decode fails, a variant resolves
to the plain base texture. Two characters then look alike, which is a cosmetic
loss; failing to resolve would drop a resident off the map, which is an AC#1
failure. Legibility loses to presence.

`spriteSheetCache.ts` keys parsed sheets on the **asset key**, not the texture
URL: all eight base sprites are cut from one URL and differ only in frame data,
so a URL key would hand `f3` the frames of `f1`.

## 9. Why the sprite roster lives in `data/`

`src/components/` must never depend on `convex/visual`.
`convex/visual/mistwoodVisualBindings.ts` imports `convex/canon/mistwoodSeed.ts`,
which carries `privateProfile`, `privateGoal`, `fear` and `secretContents` for
all twelve residents; any import path from a client module into `visual` is
therefore also a path to every resident's private data, one bundler decision away
from the browser. Neither `clientWorldReadOnly` nor `clientLive` lists `visual`
in `mayDependOn`, and that must not be widened.

A public query would also be the wrong shape: sprite assignment is deterministic
per deploy (FR-N004 AC#2), so a per-viewer round trip buys nothing.

`data/` is owned by no boundary module, which is how
`convex/visual/mistwoodLocationBindings.ts` already reads `data/mistwood.ts`. So
ART-119 moved the sprite catalogue, the palette engine and the public roster
there; `convex/visual/` re-exports all of it, so no backend caller changed.

Because `data/` sits outside both the module graph *and* the
`readOnlyClientBoundary` scan, `data/dataBoundary.test.ts` polices it explicitly:
no shipped file there may import a backend module, name a write API, or name a
private Canon field. `data/mistwoodCharacters.test.ts` pins the mirrored roster
against the authored bindings so the two cannot drift.

## 10. Known deviations

Two pre-existing architectural facts, documented rather than fixed here.

1. **Straight-line interpolation ignores the planned route.** The planner's
   `waypoints` are deliberately never published — they would leak the shape of
   the collision layer — so the client interpolates the chord between `from` and
   `to`, while `arriveAt` was computed from the *actual* path length. A character
   walking around a building may visually drift across its outline. Client-side
   re-pathing is not available: `visualRuntime` is not a client dependency, by
   design.
2. **`VISUAL_RUNTIME_NO_PATH` is a real teleport, at the backend.** An unroutable
   character is placed directly at its destination with
   `startedAt === arriveAt`. The client cannot distinguish that from a
   Canon-permitted special movement, and renders it as an instant arrival. This
   is a backend degradation already counted by ART-117's problem summary, not
   something the renderer can solve.

## 11. Tests

| Concern | File |
| --- | --- |
| Interpolation, clamping, direction, state forwarding | `src/components/world/worldViewModel.test.ts` |
| Quality tiers vs. semantic state (AC#7), fixtures end to end | `src/components/world/motionQualityTiers.test.ts` |
| Indicator mapping and shape distinctness | `src/components/world/characterAnimation.test.ts` |
| Indicator drawing and non-interactivity | `src/components/world/characterStateIndicator.dom.test.tsx` |
| Tier detection totality | `src/components/world/renderQuality.test.ts` |
| Clock gating, teardown, no network | `src/components/live/motionClock.dom.test.tsx` |
| Sprite resolution and every degradation path | `src/components/live/spriteAssets.dom.test.tsx` |
| Scene composition, all twelve residents | `src/components/world/readOnlyWorld.dom.test.tsx` |
| Roster drift and asset-key injectivity | `data/mistwoodCharacters.test.ts` |
| The `data/` boundary itself | `data/dataBoundary.test.ts` |
| No write path, no handler, no request | `src/components/world/readOnlyWorldSurface.test.ts`, `src/components/live/liveMapSurface.test.ts` |

Formal browser E2E is ART-137; ART-119 verified in a browser by hand, following
ART-118's precedent.
