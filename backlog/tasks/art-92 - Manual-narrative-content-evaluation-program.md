---
id: ART-92
title: Manual narrative content evaluation program
status: In Progress
assignee:
  - '@agent-art92'
created_date: '2026-08-02 16:20'
updated_date: '2026-08-04 08:48'
labels:
  - prd-1.0
  - epic-p
milestone: m-0
dependencies:
  - ART-60
  - ART-77
  - ART-8
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 92000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 19.5

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Define and execute a repeatable human-review rubric for narrative quality and safety interception.

Scope
Define and execute a repeatable human-review rubric for narrative quality and safety interception.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-60, ART-77, ART-8

Schema Impact
No new production domain schema unless explicitly named; owns deterministic fixtures, reports, rubrics, and verification evidence.

API Impact
Test harnesses consume documented domain/public interfaces without adding production mutation endpoints.

Security Impact
Test evidence minimizes sensitive data and never bypasses Canon, safety, authorization, or publication controls.

Validation Commands
npm run check; run the task-focused automated or documented manual validation and record exact evidence.

Test Requirements
Tests or documented human evaluation cover every acceptance criterion and applicable negative, retry, and privacy cases.

Documentation Impact
Update relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Rubric defines sampling, rating scales, evaluator instructions, and evidence retention.
- [x] #2 Evaluation covers every PRD manual-content dimension on representative 30-day output.
- [x] #3 Disagreements and failed thresholds produce recorded findings without altering Canon.
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
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Source the dimensions from the PRD, not from paraphrase: Section 19.5 names eight manual-sampling questions (character consistency, actions consistent with known information, event causality, arc progression, arc stalling, dialogue repetition, misleading summaries, inappropriate-content interception). The rubric must score all eight plus spoiler discipline, and must COMPLEMENT rather than duplicate the automated checks already merged in ART-35 (recap coverage/spoiler validation), ART-54/55 (pre/post-generation safety classification) and ART-60 (machine-checked long-run findings). This is a human-review process definition task, not a new automated test.
2. Content seam. ART-60's runLongRunSimulation returns only machine findings (digests, counts) - a human reviewer cannot read a digest. Add ONE optional callback to LongRunInput, onContentSample, invoked once after the run with the authored scenes and assembled episodes. It is not an input to LongRunFindings.digest and cannot influence the run, so ART-60's byte-identical reproducibility test is untouched.
3. New pure module convex/operations/narrativeReviewSample.ts: deterministic stratified sampling of scenes and episodes across the whole run (first/last world day always included, evenly spaced in between, fixed tie-breaks so the same seed yields the same sample), plus a markdown review-packet renderer that carries the automated signals (repetition rate, never-appeared characters, safety labels/withheld scenes/events bypassing safety, FR-G004 coverage findings) as reviewer context.
4. Tests convex/operations/narrativeReviewSample.test.ts in the default suite, using a short run so npm run check stays fast: sampling determinism, first/last world-day coverage, every Section 19.5 dimension prompt present in the packet, and no seeded secret value leaking into the packet.
5. npm script narrative:review-packet to regenerate the 30-day packet. Runner is jest, because the harness module graph reaches convex/_generated/server.js and ts-node cannot load it under package type module; document the reason rather than adding a bundler dependency.
6. docs/narrative-quality-rubric.md v1.0: sampling protocol, 0-4 scoring scale, per-dimension pass thresholds and a run-level verdict rule, evaluator instructions per dimension, two-reviewer disagreement resolution, evidence retention (packet + scored review committed under docs/narrative-quality-reviews/), and the explicit rule that a failed threshold produces a recorded finding and never a Canon edit (append-only invariant).
7. Execute the rubric ONCE for real against a 30-day fixed-seed run and commit both the generated packet and the scored review. Expect narrative quality to score low: the no-cost ART-4 fake author has a tiny template space (ART-60 already measured 97.3% exact duplication) and ART-99 is separately fixing character starvation. Record that honestly as the baseline rather than hiding it.
8. npm run check green; honest AC/DoD; implementation notes with the real scores; merge origin/main before the final push; commit, push, PR, auto-merge, flip to In Review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

Three artefacts, in the order a reviewer meets them:

1. `docs/narrative-quality-rubric.md` (version 1.0) - the versioned human-review rubric. Nine scored dimensions: the eight PRD Section 19.5 sampling questions (character consistency, action plausibility vs known information, event causality, arc progression, arc stalling, dialogue repetition, misleading summaries, inappropriate-content interception) plus spoiler discipline (Section 20 #5/#17). 0-4 scale, per-dimension pass thresholds, D8/D9 as HARD GATES that a high mean cannot rescue, a three-way run verdict (PASS / PASS WITH FINDINGS / FAIL), a two-evaluator disagreement procedure that records rather than averages disagreements, evidence retention paths, and the explicit rule that a failed threshold produces a recorded finding and NEVER a Canon edit (append-only invariant).
2. `convex/operations/narrativeReviewSample.ts` + test - deterministic extraction of a readable sample from a real fixed-seed run, plus the markdown packet renderer. `npm run narrative:review-packet` regenerates the 30-day packet.
3. `docs/narrative-quality-reviews/` - the executed evaluation: the exact packet that was scored, and the scored review record.

## Design decisions

CONTENT SEAM, NOT A SECOND HARNESS. ART-60's `LongRunFindings` is machine-only on purpose - its answer to 'is the dialogue repetitive?' is a count of digests, which a human cannot read. Rather than duplicate 1,373 lines of pipeline driving, `runLongRunSimulation` gained ONE optional callback, `onContentSample`, invoked once after the run with the authored scenes and assembled episodes. It is emitted after the fact and is not an input to `LongRunFindings.digest`, so ART-60's byte-identical reproducibility test is untouched (re-run and passing: 5/5).

COMPLEMENTS, NEVER DUPLICATES. Every rubric dimension names the automated check it complements: ART-35 proves an episode CITES the right events, so D7 asks whether the prose about them misleads; ART-54/55 test the classifier against known-unsafe fixtures, so D8 asks a human to find the unsafe content nobody wrote a fixture for; ART-60 measures EXACT duplicate digests, so D6 asks about paraphrase and formula. A test asserts the rubric document and `RUBRIC_DIMENSIONS` stay in step, so the two cannot drift.

SAMPLING IS MECHANICAL so two evaluators read the same text: 6 world days evenly spaced with first and last always included, 2 scenes per day evenly spaced in canon order, every sampled day's episode, plus a repetition exhibit quoting the three largest exact-duplicate groups. Even spacing rather than a prefix, because a defect that only appears once a run has accumulated state is invisible in the first N days. The packet records the run digest, so a score is only valid against the text it was taken from, and the packet is byte-reproducible from the seed.

RUNNER CHOICE. The packet generator runs under jest (`npm run narrative:review-packet`), not a standalone node script. The harness module graph reaches `convex/_generated/server.js`; with `type: module` in package.json, ts-node cannot load it in either CJS or ESM mode (verified: ERR_REQUIRE_ESM in CJS, extensionless-specifier resolution failure in ESM), and jest with ts-jest is the runner this repo already uses for exactly this graph. Gated behind `ART92_REVIEW_PACKET=1` for the same reason ART-60 gates its 30-day scenario: the run takes ~5.7 minutes.

EVIDENCE RETENTION is the git history: both the packet and the scored review record are committed. The review record states rubric version, run digest, seed tuple, evaluator, per-dimension scores, verdict, findings and disagreements.

## Rubric execution (real, this session)

`npm run narrative:review-packet` -> 344.8 s, 9/9 tests pass, packet written, run digest `26a787b48038b1c986759b66b639539d`. 450 accepted events, 450 scenes, 30 episodes; 12 scenes and 6 episodes sampled over world days 0, 6, 12, 17, 23, 29.

VERDICT: FAIL. Scores (threshold in brackets): D1 character consistency 0 [3]; D2 action plausibility 1 [3]; D3 event causality 0 [3]; D4 arc progression 1 [3]; D5 arc pacing 0 [3]; D6 dialogue/scene variety 0 [3]; D7 summary fidelity 2 [3]; D8 safety interception 4 [4, hard gate] PASS; D9 spoiler discipline 4 [4, hard gate] PASS.

This is the EXPECTED baseline, not a task failure: no real LLM is connected, so every scene is authored by ART-4's deterministic fake provider whose template space is twelve texts. Rubric section 9 anticipates it in writing. Both hard gates - the dimensions this run CAN meaningfully answer - pass.

Six findings recorded, none of which touched Canon:
- F-01 (D1/D6) every character in every sampled scene speaks the identical sentence 'We settle this here, before it grows.'; names are interchangeable.
- F-02 (D3/D5) world day 29 is textually the same scene as world day 0; ~28 of 30 days are removable without reader loss. Notable: ART-31's automated stagnation detector reports ZERO stagnant arcs on this same run - exactly the gap D5 exists to cover.
- F-03 (D4) the arc ledger advances (18 arcs, 15 resolved) while the reader-visible question set is opened on day 0 and closed unchanged on day 29; episodes 7, 13, 18 and 24 open and resolve nothing.
- F-04 (D7) NEW, provider-independent episode-assembly defect that no automated check owns: `oneLineSummary` is the headline concatenated with itself, each of the five `keyScenes` entries concatenates unrelated scenes from different locations under one heading, and ~20 undifferentiated 'Relationship changed between X and Y' lines cover only 3 pairs. Nothing asserted is untrue, which is why ART-35 passes it clean, but the structure overstates scale and grouping.
- F-05 (D8/D9) both gates pass and 450/450 scenes plus 30/30 episodes are classified with zero bypasses, but the corpus contains no content near a policy boundary. The run proves the safety channel is wired and always invoked; it does not exercise interception power. Re-score against ART-72.
- F-06 confirms the known ART-60 character-starvation finding from a reader's seat (7 of 12 characters ever appear). Already owned by ART-99; no duplicate task created.

## Verification evidence

- `npm run narrative:review-packet`: 9 passed, 9 total, 344.842 s.
- `npm run check`: architecture boundaries valid (policy v1, 11 modules); test:architecture 6/6; typecheck clean; lint clean; jest 84 suites, 1062 passed, 5 skipped (the gated ART-60 30-day cases and this task's gated packet case); vite build OK in 2.32 s.
- `npx jest --runTestsByPath convex/operations/longRunHarness.test.ts`: 5 passed - ART-60's fixed-seed reproducibility is unaffected by the new seam.

## AC#3 scope disclosure

AC#3 has two halves. The FAILED-THRESHOLD half is both defined (rubric section 7) and demonstrated: the executed review scored six dimensions below threshold and recorded six findings, and no Canon was altered - the review has no mechanism to alter it, since accepted events are append-only and the packet is generated read-only from an in-memory replay of the seed. The DISAGREEMENT half is defined (rubric section 6: differences of >=2 are recorded as disagreements with both scores and both evidence references, never averaged; an unresolved disagreement on a hard gate is a FAIL) but was NOT exercised, because this baseline evaluation had a single evaluator. Rubric section 6 requires two independent evaluators only for a release-gate evaluation, which is the ART-72 re-run, not this one. Recorded here rather than implied.

Post-merge revalidation after merging origin/main (ART-50/62/99 siblings): npm run check -> architecture boundaries valid, test:architecture 6/6, typecheck clean, lint clean, jest 85 suites / 1085 passed / 5 skipped, vite build OK in 2.22 s. No conflicts beyond a clean auto-merge of docs/DEVELOPMENT.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Defined and executed a repeatable human-review rubric for narrative quality and safety interception (PRD Section 19.5).

DEFINED: docs/narrative-quality-rubric.md v1.0 scores nine dimensions - the eight Section 19.5 sampling questions plus spoiler discipline - on a 0-4 scale with per-dimension thresholds, D8 safety interception and D9 spoiler discipline as hard gates, a three-way run verdict, a two-evaluator disagreement procedure that records rather than averages, evidence-retention paths, and the rule that a failed threshold produces a recorded finding and never a Canon edit. Every dimension names the automated check it complements (ART-35, ART-54/55, ART-60) so the rubric asks only what a digest, a classifier and a coverage validator cannot answer.

REPEATABLE: convex/operations/narrativeReviewSample.ts turns a real fixed-seed run into a readable packet via one new optional callback on ART-60's harness (onContentSample), which is emitted after the run and excluded from LongRunFindings.digest, so ART-60's byte-identical reproducibility test is unaffected (re-run: 5/5 pass). Sampling is mechanical - 6 evenly spaced world days including first and last, 2 scenes per day, every sampled day's episode, plus a quoted repetition exhibit - so two evaluators read the same text. npm run narrative:review-packet regenerates it.

EXECUTED: one real 30-day run, digest 26a787b48038b1c986759b66b639539d, 450 accepted events / 450 scenes / 30 episodes, 12 scenes and 6 episodes sampled. VERDICT FAIL: D1 0, D2 1, D3 0, D4 1, D5 0, D6 0, D7 2 (all below their threshold of 3); hard gates D8 4 and D9 4 both PASS. That is the expected baseline, not a task failure - no real LLM is connected, so every scene comes from ART-4's deterministic fake provider with a twelve-text template space, and rubric section 9 says so in advance. Six findings recorded, including one NEW provider-independent defect no automated check owns (F-04: episode oneLineSummary is the headline duplicated, keyScenes concatenate unrelated scenes, ~20 undifferentiated relationship lines cover 3 pairs) and one confirmation of ART-60's character starvation (F-06, owned by ART-99, not duplicated). No Canon was altered.

VERIFIED: npm run narrative:review-packet -> 9 passed / 9 total in 344.842 s. npm run check -> architecture boundaries valid (11 modules), test:architecture 6/6, typecheck clean, lint clean, jest 84 suites / 1062 passed / 5 skipped (gated long-run cases), vite build OK in 2.32 s.
<!-- SECTION:FINAL_SUMMARY:END -->
