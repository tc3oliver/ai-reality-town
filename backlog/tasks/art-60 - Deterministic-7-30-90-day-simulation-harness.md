---
id: ART-60
title: Deterministic 7-day and 30-day simulation harness
status: In Progress
assignee:
  - '@agent-art60'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-04 07:57'
labels:
  - prd-1.0
  - epic-p
milestone: m-0
dependencies:
  - ART-83
  - ART-31
  - ART-4
  - ART-35
  - ART-82
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-007, Section 19.3, Public Test AC 1–10

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Run fixed-seed 7-day and 30-day simulations and machine-check Canon conflicts, replay consistency, arc limits/progress/resolution, character appearance, repetition, recap coverage, token anomalies, and safety outcomes.

Scope
Run fixed-seed 7-day and 30-day simulations and machine-check Canon conflicts, replay consistency, arc limits/progress/resolution, character appearance, repetition, recap coverage, token anomalies, and safety outcomes.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-83, ART-31, ART-4, ART-35, ART-82

Schema Impact
No new production domain schema unless explicitly named; owns deterministic fixtures, reports, rubrics, and verification evidence.

API Impact
Test harnesses consume documented domain/public interfaces without adding production mutation endpoints.

Security Impact
Test evidence minimizes sensitive data and never bypasses Canon, safety, authorization, or publication controls.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every mapped PRD acceptance condition, negative case, and failure boundary.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A fixed-seed 7-day run completes reproducibly with machine-readable findings.
- [x] #2 A fixed-seed 30-day run completes with 100% replay equality and checks Canon conflicts, arc limits/progress/resolution, character appearance, repetition, recap coverage, token anomalies, and safety outcomes.
- [x] #3 The harness uses ART-4 Fake Provider and fixed fixture without network credentials.
- [x] #4 The 90-day run is explicitly out of scope and owned by ART-73.
- [x] #5 Section 16.2: The fixed-seed 30-world-day simulation completion rate is 100%.
- [ ] #6 Section 16.2: The run maintains 1–3 major Active Story Arcs throughout all measured checkpoints.
- [x] #7 Section 5.1: Every completed world day in the 30-day run contains at least one persisted, traceable Accepted Event and exactly one daily Episode derived from accepted events.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Re-verify dependencies by reading code, not labels: ART-4 (FakeWholeSceneProvider/Mistwood fixture), ART-83 (post-commit pipeline stages 11-21), ART-31 (detectArcStagnation, ARC_STAGNATION_WORLD_DAYS), ART-35 (validateRecapCoverage/assertRecapCoverage), ART-82 (arc resolution consequence summary). Also re-read ART-97/98 live pipeline (worldDayLive, postCommitLive) because they are the runnable path this harness drives.
2. Place the harness in convex/operations/longRunHarness.ts (+ .test.ts). architecture/module-boundaries.json only lets 'operations' depend on simulation + story + editorial/recaps + publicRead + safety at once; convex/simulation may not, so simulation/ is not a legal home for a harness that must check episodes, recaps and read models.
3. Harness drives the REAL live pipeline in-process over InMemoryCanonStore: for each world day, for each TIME_SLOT, executeWorldDay(ART-97 stage handlers) then executePostCommitPipeline(ART-98 stage handlers) for every newly accepted event, in canon order. No network, no credentials, FakeWholeSceneProvider only (ART-4).
4. Fixed seed = the Mistwood production seed (convex/canon/mistwoodSeed.ts) plus the fact that every Run ID, idempotency key and generator choice derives from (worldId, worldDay, timeSlot). Reproducibility is proven, not asserted: the harness emits a canonical run digest and the test runs the 7-day scenario twice and requires byte-identical findings.
5. Machine checks emitted as a typed, machine-readable LongRunFindings record (no human eyeball): canonConflicts (every validation error surfaced by the pipeline is recorded, never swallowed), replay (replayWorldEvents over the accepted log reproduces the projection digest - ART-17), arcs (FR-F004/FR-F003 active-major limit, per-arc progress, ART-31 stagnation past ARC_STAGNATION_WORLD_DAYS), characterAppearance (max slotsSinceMajorAppearance observed in the Director context vs a documented threshold), repetition (SHA-256 content hash over scene summary + key actions + dialogue + public summary), recapCoverage (every assembled episode has non-null content and non-empty scenes; recap pyramid advanced), tokens (ProviderTraceMetadata sanity only - the fake provider bills no real tokens, so real cost-anomaly detection is explicitly deferred, not fabricated), safety (every simulated scene and every episode carries a real classification id from classifyPostGeneration; assert invoked, not skipped).
6. Tests: 7-day scenario in the normal suite; 30-day scenario gated behind an env flag if it makes 'npm run check' unacceptably slow, exposed as a documented npm script and recorded in implementation notes with its exact invocation and measured runtime.
7. Documentation: docs/long-run-simulation-harness.md describing the seed, each check, the repetition hash method, and the token-check limitation; link it from the world-day/post-commit docs.
8. npm run check green; honest AC/DoD; implementation notes with pasted real assertion output; commit, push, PR, auto-merge, flip to In Review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

Added `convex/operations/longRunHarness.ts` (pure module, no Convex/node imports) + `convex/operations/longRunHarness.test.ts` + `docs/long-run-simulation-harness.md`, and the `npm run test:longrun` script.

`runLongRunSimulation({ worldDays })` drives the REAL live pipeline: ART-97 `executeWorldDay` (stages 1-10) per time slot, then ART-98 `executePostCommitPipeline` (stages 11-21) for every newly accepted event in canon order, over an `InMemoryCanonStore` seeded from `convex/canon/mistwoodSeed.ts`. It returns one typed, machine-readable `LongRunFindings` record; every assertion in the test reads a field of it.

Placement decision: the harness is in `convex/operations`, not `convex/simulation`. `architecture/module-boundaries.json` makes `operations` the only module allowed to depend on simulation + story + editorial/recaps + publicRead + safety at once, and the harness must inspect episodes, recaps and read models. `npm run check:architecture` and `npm run test:architecture` pass.

Fixed seed: no RNG on the driven path. Every Run ID, idempotency key and generator choice derives from (worldId, worldDay, timeSlot); scene authoring is ART-4's `FakeWholeSceneProvider` (no network, no key, no cost). Reproducibility is proved, not asserted: `LongRunFindings.digest` is a canonical 128-bit FNV-1a digest of every other field and the test runs the 7-day scenario twice and requires byte-identical reports.

Dependencies re-verified by reading code, not labels: ART-4 (`fakeSceneNarrator.ts`, `mistwoodSeed.ts`), ART-83 (`postCommitOrchestration.ts`/`postCommitLive.ts` stages 11-21), ART-31 (`detectArcStagnation`, `ARC_STAGNATION_WORLD_DAYS = 14`), ART-35 (`validateRecapCoverage` - wired per episode), ART-82 (`consequenceSummary.ts`; the ART-98 post-commit port exposes no consequence-summary seam, so it is not driven by this harness and is noted rather than claimed).

## Slow-test gating

The 30-day scenario takes ~265 s because each of its 450 accepted events drives a full post-commit pipeline whose public read-model rebuilds replay the whole accepted log (the O(n^2) cost documented in docs/post-commit-pipeline.md, tracked as ART-100). It is gated behind `ART60_LONG_RUN=1` (`describe.skip` otherwise) so `npm run check` stays at ~21 s. Exact invocation:

    npm run test:longrun

The 7-day scenario (~6 s per run, run twice for the reproducibility check) stays in the default suite. There was no prior gated-slow-test precedent in this repo; this establishes one.

## Token-anomaly check: honest scope

The run is authored by the fake provider, which consumes no real tokens - its `ProviderTraceMetadata` counts are derived from payload length. `TokenFindings` therefore checks only that the accounting channel is wired and internally sane (finite, non-negative, non-zero counts; no unexpected retries) and records `realProviderSpendChecked: false` plus an explanatory `note`. No token-tracking mechanism was invented; real spend-anomaly detection needs the ART-72 adapter.

## Repetition method

128-bit FNV-1a digest over the canonical JSON of each scene's authored prose ONLY - scene summary, key actions, dialogue lines, Proposed Event public summaries. Scene/run IDs, world day and time slot are excluded on purpose: they are unique by construction and would make every scene trivially distinct. A pure-JS digest is used instead of `node:crypto` so the module carries no node builtin.

## Verification evidence (real run output)

`npm run test:longrun` (both scenarios, 30-day included):

    PASS convex/operations/longRunHarness.test.ts (265.366 s)
      NFR-007 fixed-seed 7-day simulation (AC#1/#3)
        + runs the fixed seed with no credentials and no network provider (AC#3) (2 ms)
        + completes reproducibly: the same seed yields a byte-identical report (AC#1) (5562 ms)
        + emits machine-readable findings for every Section 19.3 question (AC#1) (1 ms)
        + passes every clean Section 19.3 check (1 ms)
        + reports the gaps the fixed seed exposes instead of hiding them (1 ms)
      NFR-007 fixed-seed 30-day simulation (AC#2/#5/#6/#7)
        + completes 100% of its world days with 100% replay equality (AC#2/#5)
        + machine-checks every Section 19.3 dimension over 30 world days (AC#2) (1 ms)
        + keeps the major arc portfolio inside the FR-F003 1-3 band at every checkpoint (AC#6)
        + produces canon and exactly one episode for every world day (AC#7)
    Tests: 9 passed, 9 total

30-day findings, verbatim from a real run:

    slotsExecuted: 150, slotsCompleted: 150, completionRate: 1
    acceptedEvents: 450
    canonConflicts: []
    replay: { acceptedEvents: 450, replayedDigest: '372e9d58b92d8bcd83ed6ca25f6ea851',
              liveDigest: '372e9d58b92d8bcd83ed6ca25f6ea851', equal: true,
              secondReplayDigest: '372e9d58b92d8bcd83ed6ca25f6ea851', deterministic: true }
    arcs: { totalArcs: 18, maxActiveMajorArcs: 3, activeMajorLimit: 3, overLimitWorldDays: [],
            arcsWithoutProgress: [], stagnantArcs: [], stagnationThresholdWorldDays: 14,
            deferredTransitions: 345,
            worldDaysWithoutActiveMajorArc: [0,5,10,15,20,25],
            unresolvedMajorByWorldDay: 3 at every one of the 30 checkpoints }
    appearance: { maxSlotsSinceMajorAppearance: 150, threshold: 10, violations: 700,
                  neverAppeared: [lin-yingxue, su-meizhen, luo-shan, tang-ruoxi, wu-zhen] }
    repetition: { scenes: 450, distinctContentDigests: 12, duplicateScenes: 438,
                  duplicateRate: 0.9733 }
    recapCoverage: { completedWorldDays: 30, episodes: 30, worldDaysWithoutEpisode: [],
                     emptyEpisodes: [], worldDaysWithoutAcceptedEvent: [],
                     recapSnapshots: 900, recapTypes: [episode, viewer_context],
                     coverageFindings: 0 }
    tokens: { providers: [fake], models: [fake-whole-scene-v1], traces: 450,
              totalInputTokens: 97222, totalOutputTokens: 473648, retries: 0,
              anomalies: [], realProviderSpendChecked: false }
    safety: { scenesSimulated: 450, scenesWithoutClassification: [], policyVersions: [1],
              labels: [allow], withheldSceneIds: [], eventsBypassingSafety: [],
              episodes: 30, episodesWithoutClassification: [] }

7-day run digest (fixed seed, identical across two consecutive runs): ef7b6fa3e7184b8055ccd18d88b7513c

Supporting checks:
- npm run check:architecture -> Architecture boundaries valid (policy v1, 11 modules)
- npm run test:architecture -> 6/6 pass
- npx tsc --noEmit -> clean
- eslint over the full lint scope -> 0 errors, 0 warnings
- full jest suite -> 78 suites, 914 passed, 4 skipped (the gated 30-day cases), 21.5 s
- npm run build -> built in 2.09 s

(`npm run check` was run stage by stage. In this agent git worktree the aggregated `npm run lint` aborts with an ESLint plugin-resolution collision against the parent checkout's .eslintrc.cjs - a worktree environment artifact, not a code issue; `npx eslint --resolve-plugins-relative-to .` over the same paths is clean.)

## What the runs found (three gaps, reported not hidden)

The 7-day and 30-day runs are clean on completion rate, Canon conflicts, replay equality, arc limits, arc progress, arc stagnation, recap coverage, token-channel sanity and safety. Three real properties of the live pipeline were surfaced and are asserted by the tests, so any change in them fails loudly and must be re-triaged:

1. CHARACTER STARVATION (FR-C002). 5 of the 12 seeded characters - lin-yingxue, su-meizhen, luo-shan, tang-ruoxi, wu-zhen - never take part in a committed scene; maxSlotsSinceMajorAppearance reaches 150 (the whole 30-day run). Root cause read from the code: `generateDirectorPlanCandidate` (convex/simulation/worldDayLive.ts) only plans scenes at locations holding 2+ characters, and no committed scene ever emits character_location_changed, so a character the seed places alone can never be cast and never moves. This is a genuine Director/FR-C002 gap, not a fixture artifact.

2. ARC LOCKSTEP (FR-F004 / Section 16.2). The portfolio holds exactly 3 major arcs at every checkpoint and never breaches the FR-F003 limit, but every event carries identical importance under the fake author, so all three arcs open and advance together and resolve on the same day; on the changeover day (1 world day in 5: 0,5,10,15,20,25) all three replacements are still `emerging`, so the strict `isActiveArcStatus` count is 0. `unresolvedMajorByWorldDay` stays in the 1-3 band throughout; `activeMajorByWorldDay` does not. Uniform event importance is a property of the no-cost tier, so this needs re-measuring against the ART-72 provider before it can be called a production defect. This is why AC#6 is left unchecked.

3. CONTENT REPETITION. 450 scenes collapse onto 12 distinct scene texts (97.3% exact duplicates). Largely the fake author's template output space (which ART-60's scope anticipates), amplified by finding 1's frozen cast and location set.

No production code was changed: fixing finding 1 means changing FR-C002 Director planning (ART-97 scope) and would alter that task's verified behaviour, which is outside ART-60's acceptance criteria. Per the Backlog task-finalization guide, follow-up tasks are NOT created without approval - recommending three: (a) let the Director cast characters who are alone at a location, or make scenes move characters; (b) re-measure arc-portfolio continuity against a real provider once ART-72 lands; (c) revisit repetition once (a) and (b) are in.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @agent-art60
created: 2026-08-04 07:57
---
AC#6 is deliberately left UNCHECKED. Under the codebase's own definition of an active arc (`isActiveArcStatus`, which excludes `emerging`), the fixed-seed 30-day run has 0 major active arcs on 6 of its 30 end-of-day checkpoints (world days 0, 5, 10, 15, 20, 25). The portfolio itself never leaves the FR-F003 1-3 band - `unresolvedMajorByWorldDay` is 3 at every checkpoint - so the limit is respected; what dips is the active-family count during the synchronised resolve->emerge changeover, which is driven by the fake author giving every event identical importance. Reviewer decision needed: (a) accept the portfolio reading and check AC#6, (b) treat it as a real FR-F004 pacing gap and open a follow-up, or (c) defer until ART-72 supplies varied importance. Two further findings (character starvation, 97% scene repetition) are in the implementation notes; no follow-up tasks were created, per the task-finalization guide.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the NFR-007 / PRD Section 19.3 deterministic long-run harness: convex/operations/longRunHarness.ts drives the real live pipeline (ART-97 executeWorldDay stages 1-10, then ART-98 executePostCommitPipeline stages 11-21 for every accepted event) for N consecutive world days over an in-memory Canon store seeded from the Mistwood production seed, and returns one typed LongRunFindings record. convex/operations/longRunHarness.test.ts asserts every Section 19.3 dimension from that record - Canon conflicts (including an independent re-validation of all 450 accepted events so a swallowed error still surfaces), replay consistency, arc limits/progress/ART-31 stagnation, character appearance, scene repetition, recap coverage (ART-35 validateRecapCoverage per episode), token-channel sanity and safety classification coverage. No network, no credentials: ART-4's FakeWholeSceneProvider only. Reproducibility is proved by running the 7-day scenario twice and requiring byte-identical reports (digest ef7b6fa3e7184b8055ccd18d88b7513c).

Verified: npm run test:longrun -> 9/9 pass (265 s), 30-day run 150/150 slots completed (completionRate 1), 450 accepted events, canonConflicts [], replay equal + deterministic, arcs within the 3-major limit with zero stagnation, 30/30 world days with canon and exactly one non-empty episode, zero FR-G004 coverage findings, zero token anomalies, zero events bypassing safety. Full suite 78 suites / 914 tests pass in 21.5 s (the 30-day cases are gated behind ART60_LONG_RUN=1 so npm run check stays fast); tsc, eslint, architecture boundary checks and build all clean.

The runs are NOT entirely clean about the pipeline: they surfaced three real findings - five of twelve seeded characters never appear in any scene in 30 world days (Director only casts multi-character locations and nothing ever moves a character), the active-major-arc count drops to zero on one world day in five during the synchronised arc changeover (why AC#6 is unchecked), and 450 scenes collapse onto 12 distinct texts. All three are asserted by the tests so they cannot regress silently; details and recommended follow-ups are in the implementation notes and the review comment.
<!-- SECTION:FINAL_SUMMARY:END -->
