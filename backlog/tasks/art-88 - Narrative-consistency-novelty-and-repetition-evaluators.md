---
id: ART-88
title: Narrative consistency novelty and repetition evaluators
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 16:20'
updated_date: '2026-09-08 12:40'
labels:
  - prd-1.0
  - epic-o
milestone: m-0
dependencies:
  - ART-57
  - ART-11
  - ART-22
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 88000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M002 narrative metrics

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Compute traceable Character Consistency, Event Novelty, and Dialogue Repetition metrics.

Scope
Compute traceable Character Consistency, Event Novelty, and Dialogue Repetition metrics.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-57, ART-11, ART-22

Schema Impact
Versioned LLM trace, budget, degradation, evaluator, metric-definition, aggregate, and reason-dimension records named by the task.

API Impact
Authorized observability/configuration queries and internal accounting/evaluation interfaces.

Security Impact
Metrics and traces redact secrets, resist duplicate counting, and cannot become or mutate Canon.

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
- [x] #1 Each metric has a documented deterministic calculation or evaluator contract.
- [x] #2 Scores retain source trace/event references and expose components.
- [x] #3 Fixtures cover consistent, inconsistent, novel, and repetitive cases.
- [x] #4 Section 16.2: The repeated-scene ratio is measured with a documented denominator and remains below 15%.
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
1. Audit (done): repeated-scene ratio exists only as LongRunFindings.repetition.duplicateRate (never asserted); 30-day fixed seed = 171 distinct of 449 scenes (61.9% exact duplicates) vs PRD <15%; every dialogue line is one literal; no novelty or near-duplicate measurement exists; persona deviation is a Canon gate, not a voice metric; DISTINCT_SCENE_TEXTS is a test-local pin, not a ratio.
2. convex/quality/textSimilarity.ts (pure): identifier-masked normalisation, character 3-gram shingles, Jaccard, structural signature (ids/quotes/digits masked), inverted-index candidate pruning.
3. convex/quality/narrative.ts: NARRATIVE_EVALUATOR v1 over accepted-scene evidence (scene prose from sceneSimulationRuns joined to accepted events by metadata.sceneId; withheld scenes excluded with reason). Metrics: repeated_scene_ratio (exact OR near-duplicate of an earlier scene, denominator = accepted scenes, target 0.15 atMost), exact_duplicate_scene_ratio, template_reuse_ratio, dialogue_repetition_ratio, event_novelty_ratio, plus character_consistency composite = persona_reversal_rate (buildCharacterSummaries flags) + voice_distinctiveness (cross-character identical lines). Findings carry scene/event/character ids only.
4. Operator query getNarrativeQualityMetrics (world.inspect) in worldQualityFunctions.ts; surface entry; bounded reads by_grouping_run per (day, slot).
5. Fix the root cause in convex/simulation/fakeSceneNarrator.ts: a deterministic composition author — per-character voice lines composed from opener/core/closer parts, scene summaries composed from outcome/complication/stake/consequence clauses, all seeded from scene content, kept inside the recap bands (Quick 80-150 / Standard 400-800 中文字) and MAX_PUBLIC_SUMMARY_LENGTH. Same event semantics, same idempotency keys.
6. Harness: LongRunFindings.narrative from the same evaluator; the 7- and 30-day tests assert repeated_scene_ratio < 0.15 against pinned absolute denominators (104 / 449 scenes) and retire DISTINCT_SCENE_TEXTS; FINDING 2 recorded as resolved with the measured numbers.
7. Rubric 1.1: D1/D6 'complements' now name the automated evaluator; docs/world-quality-metrics.md narrative section; long-run doc.
8. Fault injections (>=6): near-dup threshold set to 1.0 (near-dups vanish) reddens the near-dup test; identifier masking removed reddens the masking test; denominator switched to all scenes incl. withheld reddens the denominator test; author reverted to the constant dialogue line reddens the 7-day voice test; author summary reverted to the 24-combo template reddens the 7-day ratio test; evaluator ignores earlier-scene ordering reddens the novelty test.
9. npm run check, npm run test:longrun, npm run e2e, PR, auto-merge, close.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root causes found and fixed in convex/simulation/fakeSceneNarrator.ts: (1) the template space (6 outcomes x 4 stakes; one dialogue literal for every character); (2) a hash defect — FNV-1a's low bits depend only on the inputs' low bits, so three salted picks (:opener/:core/:closer) over 8x8x6 options produced 71 distinct triples out of 315 lines; a murmur3 fmix32 finaliser (mix) now precedes every modulo. The public sentence is composed from four clauses (~37 中文字; a five-clause 68-字 sentence made six days in seven refuse with RECAP_QUICK_UNSATISFIABLE because headline + one-line must fit the Quick band), sceneSummary adds consequence and pressure, dialogue is opener + register core + character-bound aside + closer (12 registers x 8 cores, 12 aside sets x 8, two independent hashes). Model id bumped to fake-whole-scene-v2.
Evaluator convex/quality/narrative.ts + convex/quality/textSimilarity.ts; operator query getNarrativeQualityMetrics; LongRunFindings.narrative; LongRunFindings.recapCoverage.recapFormatFailures (recap refusals were previously invisible in the report).
Measured: 7-day 104 accepted scenes: repeated 0/104, exact 0, template 0, dialogue repetition 2/348, voice 348/348, novelty 81/103; before ART-88 the evaluator over the old author read 63/104 repeated and voice 0/348. 30-day (first pass, three-part lines): repeated 0/449, exact 0, template 0, dialogue repetition 448/1728 (25.9%), voice 0.76 — dialogue fixed with the aside part; 30-day re-measurement in progress. Rubric bumped to 1.1 (D1/D6 complements name the evaluator).

Fault injections (each compiled, ran, reddened named tests, restored byte-identically — md5 verified): A identifier masking not longest-first -> textSimilarity 'masks the longest identifier first' red (1 failed/61); B pruning bound = every gram -> 5 failed/61 incl. 'does not let the inverted-index pruning drop a match above the threshold' and the narrative near-duplicate test; C withheld/unaccepted scenes in the denominator -> 3 failed/31 incl. 'counts only accepted scenes, and publishes what it left out'; D a shared line counts toward voice distinctiveness -> 3 failed/31 incl. the score test; E scene text compared unmasked -> 2 failed/31 in both directions; F the author reverted to the single dialogue literal -> longRunHarness 'passes every clean Section 19.3 check' red (1 failed/17). Every injection is the kind whose symptom is a BETTER-looking number, which is why each is asserted with its denominator.
Verification: npm run check -> 233 suites, 3931 passed, exit 0. npm run test:longrun -> 17/17 over 30 world days; 449 accepted scenes; repeated_scene_ratio 0/449 (target <15% MET), exact 0, template 0, dialogue repetition 54/1728 (3.1%), voice distinctiveness 1728/1728, novelty 309/448, zero recap-format refusals, continuity 30/30 clean. npm run e2e -> 88 passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered the Narrative evaluator v1 (convex/quality/narrative.ts + convex/quality/textSimilarity.ts): repeated-scene ratio (exact OR near-duplicate, identifier-masked 3-gram Jaccard >= 0.8) with its exact/near/template split, dialogue repetition, voice distinctiveness, persona deviation and event novelty, all over ACCEPTED scenes joined to Canon through metadata.sceneId with withheld scenes excluded and published. Operator query getNarrativeQualityMetrics (world.inspect); LongRunFindings.narrative. FINDING 2 is fixed at its root, not in the metric: the deterministic author now composes a four-clause public sentence and four-part per-character dialogue, and a murmur3 finaliser fixed an FNV-1a low-bit defect that had collapsed three 'independent' picks to 71 distinct triples in 315 lines. The 30-day fixed seed now measures 0/449 repeated scenes (was 171 distinct of 449, 61.9%) with voice distinctiveness 1.0. DISTINCT_SCENE_TEXTS retired; recap-format refusals are now visible in the report. Verified: 61 new evaluator tests plus 107 across convex/quality, 6 fault injections red-then-green, npm run check 3931 passed, 30-day gate 17/17, e2e 88 passed.
<!-- SECTION:FINAL_SUMMARY:END -->
