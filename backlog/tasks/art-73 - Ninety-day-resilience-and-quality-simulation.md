---
id: ART-73
title: Ninety-day resilience and quality simulation
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:43'
updated_date: '2026-09-08 18:28'
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
- [ ] #1 A fixed-seed 90-day simulation completes using the deterministic harness and Fake Provider.
- [ ] #2 The report covers Canon/replay, narrative consistency, novelty/repetition, arc progress/stagnation, recap/spoiler, rejection/safety, budget/degradation, and token anomalies.
- [ ] #3 Results identify thresholds, source evidence, evaluator versions, and reproducible seed/configuration.
- [ ] #4 The 90-day task does not redefine or duplicate the P0 7/30-day gate.
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
