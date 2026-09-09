---
id: ART-32
title: Traceable arc heat scoring
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:32'
updated_date: '2026-09-09 14:30'
labels:
  - prd-1.0
  - epic-h
milestone: m-0
dependencies:
  - ART-29
  - ART-47
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-F006

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Compute heat from recent importance, unresolved tension, character attention, viewer interaction, freshness, and climax proximity with inspectable components.

Scope
Compute heat from recent importance, unresolved tension, character attention, viewer interaction, freshness, and climax proximity with inspectable components.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-29, ART-47

Schema Impact
Versioned Story Arc state, fields, event links, lifecycle, scores, outcomes, and summary-consequence references named by the task.

API Impact
Deterministic arc classification/lifecycle/query interfaces; public ordering consumes published projections only.

Security Impact
Arc data cannot reveal unpublished facts or mutate Canon outside accepted events.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Scoring tests verify each factor, tie-breaking, and administrator explanation.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-F006: Score 計算可追蹤。
- [x] #2 FR-F006: 首頁排序不得完全由 LLM 自由決定。
- [x] #3 FR-F006: 管理者可查看分數構成。
- [x] #4 Automated tests provide evidence for every mapped FR-F006 acceptance criterion, including rejection and failure paths.
- [x] #5 PRD traceability links FR-F006 to doc-1 and the merged implementation evidence.
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
1. Audit whether heatScore already exists — it does, and it already orders the homepage, which changes the task from 'add a score' to 'replace a stand-in that is already load-bearing'.
2. Write the six-signal composite as a pure, versioned module with per-component evidence and measured-weight renormalisation.
3. Supply the one signal the deployment could not observe (觀眾互動) with an ingest-maintained rollup, rather than shipping five of six.
4. Persist the breakdown and expose it operator-gated (AC#3); pin the ordering comparator (AC#2).
5. Fault injections; remove any guard that cannot fire rather than keeping it.
6. npm run check, npm run e2e, closure matrix reclassification, docs/arc-heat-score.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed after PR merged; npm run check and npm run e2e green on the merged branch.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
heatScore was not a new field: it has ordered the homepage since ART-65, and its value was Math.round(membership.importance * 100) — one of FR-F006's six signals, read off the single event being folded. Three consequences, none cosmetic: nothing decayed (新鮮度 was not merely unweighted but unrepresentable), a quiet climax sorted below a loud aside, and AC#1/AC#3 were unsatisfiable because a multiplication has no derivation to trace. It is now a weighted composite of all six, renormalised by MEASURED weight so a signal the deployment cannot observe is not scored as zero. 觀眾互動 needed a source rather than a placeholder: analyticsEvents has no arc index and a life-of-arc count would be unbounded on a per-event path, so the ingest maintains arcInteractionCounters, bumped inside the dedupe loop so counter and log cannot disagree — and story_arc_followed counts in both directions, because un-following is attention. The breakdown is persisted per arc and read operator-gated through inspectArcHeat, which does NOT recompute. Verified: 6 injections each turning named tests red; a seventh turned nothing red and the guard was REMOVED rather than kept, because clamping the composite cannot fire when every component is already clamped. npm run check exit 0 (4232 passed, 245 suites); npm run e2e 114 passed; docs/arc-heat-score.md; RISK-002's mitigation list is now complete; PR #260 merged.
<!-- SECTION:FINAL_SUMMARY:END -->
