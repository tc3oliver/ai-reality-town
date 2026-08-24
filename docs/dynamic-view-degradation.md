# Dynamic View Degradation Ladder (FR-O010 / ART-127)

What a viewer sees when the live map cannot be drawn the usual way, why it is a staircase
rather than a cliff, and which of its guarantees are machine-checked.

Related: `docs/public-dynamic-projection.md` (rung 1's data), `docs/live-responsive-layout.md`
(the stage contract every rung preserves), `docs/accessibility.md`,
`docs/dynamic-view-e2e.md` (the browser harness that injects the fault).

## 1. What was actually missing

Two of the four rungs shipped long ago, one was **built but never wired**, and one did not
exist:

| Rung | Before ART-127 |
|---|---|
| `stream` — animated map on the live projection | Shipped (ART-118 / ART-119) |
| `snapshot` — animated map on the last valid runtime snapshot | **Published since ART-116 and never read by the live map.** Its only reader was the homepage, and only for the freshness chip |
| `static-map` — floor plan with last known positions | Did not exist |
| `informational` — location / character / scene text | `LiveMapFallback` existed, but as a **cliff**: one false `webglSupported` dropped the viewer straight to a signpost page and skipped both middle rungs |

So the work was not adding a degradation switch. It was turning the cliff into a staircase:
wiring rung 2 up, building rung 3, putting one pure function in charge of choosing, and
labelling every rung.

## 2. The decision

`resolveDegradationLevel` in `src/components/live/degradationLadder.ts`. First-match-wins:

```
loading                         → stream   (a pending read is not a degraded state)
renderer ok  + live positions   → stream
renderer ok  + snapshot         → snapshot
floor plan   + any positions    → static-map
otherwise                       → informational
```

`source` (`stream` | `snapshot` | `none`) says which data the rung draws, and `reason` says why
the viewer is not one rung higher. The reason is reported separately from the level because two
different causes produce `static-map` — a browser with no WebGL, and a renderer that died —
and they are different things to tell a person: one is fixable by the viewer, one is not.
`LiveMapFallback` already drew that distinction and was right to.

An unknown future condition degrades *downward*: the ordering is asserted as a property, not as
a table of cases. A test walks every capability, removes it, and requires the verdict to move
to a strictly higher index in `DEGRADATION_LEVELS`.

## 3. Why the level is derived and never latched — this is what makes AC#5 free

The level is a pure function of conditions already read on every render. When the projection
comes back, the very next render is `stream` again. There is **no recovery mechanism, no
polling, no timer and no retry**, because there is nothing to recover from.

A `useState('degraded')` latch would have needed a second mechanism to decide when to try
climbing back — and that mechanism is exactly the retry loop AC#4 exists to forbid.

The one thing that genuinely must latch is a renderer that **threw**: re-mounting a renderer
that just crashed is a crash loop, and a crash loop against a live deployment is how a
rendering fault becomes load on everything behind it. That latch lives in
`RendererErrorBoundary` and it latches the **renderer**, not the level. The rungs below keep
rising and falling with the data, and the latch clears when the map identity changes — never
on a clock.

## 4. Why the boundary moved inside

`LiveMapErrorBoundary` wraps the whole route, so a renderer throw unmounted the page *and its
four public reads*. That was right when the only answer was "show a different page"; it makes
the middle rungs unreachable, because rung 3 needs the **data** to survive the renderer.

So the ladder adds `RendererErrorBoundary` around the Pixi stage alone. A throw there takes out
the canvas and nothing else: the queries stay subscribed, the view model stays composed, and
the page swaps in the plan on the next render. `LiveMapErrorBoundary` stays where it is as the
outer net for a failure in the page itself — a read that throws, a view model that cannot be
built — where there really is nothing left to degrade to.

## 5. Rung 3 is DOM, not a frozen canvas

"Static map with last known positions" cannot mean "the Pixi stage, stopped". The rung exists
precisely for the case where Pixi cannot run, so a frozen canvas is unreachable in the only
situation that would need it.

`StaticMapView` draws SVG from `mistwoodLocationFootprints`, with a dot per character. Two
consequences worth having anyway:

- It is real DOM, so a screen reader can read it. The animated map is a `<canvas>` and is
  opaque to assistive technology by nature — which is why ART-113 put every control in the DOM
  beside it. Here the **content** is in the DOM too.
- It keeps the spatial information a text list throws away. Rung 3 exists to be more than
  rung 4.

**One source of positions.** The plan is projected from the same `ReadOnlyWorldViewModel` the
Pixi renderer consumes and the same `FocusTarget[]` the camera controls are built from. Nothing
re-derives a position or re-looks-up a name, so the two surfaces are structurally incapable of
disagreeing about who is where — which is the obvious failure of a second rendering path, and
the worst kind, because it only shows in the degraded state nobody looks at.

A consequence, stated rather than hidden: `focusTargetsFrom` labels a character with their
**id**, because the dynamic projection publishes no display name. The plan therefore does too.
That agreement is the property worth having; giving the plan a nicer name source than the
camera controls have would be two naming paths again.

## 6. The stage keeps its shape at every rung

`.live-map-canvas` stays the first of `.live-stage`'s exactly-two children whatever is inside
it. The responsive contract ART-126 proved — one column with the map leading below 64rem, two
above, visual order equal to DOM order at both — is a property of the stage's shape, and a
degraded rung has no business changing how the page lays out. Only the content of that box
changes, and `data-rung` on it is what lets the stylesheet relax the fixed height: the canvas
clamp is right for something that scales to its container and would crop a plan plus a roster.

## 7. AC#4, from three directions

"Renderer failure never triggers an LLM retry" was true before this task and nothing pinned it.

1. **Structural, whole-module.** `liveMapSurface.test.ts` reads every shipped file in
   `src/components/live/` for write and request APIs. The new files are covered by that sweep
   automatically. It also enumerates the reads by name — which is why adding rung 2's query was
   a red test requiring a deliberate, reviewed edit, not a silent seventh subscription.
2. **The query set cannot depend on the level.** The naive implementation re-subscribes on
   degradation — a `key`, a conditional read, a `'skip'` that flips with the rung. Any of those
   turns a renderer fault into query churn against a deployment already having a bad time. A
   test extracts every `useQuery(...)` call from `LiveMapPage.tsx` by balancing parentheses and
   requires none of them to mention the ladder.
3. **Runtime.** The mounted failure path is asserted to call no `fetch`, `setTimeout` or
   `setInterval`, and the browser suite watches the network for three seconds after the
   renderer is denied — long enough for a retry loop to show itself.

## 8. AC#2 — degradation does not reach editorial content

The ladder's inputs contain nothing from the Episode, arc or timeline models, and it is
consumed only by the live route. The browser suite makes the stronger, observable claim: it
loads an Episode page with WebGL denied and again with it working, and requires the rendered
text to be **identical**.

## 9. Fault injection in a real browser

jsdom has no WebGL either, so every DOM-level assertion about "what happens when WebGL is
missing" is made in an environment where it was never present. Only a real engine can be given
a GPU and then have it taken away.

`e2e/dynamicView.spec.ts` overrides `HTMLCanvasElement.prototype.getContext` via
`page.addInitScript`, before any application code runs, returning `null` for `webgl`/`webgl2`
and passing everything else through — 2D stays working, because denying it too would turn "no
WebGL" into "no canvas at all", a different and much rarer fault.

**No product test hook.** There is no `?degrade=` parameter and no flag in the shipped bundle.
A query-string switch would have been easier and would have tested the switch.

## 10. Known limits

- **The last-updated label does not tick on rung 4.** `useMotionClock` parks when there is
  nothing to animate, and the ladder deliberately adds no second timer —
  `liveMapSurface.test.ts` asserts this module mounts no repeating timer at all. The age is
  therefore accurate at mount and then frozen on the rung where nothing is moving anyway. Rungs
  1–3 all have motions, so the clock runs there.
- **Rung 2 has no world clock.** The runtime snapshot carries positions and scenes but not
  `worldDay` / `timeSlot`, so the day/night wash and the clock chips are absent there. The
  composers already tolerate that; adding the fields to the snapshot contract is a schema change
  this task did not need.
- **Not covered:** a GPU that loses its context mid-session, as against one that never had it.
  The boundary handles a throw from any cause, and the browser suite injects the "never had it"
  case; simulating a mid-session context loss needs a WebGL extension the headless profile does
  not expose.
