---
id: ART-73
title: Ninety-day resilience and quality simulation
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:43'
updated_date: '2026-09-08 22:13'
labels:
  - prd-1.0
  - epic-p
milestone: m-0
dependencies:
  - ART-60
  - ART-58
  - ART-88
  - ART-89
  - ART-90
  - ART-59
  - ART-91
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-007, Section 19.3, Milestone 8

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Run the fixed-seed 90-day simulation with budget, degradation, quality, stagnation, repetition, safety, and replay reporting; keep the P0 30-day gate independent.

Scope
Run the fixed-seed 90-day simulation with budget, degradation, quality, stagnation, repetition, safety, and replay reporting; keep the P0 30-day gate independent.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-60, ART-58, ART-88, ART-89, ART-90, ART-59, ART-91

Schema Impact
No new production domain schema unless explicitly named; owns deterministic fixtures, reports, rubrics, and verification evidence.

API Impact
Test harnesses consume documented domain/public interfaces without adding production mutation endpoints.

Security Impact
Test evidence minimizes sensitive data and never bypasses Canon, safety, authorization, or publication controls.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every acceptance criterion and all stated negative or failure cases.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A fixed-seed 90-day simulation completes using the deterministic harness and Fake Provider.
- [x] #2 The report covers Canon/replay, narrative consistency, novelty/repetition, arc progress/stagnation, recap/spoiler, rejection/safety, budget/degradation, and token anomalies.
- [x] #3 Results identify thresholds, source evidence, evaluator versions, and reproducible seed/configuration.
- [x] #4 The 90-day task does not redefine or duplicate the P0 7/30-day gate.
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
1. Make the 90-day run affordable. The harness paid two costs production does not: an unindexed read store and a full replay of the accepted log once per character per event. Both fixed; the byte-identical report digest is what makes 'this changes no answer' checkable.
2. Audit first, across every layer ART-58/88/89/90/91 touched, for capability that exists but cannot be reached from production. Fix what it finds inside its own task rather than recording it. It found the FR-M004 ladder's lower rungs unreachable (ART-165) and four evaluator-evidence defects (ART-166).
3. Clean 90-day scenario, in longRunHarness.test.ts behind its own ART73_NINETY_DAY flag, reusing expectCleanRun and expectKnownFindings unchanged. AC#4 is satisfied by running the SAME assertions at a third length rather than by restating them, and by leaving npm run test:longrun exactly as it was.
4. Resilience scenario, ninetyDayResilience.test.ts: ONE continuous world of 90 days with the provider taken away for eight of them and given back, the FR-M004 ladder in the loop. Asserts what could be quietly untrue after an outage - independent Canon re-validation at every rung, replay equality and dense sequence numbers across the pause, a public that is never left without a world, no scene narrated while the provider is away, and the probe cadence.
5. Pin the 90-day counts from a measured run. Denominators as equalities so the ratio cannot be improved by authoring less; arc counts as floors so a healthier seed is not a regression.
6. Fault injection over both scenarios, then npm run check, then npm run e2e, then PR with auto-merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was delivered

Two scenarios behind ART73_NINETY_DAY=1, a flag separate from ART60_LONG_RUN=1 so the P0 gate costs exactly what it did (AC#4).

1. Clean 90 days, in longRunHarness.test.ts, reusing expectCleanRun and expectKnownFindings unchanged. AC#4 is satisfied by running the SAME assertions at a third length rather than restating them.
2. ninetyDayResilience.test.ts: ONE continuous world of 90 days - 40 healthy, 8 with the provider gone, 42 after an operator resume - with the FR-M004 ladder in the loop. The only place the whole ladder is observed end to end.

Two prerequisites the audit surfaced were fixed in their own tasks rather than recorded: ART-165 (the ladder's two lowest rungs were unreachable, rung 2 changed no call, rung 3 undid itself, and one slot could move the world twice) and ART-166 (four evaluator-evidence defects).

Two harness costs production does not pay were removed first, or the run would not finish: an unindexed read store and a full replay of the accepted log once per character per event. The byte-identical report digest is what makes 'this changes no answer' checkable.

## The one number that was not clean, and what was done about it

Dialogue repetition is a CUMULATIVE ratio over a finite space, so it grows with the square of the sample. ART-88 sized the author's line space for 30 days and measured 3.1%; the same author measured 9.87% at 90 days against a harness assertion of 10%. The threshold was NOT moved - the space was widened (16 openers, 12 closers, quadrupling it) and 90 days now measures 3.4%. The 7- and 30-day gates were re-run and are unchanged.

## Measured over the fixed seed, 90 world days

- 1349 accepted events, 1349 scenes, 450/450 slots, completion 1.0
- Canon conflicts 0; live fold equals full replay; replay deterministic
- Continuity Score 1.0 over 1349 events, 90 daily snapshots, 178 publications
- 重複場景比例 0.0 of 1349 (section 16.2 target < 0.15)
- 高重要度摘要覆蓋率 1.0 of 1326, 15 excluded as not yet due (target >= 0.95)
- spoiler violations 0 of 89 released episodes
- Canon rejection 0 of 2698; safety withhold 0 of 1349
- JSON 結構成功率 1.0 of 1349 - by construction under the deterministic author; the live evidence is npm run test:live-structure
- event novelty 0.665, voice distinctiveness 1.0, persona deviation 0, dialogue repetition 0.034
- 54 arcs, 96 terminal resolutions, 0 stagnant, 0 over limit, live and replay agree
- 89 episodes for 89 completed world days, none empty, no recap format refused
- appearance: nobody missing, no neglect violation; public-read LLM calls 0
- resilience: all six rungs occupied, descended and climbed in order; one operator resume; Canon valid at every rung; sequence numbers dense across the pause; the public never left without a world; no scene narrated during the outage

## Injections

Six, each compiled, executed and turning named tests red:

| injection | red |
| --- | --- |
| a paused world still admits simulation | 6 |
| the provider never actually goes away | 7 |
| the ladder is fed a rules-only slot as authoring evidence | 7 |
| the probe runs on every slot | 3 |
| a rules-only event names an unknown location | 2 |
| the repetition denominator drops half the scenes | 1 |

Two earlier attempts are recorded as NOT counting: making the paused branch unreachable produced Tests: 0 total, which is a suite that failed to load; and removing the rules-only structural check changed nothing observable because the events it guards are valid. Both were replaced.

## Commands

- npm run check - Tests: 4172 passed, 31 skipped, 4203 total; Test Suites: 243 passed, 3 skipped
- npm run test:ninetyday - Tests: 29 passed, 5 skipped, 34 total; clean run 4620 s, resilience 3341 s
- npm run test:longrun - Tests: 17 passed, 7 skipped (the P0 gate, re-run after the author change)
- npm run e2e - 88 passed

PR #250, auto-merge armed.
<!-- SECTION:NOTES:END -->
