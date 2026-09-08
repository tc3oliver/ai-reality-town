---
id: ART-47
title: Privacy-preserving product analytics instrumentation
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-09-08 01:42'
labels:
  - prd-1.0
  - epic-l
milestone: m-0
dependencies:
  - ART-40
  - ART-41
  - ART-42
  - ART-43
  - ART-44
  - ART-45
  - ART-36
  - ART-39
  - ART-68
  - ART-69
  - ART-86
  - ART-87
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 15; Section 16.1 measurement

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Define, emit, validate, and query the specified product analytics events and calculate PRD funnel/retention metrics without sensitive payloads.

Scope
Define, emit, validate, and query the specified product analytics events and calculate PRD funnel/retention metrics without sensitive payloads.

Out of Scope
Guaranteeing real-user conversion targets, Post-MVP follow-event emission before follow UI exists, and production deployment.

Dependencies
ART-40, ART-41, ART-42, ART-43, ART-44, ART-45, ART-36, ART-39, ART-68, ART-69, ART-86, ART-87

Schema Impact
Viewer Intervention, vote, consequence, analytics, or authenticated progress schemas explicitly named by the task.

API Impact
Untrusted viewer command/ingestion interfaces and privacy-safe read/aggregate queries.

Security Impact
Rate limits, authorization, injection defenses, data minimization, and no direct character control are mandatory.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
Tests cover every MVP event emission, future-event schema compatibility, payload rejection, deduplication, and correct metric calculation from fixtures.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Instrumentation can calculate first-session Episode open rate against the 40% product target.
- [x] #2 Instrumentation can calculate first-session duration over three minutes against the 30% target.
- [x] #3 Instrumentation can calculate next-day and seven-day return rates against 15% and 8% targets.
- [x] #4 Instrumentation can calculate vote participation, follow, primer expansion, and recommended-entry click rates against PRD targets.
- [x] #5 Task completion requires correct measurement from fixtures, not achievement of real-user behavior targets.
- [x] #6 Section 15: Typed, privacy-safe schemas and verified emission/query coverage exist for home_viewed, current_situation_expanded, recommended_episode_opened, episode_viewed, episode_completed, character_viewed, character_followed, story_arc_viewed, story_arc_followed, relationship_graph_opened, timeline_filtered, vote_viewed, vote_submitted, return_recap_viewed, live_scene_opened, and share_action.
- [x] #7 Each implemented MVP/P1 interaction emits its analytics event exactly once under retry; deferred follow events have contract tests here and end-to-end emission evidence in ART-71.
- [x] #8 Section 16.1: Metric calculations explicitly compare vote participation to 10%, character-or-Arc follow to 8%, three-minute-primer expansion to 20%, and recommended-entry Episode clicks to 20%.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. AUDIT (done). ART-140 shipped the 17 live_* events, an ALLOWLIST sanitizer and emission points, with a no-op sink. §15's 16 product events, the transport, persistence and every metric do not exist. `analyticsSurface.test.ts` asserts src/analytics reaches no network; `readOnlyClientBoundary` forbids client write primitives outside two declared viewer roots; PRD 2.0 §22.16 sets successful mutations from public VIEWING to zero.

2. ONE sanitizer boundary. Move ART-140's ALLOWED_PAYLOAD_KEYS + sanitizeAnalyticsPayload into `convex/shared/analyticsContract.ts` and extend the event registry with §15's 16. `shared` depends on nothing and everything may depend on it, so the CLIENT emitter and the SERVER ingest run the SAME function — no second payload filter, and the server does not trust the client.

3. Telemetry is architecturally separate from world mutation. New `convex/analytics/` module, a new `telemetry` gate in publicFunctionSurface, and a new `analyticsWriteBoundary` with its own cap, roots and forbidden symbols. `viewerWriteBoundary.maxViewerMutations` stays 2 — analytics spends none of the world-mutation budget, and that is asserted. The ingest module may not name a Canon, simulation or reducer symbol.

4. Exactly-once logical measurement, two independent layers. (a) The unit of measurement is (sessionKey, eventName, subject) derived from the sanitized payload, so a rerender or a UI retry emits the same key and the pure queue drops it. (b) The envelope carries that key to the server, which resolves it on a unique index — a transport retry re-sends identical keys and inserts nothing new.

5. Identity. A third independent browser token under its own storage key, digested server-side via the existing `deviceDigest`, never stored raw — the design §15 already forced on the ballot and progress keys so the three surfaces cannot be joined on one column. Required because D1/D7 return is not computable without a stable anonymous key. Session key is per-session and never persisted.

6. Metrics. `convex/analytics/metrics.ts` (pure) computes §16.1's eight product metrics against their PRD targets plus the four dynamic-view derivations observability lists as unmeasured. Every rate is `{ numerator, denominator, rate: number | null, status: 'measured' | 'no_observations' }` — a zero denominator is never reported as 0%, and a D7 cohort that has not matured is excluded rather than counted as a non-return.

7. Emission. §15 events wired into the real public surfaces; ART-140's 17 live events routed through the same sink, unchanged.

8. Evidence. Privacy/adversarial suite, transport retry/idempotency suite, funnel/retention fixture suite, a browser Dynamic-View emission gate that captures the real envelopes, and >=10 fault injections each compiled and executed.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Architecture

**Transport / sink.** Emitter (`src/analytics`, pure) → shared sanitiser → queue → transport
(`src/components/analytics`, the only client module that may name a Convex write) →
`convex/analytics/ingestFunctions.ts:recordAnalyticsEvents` → three tables → pure metrics →
operator-gated `getProductAnalyticsMetrics`. Everything left of the mutation binding is pure and
directly testable; `AnalyticsTransport.tsx` holds only the clock, the timer and the binding.

An external collector was rejected on privacy grounds rather than convenience: a third party sees
the viewer's IP, which §15 forbids, and it would put the aggregate beyond reach of any test here.

**Identity.** A third browser token under its own storage key, digested server-side by the existing
`opaqueDigest` and never stored raw. Required because D1/D7 are statements about a repeated
individual and have no aggregate substitute. Independent of `art45.voteDeviceKey` and
`art39.viewerProgressKey`, so no column joins a viewer's votes, reading position and interactions.
Session key lives in `sessionStorage`. Storage unavailable → the transport installs nothing and the
product reports nothing; never a per-render key, which would fabricate an acquisition per page load.

**Privacy boundary.** ONE allowlist and ONE sanitiser in `convex/shared/analyticsContract.ts`,
applied at the browser emitter, at Convex's argument validator, and again at the ingest. Not a
client filter plus a server filter: two allowlists drift, and the drift is silent. Plus
`analyticsWriteBoundary.forbiddenPayloadKeys`, which fails the BUILD if `convex/analytics` names a
forbidden field.

**Separation from world mutation.** A fourth gate (`telemetry`), its own module, boundary and cap.
`viewerWriteBoundary.maxViewerMutations` stays 2 — telemetry spent none of the world-mutation
budget — and `check-boundaries.mjs` requires the two boundaries' client roots to be DISJOINT, so no
one file can hold both write exemptions.

**Dedup.** The unit of measurement is `(session, event, subject)`, declared per event, because
deriving the subject from every present field double-counts a `live_view_opened` whose freshness
verdict changed, and deriving it from `worldId` alone under-counts two different timeline filters.
The key is derived on BOTH sides and never transmitted: a caller-supplied key would let anyone
suppress a measurement or inflate a rate undetectably.

## Fault injection — 13 run, 13 caught

Each compiled and executed; none reported `Tests: 0 total` on its recorded run.

| # | Injection | Result |
| --- | --- | --- |
| A | allowlist loop replaced by `Object.keys(source)` | 3 failed / analyticsPrivacy |
| B | `publicSummary`/`headline` added to the allowlist | 3 failed / analyticsPrivacy |
| C | dedupe key varied per offer (re-render double-count) | 4 failed / idempotency + chain |
| D | `take()` rebuilds the batch instead of re-offering the in-flight one | 4 failed / idempotency |
| E | the emitter rethrows a sink failure | 1 failed / analyticsSurface |
| F | telemetry module names `canonEvents` | BOUNDARY ERROR |
| G | zero denominator returns `0` instead of `null` | 1 failed / metrics |
| H | D1/D7 maturity boundary shifted one day | 1 failed / metrics |
| I | `sessionsWith` counts events instead of distinct sessions (vote retry) | 3 failed / metrics |
| J | the shell stops mounting the transport | 1 failed / analyticsSurface |
| K | telemetry module declares a `userAgent` field | BOUNDARY ERROR |
| L | write exemption granted outside the telemetry client root | BOUNDARY ERROR |
| M | telemetry re-gated as a `viewer` write | BOUNDARY ERROR (cap + declaration) |

Three needed a second attempt because the first patch did not compile (`Tests: 0 total`), which is
not evidence; they are recorded above only in their compiling form.

## Two defects found, both by evidence no unit test could produce

1. **The transport deadlocked.** A flush timer firing while a send was in flight cleared its own
   handle and returned without re-arming; `accept` would not arm another because the handle was
   believed set. Everything queued from that moment sat in memory forever. It survived every jsdom
   test because those drive the clock by hand, so a send always resolves before the next timer is
   due — on Pixel 5, where a click takes ~250ms and the debounce is 2s, it happened on the first
   run. Regression test holds a send open across a flush.
2. **A case-only filename collision.** `AnalyticsTransport.tsx` and `analyticsTransport.ts` are the
   same path on macOS and Windows, so the logic module could resolve to its own importer. The
   circular import hung jest's loader with no error and no output at all. Renamed `transportCore.ts`.

## Verification

- `npm run check` — 229 suites, 3823 passed, 12 skipped, exit 0
- `npm run e2e` — 88 passed (desktop + Pixel 5), including 6 new ART-47 browser tests
- `node scripts/architecture/check-boundaries.mjs` — clean; 43 architecture tests pass

## AC#7, and exactly what is claimed under it

Three clauses, and they are not all ART-47's to deliver:

1. **「Each implemented MVP/P1 interaction emits its analytics event exactly once under retry」** —
   delivered and proven twice over. The client refuses a repeated logical measurement; the server
   re-derives the same key from the envelope and resolves it on a unique index. The browser gate
   observes a real Pixel 5 run in which the collector rejects every batch and every retry carries
   byte-identical envelopes.
2. **「deferred follow events have contract tests here」** — delivered, and they are no longer
   deferred. When this task was written the follow UI did not exist; ART-39 has since shipped it,
   so `character_followed` and `story_arc_followed` emit from the real controls in
   `ReturnRecapPage` rather than only having a contract. `followed` is part of their subject on
   purpose, so following and then unfollowing in one session is two measurements — otherwise the
   record would keep claiming a follow that was taken back.
3. **「end-to-end emission evidence in ART-71」** — a forward reference to another task's scope,
   not a deliverable here. Browser-level evidence for the recap page's follow controls specifically
   is not in this PR; the live surface's interactions are covered by the ART-47 browser block.

## Scope judgement recorded rather than made silently

AC#6 requires verified emission coverage for `share_action`, and the product had no share control
at all — the event had no trigger it could fire from. A minimal one was added: a copy-link button
on the Episode page, emitting `shareTarget: 'link'`. Deliberately not a social share widget, which
would reach a third party and expose the viewer's IP — the thing §15 forbids and the reason an
external collector was rejected for the transport too.

`current_situation_expanded` needed the same: the homepage had no disclosure to expand. The
「認識這個世界」 section now holds a native `<details>`, which UX-003「深度資訊逐層揭露」asks for
independently. It is INSIDE the `<section>` rather than replacing it — the public card treatment is
applied structurally by `.public-page main > section`, so swapping the region would have silently
opted the homepage out of the design system, and `publicPages.a11y.test.tsx` caught exactly that.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered §15's sixteen product events, the transport ART-140 could not build, the store, §16.1's
eight metrics and the four dynamic-surface rates observability had listed as unmeasurable.

Three decisions carry the design. ART-140's allowlist moved to `convex/shared/analyticsContract.ts`
so the browser and the untrusted-input ingest run ONE function over ONE list — a client filter plus
a server filter would have been the obvious shape and the wrong one, because two allowlists drift
silently while both halves keep producing well-formed payloads. Telemetry got a FOURTH gate rather
than a third entry under `viewerWriteBoundary`: that gate's justification is that a ballot and a
progress record are deliberate acts changing what the product shows somebody, and an event counter
is neither, so `maxViewerMutations` stays 2 and the two boundaries' client roots are required to be
disjoint. And a zero denominator is never reported as zero — 「首次進站後開啟 Episode 0%」 reads as
"nobody opened an Episode" and means "nobody arrived".

The unit of measurement is (session, event, subject), declared per event, because deriving it from
every present field double-counts a `live_view_opened` whose freshness verdict changed mid-view and
deriving it from worldId alone under-counts two different timeline filters. Retry-safety is two
independent layers: the client refuses a repeated measurement, and the server re-derives the same
key from the envelope and resolves it on a unique index.

The browser gate found two defects no unit test could. The transport DEADLOCKED — a flush firing
mid-send cleared its own timer handle and returned without re-arming, so everything queued
afterwards sat in memory forever; it survived every jsdom test because those drive the clock by
hand. And `AnalyticsTransport.tsx` / `analyticsTransport.ts` are the same path on macOS, so the
logic module could resolve to its own importer and hang jest's loader with no output at all.

13 fault injections, 13 caught; three needed a compiling second attempt, and `Tests: 0 total` is not
counted as evidence.

Verified: `npm run check` green (229 suites, 3823 passed, exit 0); `npm run e2e` green (88 tests,
desktop + Pixel 5, including 6 new ART-47 browser tests); `check-boundaries.mjs` clean with 43
architecture tests passing.

Recorded rather than hidden: `durationMs` is time-to-last-interaction, so 停留超過三分鐘 is a floor
rather than the PRD's exact quantity; `active_viewers` is not concurrency; `episode_completed` is
under-reported without `IntersectionObserver`; and `recordAnalyticsEvents`'s row access needs a
deployment and is not covered by `npm run check`. Two §15 events had no trigger in the product, so
a copy-link button and a homepage disclosure were added for them. Docs: `docs/product-analytics.md`,
plus both PRD matrices and the two ART-140 documents marked superseded-in-part.
<!-- SECTION:FINAL_SUMMARY:END -->
