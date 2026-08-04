---
id: ART-101
title: Live Director starves isolated characters
status: Done
assignee:
  - '@agent-art101'
created_date: '2026-08-04 08:31'
updated_date: '2026-08-04 13:18'
labels:
  - prd-1.0
  - epic-c
dependencies: []
references:
  - convex/simulation/worldDayLive.ts
  - convex/simulation/director.ts
  - convex/operations/longRunHarness.ts
documentation:
  - docs/long-run-simulation-harness.md
priority: high
type: bug
ordinal: 101000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ART-60 30-day fixed-seed harness proved 5 of 12 seeded Mistwood characters (lin-yingxue, su-meizhen, luo-shan, tang-ruoxi, wu-zhen) never take part in ANY committed scene: maxSlotsSinceMajorAppearance reaches 150 (the whole run) and appearance.violations is 700. Root cause is the LIVE candidate generator, not the pure FR-C002 validator. generateDirectorPlanCandidate (convex/simulation/worldDayLive.ts) only ever proposes scenes at locations already holding 2+ characters (its solo fallback fires only when NO location has 2+, which never happens on the Mistwood seed), and no committed scene ever emits character_location_changed, so a character the seed places alone can never be cast and can never move to where a scene is. convex/simulation/director.ts is correct and must NOT change: FR-C002 requires every participant to already be at the scene location, so the fix must live in the live generator. Scope: give isolated characters a path back into scenes - a starvation-fair candidate ranking that lets solo characters be cast, plus a travel path so an isolated character can relocate to an occupied location and become eligible for a multi-character scene.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No seeded Mistwood character is absent from every committed scene over a 30-day fixed-seed run (appearance.neverAppeared is empty)
- [x] #2 appearance.maxSlotsSinceMajorAppearance stays at or below the harness MAX_SLOTS_WITHOUT_APPEARANCE ceiling and appearance.violations is empty over both the 7-day and 30-day runs
- [x] #3 At least one committed event emits character_location_changed, so an isolated character can reach an occupied location; the resulting Canon stays valid (canonConflicts empty, replay equal and deterministic)
- [x] #4 convex/simulation/director.ts (the pure FR-C002 validator) is unchanged, and every generated plan still passes parseAndValidateDirectorPlan
- [x] #5 The ART-60 harness test asserts the fixed behaviour instead of the old starvation finding, and the ART-60 content-duplication figure is re-measured and reported honestly
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
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Do NOT touch convex/simulation/director.ts. FR-C002 correctly requires every planned participant to already stand at the scene location; the defect is entirely in the LIVE candidate generator, so every change lands in convex/simulation/worldDayLive.ts (plus tests/docs).

2. Starvation-fair candidate ranking (fixes "an isolated character can never be cast"). generateDirectorPlanCandidate today builds `groups = ranked.filter(members.length > 1)` and uses `candidates = groups.length > 0 ? groups : ranked`, so the solo fallback never fires on a seed where any location holds 2+. Replace the selection with: keep the existing slot rotation over multi-character locations for variety, but let any location group whose most-neglected member has gone longer than MAX_SLOTS_WITHOUT_APPEARANCE (= TIME_SLOTS.length, one full world day) jump the queue, most-neglected first. Dedupe by location and cap at MAX_MAJOR_SCENES_PER_SLOT. A solo location therefore becomes castable as a genuine one-character errand scene, which resets slotsSinceMajorAppearance because the character lands in the committed event participantIds.

3. Travel path (fixes "nothing ever moves", and is what actually un-partitions the world). At most MAX_TRAVEL_SCENES_PER_SLOT = 1 planned solo scene per slot is a travel scene, chosen deterministically as the most-neglected solo character that has a connected location currently holding someone else (travelDestinationFor: most-occupied reachable location, ties by location ID). The FR-C002 plan schema is closed, so nothing is added to it: the travel scene stays at the character own location (validator-safe) and self-describes by carrying character_location_changed in expectedStateChangeTypes; generate_character_intents re-derives the same destination from the same snapshot and issues the intent with desiredLocationId = destination, which validateCharacterIntent accepts because the destination is reachable. FR-C004 grouping then places the scene at the destination and may merge the traveller into the residents scene; one traveller per slot keeps a merged cast at 4 + 1 = 5, inside MAX_MAJOR_SCENE_PARTICIPANTS = 6.

4. Record the arrival in Canon. The author never sees the world projection, so it cannot state a movement precondition (fromLocationId); the orchestrator can, from the same stage-1 snapshot the Director planned against. Add a pure exported helper in worldDayLive.ts that, for a simulated scene whose participant is not yet standing at the scene location, prepends {type: character_location_changed, characterId, fromLocationId: snapshot location, toLocationId: scene location} to that scene first Proposed Event. It stays a PROPOSAL: it still passes through validateEventStructure, validateCanon (connectivity, capacity, one-move-per-slot, participant membership) and commitProposedEvent unchanged. director.ts, characterIntent.ts, sceneGrouping.ts, sceneSimulation.ts and fakeSceneNarrator.ts are all untouched.

5. Tests. Extend convex/simulation/worldDayLive.test.ts: a neglected isolated character is cast within one world day; a committed event carries character_location_changed and the replayed projection moves the character; the plan still satisfies parseAndValidateDirectorPlan and the FR-C002 location/time-conflict invariants (existing assertions that every event has 2+ participants and a relationship change are relaxed honestly to reflect that solo errand scenes now exist). Update convex/operations/longRunHarness.test.ts so FINDING 1 becomes an asserted FIXED property (neverAppeared empty, violations empty, maxSlotsSinceMajorAppearance bounded) instead of an asserted defect, and re-measure the acceptedEvents / repetition figures from a real run rather than guessing them.

6. Verification. Primary evidence is the harness itself, not a unit test in isolation: ART60_LONG_RUN=1 npm run test:longrun for the 30-day run, before and after, comparing appearance.neverAppeared, appearance.maxSlotsSinceMajorAppearance, appearance.violations and repetition.duplicateRate. Then npm run check green, docs/long-run-simulation-harness.md updated, honest AC/DoD, commit, push, PR, auto-merge, In Review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

All production changes are in `convex/simulation/worldDayLive.ts` (the LIVE candidate generator). `convex/simulation/director.ts` is untouched: FR-C002 correctly requires every planned participant to already stand at the scene location, and the test suite re-runs `parseAndValidateDirectorPlan` over every plan the new generator produces. `characterIntent.ts`, `sceneGrouping.ts`, `sceneSimulation.ts` and `fakeSceneNarrator.ts` are untouched too.

1. Neglect-first scene selection. The old rule built `groups = ranked.filter(members.length > 1)` and used `candidates = groups.length > 0 ? groups : ranked`, so the solo path was dead code on any seed where SOME location always holds two people - which is every Mistwood slot. Multi-character locations still rotate by slot ordinal for cast variety, but any location whose most neglected occupant has passed `MAX_SLOTS_WITHOUT_APPEARANCE` (= TIME_SLOTS.length, one full world day) now jumps that rotation, most neglected first, deduped by location and still capped at `MAX_MAJOR_SCENES_PER_SLOT`. `expectedStateChangeTypes` is declared honestly per scene: a one-character scene no longer claims `relationship_changed`.

2. Travel. At most `MAX_TRAVEL_SCENES_PER_SLOT` = 1 solo scene per slot relocates its character. The plan schema is closed (`exactKeys`), so nothing was added to it: the travel scene is planned at the character OWN location, which is what keeps FR-C002 satisfied, and self-describes by carrying `character_location_changed` in `expectedStateChangeTypes` (`isTravelScene`). The intent stage re-derives the destination from the same stage-1 snapshot via `travelDestinationFor` (connected location holding the most other characters, ties by location ID) and issues `desiredLocationId = destination`, which `validateCharacterIntent` accepts because it is reachable. FR-C004 grouping then seats the scene at the destination and may merge the traveller into the residents scene there; one traveller per slot bounds a merged cast at 4 + 1 = 5, inside `MAX_MAJOR_SCENE_PARTICIPANTS` = 6.

3. Arrival recorded in Canon, not narrated. The author never sees the world projection, so it cannot supply the `fromLocationId` precondition Canon enforces. `withArrivalStateChanges` (pure, exported) prepends `character_location_changed` for any scene participant not yet standing where the scene happens, reading the same snapshot FR-C002 planned against. It remains a PROPOSAL: it still passes `validateEventStructure`, `validateCanon` (connectivity, capacity, one move per slot, participant membership) and `commitProposedEvent` (ADR-0001). Scene safety classification is unaffected - a location change carries no prose.

4. Harness. `AppearanceFindings` gained `relocations` / `relocatedCharacterIds` so "nothing ever moves" is measurable, not inferred.

## Two test expectations changed for real reasons, not to go green

- `convex/simulation/worldDayLive.test.ts` "withholds high-risk scene output": stage 8 now reads the stage-1 artifact, so the direct stage invocation supplies it. Nothing about the assertion changed.
- `convex/operations/postCommitLive.test.ts` timeline: the assertion was `entries.length === events.length`, which only held because every committed event used to have 2+ participants. The world timeline is the MAJOR-event timeline (`TIMELINE_MAJOR_IMPORTANCE` 0.7) and `arcEventImportance` scores a one-character errand at 0.60-0.65, so solo scenes are correctly filtered out. The assertion now states the real invariant: entries == the accepted events whose own importance reaches the threshold. The "every entry traces to an accepted event" assertion was already there and still passes.

## Verification: ART-60 harness, before vs after (30-day fixed seed, real runs)

BEFORE (origin/main 67e60bd, run in a clean worktree):

    acceptedEvents: 450, digest 26a787b48038b1c986759b66b639539d
    appearance: { neverAppeared: [lin-yingxue, su-meizhen, luo-shan, tang-ruoxi, wu-zhen],
                  maxSlotsSinceMajorAppearance: 150, threshold: 10, violations: 700 }
    repetition: { scenes: 450, distinctContentDigests: 12, duplicateScenes: 438, duplicateRate: 0.9733 }

AFTER:

    acceptedEvents: 449, digest 0e07f9623eff2ac98f999654abbbf12d
    appearance: { neverAppeared: [], maxSlotsSinceMajorAppearance: 7, threshold: 10, violations: 0,
                  relocations: 5+, relocatedCharacterIds: the same five }
    repetition: { scenes: 449, distinctContentDigests: 32, duplicateScenes: 417, duplicateRate: 0.9287 }
    canonConflicts: [], replay { equal: true, deterministic: true }, completionRate 1
    arcs, recapCoverage and safety findings byte-identical to the baseline apart from the one merged scene
    (recapSnapshots 900 -> 898)

maxSlotsSinceMajorAppearance 150 -> 7 against a ceiling of 10, and 700 -> 0 violations. 7-day run: acceptedEvents 105 -> 104, appearance identical to the 30-day result (neverAppeared [], max 7, violations 0, relocations 5, all five formerly starved characters relocated), duplicateRate 0.886 -> 0.692.

449 rather than 450 accepted events is not a lost scene: in exactly one slot a relocated character Intent merges into the residents Scene at the destination, so that slot commits two events instead of three. Every world day still produces canon and exactly one non-empty episode.

## Content duplication: honest answer

It improved but is not fixed, exactly as ART-60 predicted. Distinct scene texts went 12 -> 32 and the 30-day duplicate rate 97.3% -> 92.9% (7-day: 88.6% -> 69.2%). The gain is real and comes from the cast/location set no longer being frozen. The residue is the fake author template space, not the Director: 32 distinct texts is what `narrateGroupedScene` can emit over this seed. Per ART-60 recommendation (c) that stays out of scope until the ART-72 provider lands. The harness now asserts 32 rather than 12, so a further change is caught.

## Commands run

    ART60_LONG_RUN=1 npm run test:longrun -> 9/9 pass (574 s), 30-day included
    npm run check -> exit 0: architecture boundaries valid, 6/6 architecture tests, tsc clean,
                     eslint 0 problems over the full lint scope, 83 suites / 1059 passed / 4 skipped
                     (the gated 30-day cases), vite build ok

## Post-merge revalidation (origin/main 7e2a3d7: ART-50, ART-62, ART-92)

Merged origin/main cleanly (no conflicts). ART-92 added an `onContentSample` seam to `longRunHarness.ts` and a dated narrative review packet/review generated from the PRE-fix 30-day run.

Re-ran after the merge:
- `ART60_LONG_RUN=1 npm run test:longrun` -> 9/9 pass (570 s), 30-day included
- `npm run check` -> exit 0, 85 suites / 1090 passed / 5 skipped, build ok

ART-92 artefacts: `docs/narrative-quality-reviews/2026-08-04-mistwood-30-day-{packet,review}.md` scored run digest `26a787b48038b1c986759b66b639539d`, which this fix supersedes. Their recorded scores and FAIL verdict are left VERBATIM - rewriting another reviewer dated record would destroy the evidence - and each gained a dated superseded-run note pointing at ART-101 with the new figures (449 events, 32 distinct texts, 92.9%). The review already framed itself as the lower bound a real provider (ART-72) must beat, and it still is.

PR #135 merged into main at 2026-08-04T09:27:37Z via auto-merge; both required CI checks (Autonomous control plane + offline quality; Offline checks typecheck/lint/test/build) passed. Branch deleted.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the FR-C002 live Director defect ART-60 30-day harness found: five of the twelve seeded Mistwood residents (lin-yingxue, su-meizhen, luo-shan, tang-ruoxi, wu-zhen) never took part in any of 450 committed scenes because generateDirectorPlanCandidate only ever proposed scenes at locations already holding 2+ characters and no committed scene ever emitted character_location_changed, so a character the seed strands could neither be cast nor move.

All production changes are in the LIVE candidate generator convex/simulation/worldDayLive.ts. The pure FR-C002 validator convex/simulation/director.ts is unchanged, and the tests re-run parseAndValidateDirectorPlan over every plan the new generator produces. Scene selection is now neglect-first: multi-character locations still rotate by slot for cast variety, but any location whose most neglected occupant has passed MAX_SLOTS_WITHOUT_APPEARANCE (one full world day) jumps the rotation. At most one solo scene per slot is a TRAVEL scene - planned at the character own location, because FR-C002 requires participants to already be there, and self-describing through expectedStateChangeTypes so the intent stage re-derives the same destination from the same snapshot and sends them to the connected location holding the most other characters. The author cannot state the movement precondition Canon requires, so withArrivalStateChanges prepends the character_location_changed as a PROPOSAL that still passes validateEventStructure, validateCanon and commitProposedEvent unchanged (ADR-0001).

Verified primarily against the ART-60 harness itself, before and after, on the same fixed seed. 30-day: neverAppeared went [5 characters] -> [], maxSlotsSinceMajorAppearance 150 -> 7 against a ceiling of 10, appearance violations 700 -> 0, with the harness new relocations field showing exactly those five characters relocated through Canon. canonConflicts stayed [], replay stayed equal and deterministic, completionRate stayed 1, and arc, recap-coverage and safety findings are unchanged. acceptedEvents 450 -> 449 because in one slot a relocated character Intent merges into the residents Scene rather than committing separately. ART60_LONG_RUN=1 npm run test:longrun -> 9/9 pass (574 s); npm run check -> exit 0 (83 suites, 1059 passed, 4 skipped gated cases, tsc + eslint + architecture + build clean).

Content duplication improved but is NOT fixed, as ART-60 predicted: distinct scene texts 12 -> 32 and the 30-day duplicate rate 97.3% -> 92.9% (7-day 88.6% -> 69.2%). The gain comes from the cast and location set no longer being frozen; the residue is the fake author template space, not the Director, and stays deferred to ART-72. The harness now asserts the new figures, and the starvation finding moved from an asserted defect to an asserted fixed property so it cannot silently regress.
<!-- SECTION:FINAL_SUMMARY:END -->
