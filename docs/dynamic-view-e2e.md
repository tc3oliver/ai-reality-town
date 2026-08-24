# Dynamic view browser E2E

**Requirement:** FR-Q006 (PRD 2.0 §12 Epic Q, realizes §21.3) · **Task:** ART-137

PRD 2.0 §22 makes browser evidence on desktop **and** mobile a release gate. This is also the
missing half of two earlier tasks: ART-126 (responsive layout) and ART-130 (live ↔ editorial
navigation) each asserted everything a DOM and a stylesheet can settle and each recorded
explicitly that real layout in a real engine was **not** covered, because no headless browser ran
in this repo. This is that browser.

## Running it

```bash
npm run e2e          # build the fixture bundle, then run both projects
npm run build:e2e    # just the bundle -> dist-e2e/
npm run test:e2e     # just the run (expects dist-e2e/ to exist and be current)
```

`npm run e2e` is the entry point, and it exists because running the tests against a stale
`dist-e2e` is the single easiest way to waste an hour: the symptom is a product defect that is
really a bundle from before your last edit.

CI runs it as a separate `browser-e2e` job, Chromium only — the suite is about this product's
behaviour, not about cross-browser rendering, and three engines would triple the gate's cost for
no extra coverage of it. Traces are uploaded on failure.

## The fixture, and what is NOT faked

Only the **transport** is replaced. Every component, hook, view model, camera and renderer in a
run is the shipped one; that is the whole point of browser evidence.

`VITE_E2E_FIXTURE=1` swaps `ConvexClientProvider`'s client for `src/e2e/fixtureConvexClient.ts`,
which answers the four public queries from `src/e2e/fixtureWorld.ts`. A live deployment cannot
serve as the fixture: its characters are wherever the last accepted slot put them, its replay
exists or does not, and its safety gate may have withheld the scene the spec was going to assert
on. A suite written against that is either flaky or asserts nothing specific enough to catch a
regression.

### Containment

A test harness that shipped would be worse than any defect this suite catches — a public
deployment serving invented characters, or refusing every write the operator console needs. So
`fixtureIsolation.test.ts` pins four things: exactly one file imports `src/e2e/`, that import is
inside the gate's true branch, the gate is an exact match on a **build-time env literal** (a check
on `window` or `location` would not constant-fold and the branch would survive into production),
and `build:e2e` is the only script that sets the flag and writes to its own `--outDir`.

### The fixture is a real payload, not a plausible one

`fixtureWorld.test.ts` runs each payload through the **production** assertion — the same
`assertPublicDynamicProjection` / `assertVisualReplay` the server applies when it reads a stored
payload back.

That test exists because the first version of the replay fixture invented
`{ motions, summaryRef }` for a scene. Nothing rejected it, nothing played it, and three browser
criteria failed in ways that looked like product defects. The second thing it caught was
`participantCharacterIds` needing to be sorted. Both are the same class of mistake, and both are
now impossible to reintroduce without a fast unit test failing first.

It also pins the ART-107 §8 fixture rule: every character id comes from
`MISTWOOD_CHARACTER_VISUALS` and every location id from `mistwoodLocationFootprints`, asserted
rather than trusted.

## How each criterion is settled

The map is a `<canvas>`, opaque to the DOM and to assistive technology. That is not an obstacle to
work around — it is the reason ART-113 put every affordance in the DOM beside the canvas. So the
criteria are settled the way a **viewer** settles them, which is also the way a screen-reader user
does.

| AC | Settled by | What it does not prove |
| --- | --- | --- |
| #1 map loads | the canvas element exists and is >100px, and no WebGL-fallback copy is present | — |
| #2 characters visible | one named focus control per published character (12), plus a non-uniform canvas screenshot | that a specific sprite is at a specific pixel |
| #3 moves smoothly | three successive canvas screenshots, each differing from the last | *which* pixels moved |
| #4 states distinguishable | four residents carrying four `animationState`s give four distinct card readings, **in words** | that the Pixi indicator glyphs differ |
| #5 card opens | a real click; card visible, focused, and focus returns to the trigger on close | — |
| #6 scene focus | `aria-pressed` flips, summary text present, Episode link on the ended scene | that the camera visibly moved |
| #7 pan/zoom/town | canvas pixels change per action; `aria-pressed` reports auto-follow off | — |
| #8 mobile | measured geometry: stacked and map-first on Pixel 5, side-by-side on desktop, no horizontal overflow, every `.public-tap` ≥44px **as laid out** | — |
| #9 replay | auto-play observed on a fresh context, skip returns to ambient, it does not restart, manual replay works | that it ends *naturally* — see below |
| #10 no mutation | the fixture transport throws on any non-query **and** the browser's own network log shows no non-GET and no off-site request | — |
| #11 no LLM increase | no request to anything but the page's own static assets | — |

Two deliberate limits, stated rather than implied:

- **AC#3** proves the canvas changes *continuously* while a motion is in flight, which is what
  distinguishes an interpolated walk from a teleport. It does not identify the moving pixels.
- **AC#9** does not wait for playback to end naturally. A real scene is 20–60s by contract
  (`REPLAY_SCENE_MIN_MS`), so that would cost forty seconds of wall clock per run to re-prove
  `advanceReplay`, a pure function `replayPlayback.test.ts` already covers exhaustively. What the
  browser adds is that auto-play *fires*, that skipping returns to ambient, and that it does not
  restart — none of which a pure test can show.

### Why AC#10/#11 are observed twice

A guarantee checked only by the thing being replaced is not a guarantee. The fixture transport
records and **throws** on any non-query call, so a mutation fails the run at the moment it is
attempted. The spec *also* watches the browser's own network layer, which the client cannot
influence — a bare `fetch`, or a second client constructed anywhere, shows up there and nowhere
else.

The E2E build sets `VITE_CLERK_PUBLISHABLE_KEY=` empty for the same reason. With a key present the
bundle loads `clerk.com`, and a third-party request would make "the page talked to nothing"
unassertable. That is not a workaround: a public viewer watching a world has no business
contacting an auth provider, and the empty key is the shipped behaviour for a deployment that has
not enabled operator auth.

## Three failures worth remembering

Each cost real time and each is now guarded:

1. **`page.goto('/live/mistwood')` dropped the deploy prefix.** Playwright resolves a goto
   argument with `new URL`, so an absolute path discards the baseURL's path segment. Every test
   404'd and reported "element(s) not found" for `<main>` — a symptom that looks nothing like the
   cause. `baseURL` now carries the origin only, and the spec carries `/ai-town` explicitly.
2. **The replay auto-played over the other tests.** Every test gets a fresh context, so the
   once-per-tab mark is unconsumed and the first seconds run against *replayed* frames. During
   playback the page substitutes the replay's motions for the live ones, so a character not in the
   current scene has no motion and their card reads 「—」 — which made two of AC#4's four states
   identical and looked like a product defect. `openLive` now skips the replay, which is a real
   viewer action (FR-O013 AC#8).
3. **`nth(0..3)` picked arbitrary residents.** The camera chrome orders its focus targets its own
   way. AC#4 now selects **by character id**, and `fixtureWorld.test.ts` pins which four carry the
   four states.

## What this does not cover

- Performance and device quality tiers — **ART-136** (explicitly out of scope here).
- Security probing — **ART-128**, which owns the read-only guarantee's adversarial half.
- The twelve-character *public acceptance environment*. AC#2's second clause is about a real
  deployment; this suite proves the surface offers all twelve when the projection publishes
  twelve, which is the part a fixture can honestly establish. The deployment-side check belongs
  to the **ART-138** release gate.
