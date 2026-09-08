---
id: ART-88
title: Narrative consistency novelty and repetition evaluators
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 16:20'
updated_date: '2026-09-08 11:35'
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
- [ ] #1 Each metric has a documented deterministic calculation or evaluator contract.
- [ ] #2 Scores retain source trace/event references and expose components.
- [ ] #3 Fixtures cover consistent, inconsistent, novel, and repetitive cases.
- [ ] #4 Section 16.2: The repeated-scene ratio is measured with a documented denominator and remains below 15%.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
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
