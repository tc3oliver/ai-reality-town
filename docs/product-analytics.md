# Product analytics (PRD 1.0 §15 / §16.1, ART-47)

How a click on a public page becomes a number in `getProductAnalyticsMetrics`, what is deliberately
not collected on the way, and which of the PRD's metrics this can and cannot honestly report.

ART-140 (FR-Q007) built the seventeen `live_*` events, the payload allowlist and the emission
points, and shipped them into a sink that discarded — because no transport existed and the client
could not invent one. This task builds the transport, adds §15's sixteen product events, persists
what they produce, and computes §16.1 over it.

---

## 1. The chain

```
 a click / an effect
   └─ src/analytics/productEvents.ts        typed emitters; a call site cannot omit a subject field
      └─ src/analytics/analyticsSink.ts     THE choke point — sanitises, then hands to the sink
         └─ convex/shared/analyticsContract.ts   the allowlist and the sanitiser (one copy)
            └─ src/analytics/analyticsQueue.ts   dedupe by logical measurement, batch, hold in flight
               └─ src/components/analytics/transportCore.ts   debounce, retry, backoff
                  └─ useAnalyticsIngest.ts            the one exempted `useMutation`
                     └─ convex/analytics/ingestFunctions.ts   re-sanitises, re-derives, resolves
                        └─ analyticsEvents / analyticsSessions / analyticsViewers
                           └─ convex/analytics/metrics.ts     §16.1, computed
                              └─ convex/operations/productAnalyticsFunctions.ts   operator-gated read
```

Everything left of `useAnalyticsIngest` is pure and directly testable. `AnalyticsTransport.tsx`
holds only the clock, the timer and the mutation binding.

---

## 2. The privacy boundary

### One allowlist, enforced three times

`ALLOWED_PAYLOAD_KEYS` and `sanitizeAnalyticsPayload` live in `convex/shared/analyticsContract.ts`,
which both the browser and the ingest import. Not a client filter plus a server filter: **one
function**, applied

1. at the browser's single emitter, so a mistake is cheap to catch in a DOM test,
2. at the Convex argument validator, which refuses a malformed payload before any handler runs,
3. at the ingest, because anyone holding the deployment URL can post whatever they like and none of
   it went near the emitter.

Two allowlists would drift, and the drift would be silent — both halves keep producing well-formed
payloads while one starts admitting a field the other drops, and the field that gets through is by
construction one nobody was thinking about.

### What is never collected

No IP, no user agent, no account identity, no referrer, no URL, no free-form narrative text, no
private character data, no prompt, no model configuration, no secret. Enforced three ways:

- **The allowlist** is twenty short scalar keys. A field outside it is dropped whatever it is
  called — the mechanism is membership, not a list of suspicious names.
- **`analyticsWriteBoundary.forbiddenPayloadKeys`** fails the BUILD if `convex/analytics` so much as
  names one of them as a field. Prose explaining why a user agent is never collected still passes;
  the check is anchored on a field position.
- **`analyticsPrivacy.test.ts`** hands the sanitiser a payload carrying every one of them, in the
  shapes they actually appear in around a call site, and requires the output to be clean.

Nested objects and arrays are refused rather than walked. A nested value is how a whole view model
gets attached to an event by accident, and a recursive sanitiser would then have to decide what is
private *inside* it — the judgement this design exists to avoid making at every call site.

An over-long string is **dropped, not truncated**. Every allowed key holds an identifier or a
closed-vocabulary member, so a value past 64 characters is by elimination something that is not one.

### Identity, and why one exists at all

Two of §16.1's eight metrics — 次日回訪率 and 七日回訪率 — are statements about a repeated
individual. There is no aggregate substitute: a design with no stable key can report visits and
cannot report returns. So a key exists, and it is the least it can be:

| | |
|---|---|
| **What it is** | a random string the browser minted for this surface alone |
| **Where it is stored** | `localStorage['art47.analyticsViewerKey']` |
| **What the server sees** | `device:fnv1a64:<16 hex>` — a digest, never the token |
| **Session key** | a second token in `sessionStorage`, so a new tab is a new visit and a closed browser leaves nothing |
| **Joinable with?** | nothing. The ballot (`art45.voteDeviceKey`) and the return recap (`art39.viewerProgressKey`) mint their own, so no column joins a viewer's votes, their reading position and their interaction history |

Clearing site data produces a new key and loses the history. That is a property, not a defect: a
value a browser can discard is what 匿名 means here. It is a claim, not an identity — anyone
presenting the token is, to the deployment, that viewer.

Where storage is unavailable (a private-mode window that throws) the transport installs **nothing**
and the product reports nothing. Never a per-render key: that would mint a new "first session" on
every page load, which does not merely lose the measurement — it fabricates one, making every visit
an acquisition and every retention rate zero.

---

## 3. Telemetry is not a viewer write

PRD 2.0 §22.16 sets successful mutations caused by public **viewing** to zero, and ART-45 resolved
the tension with the daily ballot by proving the guarantee *per surface*: viewing reaches nothing
but reads, and there are two declared writes a viewer reaches only by deliberately acting.

Telemetry could not join them, because the argument that admits them does not cover it: a ballot and
a progress record are deliberate acts that change what the product **shows somebody**, and an event
counter is neither. Folding it in would have broken the argument in both directions — the
world-mutation cap would grow to cover something that mutates no world state, and a future telemetry
field could claim the ballot's justification.

So it has its own gate, module, boundary and cap:

| | viewer writes | telemetry |
|---|---|---|
| Gate | `viewer` | `telemetry` |
| Module | `convex/viewer` | `convex/analytics` |
| Client root | `src/components/vote`, `src/components/recap` | `src/components/analytics` |
| Cap | `maxViewerMutations: 2` — **unchanged** | `maxTelemetryMutations: 1` |

`check-boundaries.mjs` requires the two boundaries' client roots to be **disjoint**, so no single
file can hold both write exemptions — 「viewer telemetry 與 world mutation 架構上分離」 is a check
rather than a convention. The analytics module may not name a Canon writer, a reducer, a replay
entry point, the read-model publisher or the operator gate, and the build fails on the *symbol*, so
a module that grew its own writer is caught as well as one that imported somebody else's.

`recorder.writes` in the browser gate stays empty. Telemetry is recorded in its own bucket
precisely so that assertion keeps meaning what it always did.

---

## 4. Exactly-once logical measurement

Two unrelated ways a rate inflates, and a fix for either does nothing about the other.

**The UI emits twice** — a re-render, a re-run effect, a double tap, a hook that retries a failed
vote and succeeds. The queue refuses a dedupe key it has already accepted this session.

**The transport sends twice** — a batch is sent, the response is lost, the batch is re-sent. The
failed batch stays *in flight*, so the next attempt re-offers byte-identical envelopes; the server
re-derives the same key from them and resolves it on a unique index.

Neither substitutes for the other: the client cannot know whether a lost response meant the write
happened, and the server cannot know that two structurally different batches described one
interaction.

### The unit of measurement

`(session, event, subject)` — and the subject is declared **per event** in `EVENT_SUBJECT_KEYS`,
because both obvious defaults are wrong:

- *Every field present* double-counts. `live_view_opened` carries a `freshness` verdict that changes
  while the viewer sits there; two emissions with different verdicts are one view, and since this is
  the denominator of every §18.1 rate, folding it in deflates all of them at once.
- *`worldId` alone* under-counts. Filtering the timeline twice with two different filters is two
  interactions, and both are real.

`followed` is part of the follow events' subject on purpose: following and then unfollowing in one
session is two measurements, or the second press would dedupe against the first and the record would
keep claiming a follow that was taken back.

The dedupe key is **derived, never transmitted**. A caller-supplied key would let anyone suppress a
measurement by claiming an existing one, or inflate a rate by varying one, and neither is detectable
afterwards.

---

## 5. The metrics

Every rate is `{ numerator, denominator, rate: number | null, status, target, direction,
meetsTarget, excluded }`.

**A zero denominator is never reported as zero.** `rate` is `null` and `status` is
`no_observations`, and `meetsTarget` is `null` rather than `false`. This is not a rounding
preference: 「首次進站後開啟 Episode 0%」 reads as "nobody opened an Episode" and means "nobody
arrived", and that is how a launch gets diagnosed as a UX problem. A hundred viewers who genuinely
opened no Episode still report a measured `0` and a missed target.

### §16.1

| Key | PRD name | Numerator | Denominator | Target |
|---|---|---|---|---|
| `first_session_episode_open` | 首次進站後開啟 Episode | first sessions with `episode_viewed` or `recommended_episode_opened` | first sessions | ≥ 40% |
| `first_session_over_three_minutes` | 首次進站停留超過 3 分鐘 | first sessions with `durationMs > 180000` | first sessions | ≥ 30% |
| `next_day_return` | 次日回訪率 | cohort viewers with a session on day D+1 | matured cohort | ≥ 15% |
| `seven_day_return` | 七日回訪率 | cohort viewers with a session on day D+7 | matured cohort | ≥ 8% |
| `vote_participation` | 投票參與率 | sessions with `vote_submitted` | all sessions | ≥ 10% |
| `follow_character_or_arc` | 追蹤角色或 Arc | sessions with a follow where `followed === true` | all sessions | ≥ 8% |
| `primer_expansion` | 三分鐘前情展開率 | sessions with `current_situation_expanded` | all sessions | ≥ 20% |
| `recommended_entry_click` | 推薦入坑 Episode 點擊率 | sessions with `recommended_episode_opened` | all sessions | ≥ 20% |

Only the first two are scoped to 首次進站. Applying that scope to the rest would silently exclude
every returning viewer — the people most likely to vote and to follow.

**Retention is bucketed, not cumulative.** D7 is the day *exactly* seven after acquisition, matching
次日回訪 as a parallel construction. A cohort that has not aged past its window is **excluded** and
counted in `excluded`, never counted as a non-return — otherwise D7 climbs for a week after every
launch and is wrong the whole time. A viewer row whose `returnDayOffsets` were truncated is excluded
for the same reason: it cannot answer, and counting it as churn would report the heaviest returners
in the product as the ones who left.

### The four `client_external` metrics `docs/dynamic-view-observability.md` listed as unmeasurable

All now derived, plus two more:

| Key | Definition |
|---|---|
| `active_live_viewers` / `active_viewers` | distinct viewer keys in the window |
| `renderer_error_rate` | `live_map_failed` sessions ÷ `live_view_opened` sessions — a **ceiling** (< 2%) |
| `fallback_usage_rate` | `live_fallback_used` ÷ `live_view_opened` |
| `replay_play_rate` | `live_replay_started` ÷ `live_view_opened` |
| `replay_skip_rate` | `live_replay_skipped` ÷ `live_replay_**started**` |
| `replay_completion_rate` | `live_replay_completed` ÷ `live_replay_started` |
| `live_interaction_rate` | PRD 2.0 §18.1's live click-through |

Skip and completion divide by *starts*, not by views: a skip rate over views falls whenever fewer
replays play, which answers a different question.

### Coverage

`coverage.droppedEvents` is the number the **client admitted throwing away** when its queue was
full. A report whose sessions dropped events is measuring less than it looks like it is measuring,
and this is the only place that fact survives — the missing rows leave no trace. `scanLimitReached`
does the same job for a truncated read.

---

## 6. What this does not measure, stated plainly

- **`durationMs` is time-to-last-interaction, not dwell time.** It is the largest
  `sessionElapsedMs` any event reported, flushed additionally when the page becomes hidden. A viewer
  who reads one Episode for five minutes and then closes the tab abruptly is undercounted. The
  alternative — a periodic heartbeat — would add an event §15 does not name and would widen tracking
  for a number nobody set a target for. **首次進站停留超過 3 分鐘 is therefore a floor, not the
  PRD's exact quantity**, and must be read as such.
- **`active_viewers` is not concurrency.** 「同時在線」 is not derivable from an event stream without
  a heartbeat. What is reported is distinct viewers in a window, which is what the §15 events
  support.
- **`episode_completed` is under-reported where `IntersectionObserver` is unavailable.** The hook is
  a no-op there rather than falling back to a timer: a completion rate built on a timer is a
  different metric wearing this one's name.
- **`recordAnalyticsEvents`'s row access is not covered by `npm run check`.** A Convex handler body
  needs a deployment and never executes under jest. Everything it *decides* is delegated to pure
  functions that are covered; `ctx.db.insert` and `ctx.db.patch` are not.
- **A world with no published read model is refused.** Analytics for a world that has published
  nothing is not measurable, and accepting it would make this surface a way to allocate rows in an
  unbounded number of invented worlds.

---

## 7. Abuse resistance

| Bound | Value | Why |
|---|---|---|
| `MAX_ANALYTICS_BATCH_SIZE` | 32 | an unbounded array argument is an unbounded write |
| `MAX_PENDING_EVENTS` | 128 | past it the *newest* events are dropped and the count is published — the oldest are what every denominator needs |
| `MAX_SESSION_DEDUPE_KEYS` | 512 | past it the queue stops deduplicating and **says so** |
| `MAX_EVENTS_PER_WORLD_DAY` | 200 000 | reaching it is evidence of abuse rather than of success |
| `MAX_SESSION_DURATION_MS` | 4 h | a duration is a claim made by a client clock; a tab left open for a week would otherwise drag the three-minute rate into meaninglessness on its own |
| `MAX_RETURN_DAY_OFFSETS` | 32 | a viewer row must not grow without limit on a per-batch write path |
| `MAX_METRICS_WINDOW_DAYS` | 92 | the window bounds the read |

Attempts are metered, not accepted writes, so probing the surface with invented sessions costs a
caller exactly what honest reporting costs them.

---

## 8. Evidence

| Suite | What it settles |
|---|---|
| `convex/analytics/analyticsPrivacy.test.ts` | the allowlist, adversarially, at the server |
| `convex/analytics/analyticsIngest.test.ts` | key derivation, the session fold, the viewer fold |
| `convex/analytics/metrics.test.ts` | every §16.1 definition, and zero ≠ nothing |
| `src/analytics/analyticsIdempotency.test.ts` | the queue and the transport under failure |
| `src/analytics/analyticsChain.dom.test.tsx` | real click → real envelope → real ingest → real metric |
| `e2e/dynamicView.spec.ts` §15 block | the same chain in Chromium and on Pixel 5 |
| `scripts/architecture/check-boundaries.test.mjs` | the gate, the cap, and the disjoint client roots |

Two defects the browser gate found that no unit test could:

- **The transport deadlocked.** A flush timer firing while a send was in flight cleared its own
  handle and returned without re-arming, and `accept` would not arm another because the handle was
  already thought to be set. Everything queued from that moment sat in memory forever. It survived
  every jsdom test because those drive the clock by hand, so a send always resolves before the next
  timer is due. `analyticsIdempotency.test.ts` now holds a send open across a flush to reproduce it.
- **A case-only filename collision.** `AnalyticsTransport.tsx` and `analyticsTransport.ts` resolve to
  the same path on macOS and Windows, so the logic module could be resolved to its own importer. The
  resulting circular import hung jest's loader with no error and no output at all. The logic is now
  `transportCore.ts`.
