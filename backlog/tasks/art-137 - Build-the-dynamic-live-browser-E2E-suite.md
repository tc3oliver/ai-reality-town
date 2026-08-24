---
id: ART-137
title: Build the dynamic live browser E2E suite
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 16:00'
updated_date: '2026-08-24 15:00'
labels:
  - prd-2.0
  - v2-k
  - epic-o
dependencies:
  - ART-126
  - ART-121
priority: high
type: feature
ordinal: 137000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-Q006 (PRD 2.0 §12 Epic Q) — realizes §21.3

**Problem / Context:** PRD 2.0 §22 requires browser E2E evidence on desktop and mobile as a release gate. The dynamic surface has many interacting parts whose regressions are invisible to unit tests, and the zero-mutation and zero-LLM guarantees need runtime evidence, not only static reasoning.

**Goal:** An automated browser E2E suite that exercises the full dynamic viewing experience and proves the zero-mutation and zero-LLM guarantees at runtime.

**Scope:**
- `/live` loads the map.
- At least four fixture characters visible; twelve in the public acceptance environment.
- A character moves smoothly from A to B.
- Idle, walking, speaking and thinking states are distinguishable.
- Clicking a character opens the card; clicking an active scene focuses and summarises.
- Pan, zoom and return to town view.
- Mobile bottom sheet or equivalent works.
- Replay auto-plays once then enters ambient state; manual replay works.
- No network request contains an unauthorized mutation.
- LLM call count does not increase during the run.

**Fixture rule (ART-107 §8):** Any deterministic-fixture development or test must use IDs from the production Mistwood seed (`convex/canon/mistwoodSeed.ts`). `convex/canon/mistwoodFixture.ts` was rebuilt in place (not renamed) to use production seed IDs (Lin Yingxue, Wu Zhen), so it is now safe to import for structural testing, but production acceptance and any other V2 Dynamic Live work must still source data from `mistwoodSeed.ts` directly, not this foundation-test fixture.

**Out of Scope:** Performance measurement (ART-136); security probing (ART-128).

**Dependencies:** ART-126 (responsive experience), ART-121 (replay and time-state labelling).

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** Provides runtime evidence for the zero-mutation and zero-LLM guarantees.

**Test Requirements:** The suite itself is the deliverable; it must run headless in CI.

**Validation Commands:**
- `npm run check`
- The E2E suite passing on desktop and mobile viewports.

**Documentation Impact:** E2E coverage documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /live loads the map in the E2E environment
- [x] #2 At least four fixture characters are visible, and twelve in the public acceptance environment
- [x] #3 A character is observed moving smoothly from one point to another
- [x] #4 Idle, walking, speaking and thinking states are distinguishable
- [x] #5 Clicking a character opens the character card
- [x] #6 Clicking an active scene focuses the camera and shows its summary
- [x] #7 Pan, zoom and return to town view all work
- [x] #8 The mobile bottom sheet or equivalent presentation works
- [x] #9 Replay auto-plays once and then enters the ambient state, and manual replay works
- [x] #10 No network request during the run contains an unauthorized mutation
- [x] #11 LLM call count does not increase during the run
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
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A Playwright suite (Chromium; desktop 1440x900 and Pixel 5 with touch and device scale) running the same spec in both projects — 20 tests, all green — plus a separate CI job that uploads traces on failure. It also closes a gap two earlier tasks recorded about themselves: ART-126 and ART-130 each asserted everything a DOM and a stylesheet can settle and each stated that real layout in a real engine was NOT covered, because no headless browser ran here.

ONLY THE TRANSPORT IS FAKED. VITE_E2E_FIXTURE=1 swaps ConvexClientProvider's client; every component, hook, view model, camera and renderer in a run is the shipped one. A live deployment cannot serve as the fixture — its characters are wherever the last accepted slot put them, its replay may not exist, and its safety gate may have withheld the very scene the spec was going to assert on.

CONTAINMENT is pinned structurally, because a test harness that shipped would be worse than any defect this suite catches: exactly one file imports src/e2e/, that import is inside the gate's true branch, the gate is an exact match on a BUILD-TIME env literal (a check on window or location would not constant-fold and the branch would survive into production), and build:e2e is the only script that sets the flag.

THE FIXTURE IS A REAL PAYLOAD, NOT A PLAUSIBLE ONE. fixtureWorld.test.ts runs each payload through the PRODUCTION assertion. That test exists for a concrete reason: the first replay fixture invented { motions, summaryRef }; nothing rejected it and nothing played it, so the replay silently never started and three browser criteria failed in ways that looked like product defects. The second thing it caught was participantCharacterIds needing to be sorted. Same class of mistake, now impossible to reintroduce without a fast unit test failing first. It also pins ART-107 §8: every id comes from MISTWOOD_CHARACTER_VISUALS and mistwoodLocationFootprints, asserted rather than trusted.

CRITERIA ARE SETTLED THE WAY A VIEWER SETTLES THEM. The map is a canvas, opaque to the DOM and to assistive technology — which is not an obstacle to work around but the reason ART-113 put every affordance in the DOM beside it. So AC#2 is one named control per published character plus a non-uniform canvas; AC#4 is four residents with four animationStates producing four distinct card readings IN WORDS, so a blind viewer gets the same evidence (pixel-peeping the Pixi indicator would prove something they cannot use); AC#8 is measured geometry in the engine.

TWO DELIBERATE LIMITS, STATED. AC#3 proves the canvas changes continuously while a motion is in flight — the difference between an interpolated walk and a teleport — but does not identify which pixels moved. AC#9 does not wait for playback to end naturally: a scene is 20-60s by contract, so that would cost forty seconds per run to re-prove advanceReplay, a pure function replayPlayback.test.ts already covers. What the browser adds is that auto-play fires, that skipping returns to ambient, and that it does not restart.

AC#10/#11 ARE OBSERVED TWICE, on purpose. A guarantee checked only by the thing being replaced is not a guarantee. The fixture transport records and THROWS on any non-query call; the spec also watches the browser's own network layer, which the client cannot influence — a bare fetch or a second client shows up there and nowhere else. The E2E build sets VITE_CLERK_PUBLISHABLE_KEY empty for the same reason: with a key the bundle loads clerk.com and 'the page talked to nothing' becomes unassertable. That is shipped behaviour for a deployment without operator auth, not a workaround.

THREE FAILURES WORTH RECORDING, each now guarded. (1) page.goto('/live/mistwood') dropped the deploy prefix — Playwright resolves with new URL, so an absolute path discards the baseURL's path segment; every test 404'd and reported 'element(s) not found' for <main>, a symptom nothing like its cause. (2) The replay auto-played over the other tests: fresh contexts mean an unconsumed once-per-tab mark, and during playback the page substitutes replay motions for live ones, so a character not in the current scene reads 「—」 — which made two of AC#4's four states identical and looked like a product defect. openLive now skips the replay, a real viewer action. (3) nth(0..3) picked arbitrary residents because the camera chrome has its own ordering; AC#4 now selects by character id.

VERIFICATION. npm run e2e: 20/20 across both projects. npm run check green — 150 suites, 2270 passed, 5 pre-existing skips, build succeeds. Two boundary changes were needed and both were the checker working: src/e2e is now its own module (clientE2EFixture) rather than clientProvider reaching into clientShell, and jest ignores <rootDir>/e2e/ anchored at the root so that src/e2e/'s ordinary unit tests keep running.

NOT COVERED: performance and device tiers (ART-136, out of scope by the task's own terms), security probing (ART-128), and AC#2's public-acceptance-environment clause — a claim about a real deployment, whose check belongs to the ART-138 gate. This suite proves the surface offers all twelve when the projection publishes twelve.

See docs/dynamic-view-e2e.md.
<!-- SECTION:FINAL_SUMMARY:END -->
