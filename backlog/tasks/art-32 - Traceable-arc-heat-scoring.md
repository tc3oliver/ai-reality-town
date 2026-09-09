---
id: ART-32
title: Traceable arc heat scoring
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:32'
updated_date: '2026-09-09 12:59'
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
- [ ] #1 FR-F006: Score 計算可追蹤。
- [ ] #2 FR-F006: 首頁排序不得完全由 LLM 自由決定。
- [ ] #3 FR-F006: 管理者可查看分數構成。
- [ ] #4 Automated tests provide evidence for every mapped FR-F006 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-F006 to doc-1 and the merged implementation evidence.
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
1. Audit whether heatScore already exists — it does, and it already orders the homepage, which changes the task from 'add a score' to 'replace a stand-in that is already load-bearing'.
2. Write the six-signal composite as a pure, versioned module with per-component evidence and measured-weight renormalisation.
3. Supply the one signal the deployment could not observe (觀眾互動) with an ingest-maintained rollup, rather than shipping five of six.
4. Persist the breakdown and expose it operator-gated (AC#3); pin the ordering comparator (AC#2).
5. Fault injections; remove any guard that cannot fire rather than keeping it.
6. npm run check, npm run e2e, closure matrix reclassification, docs/arc-heat-score.md.
<!-- SECTION:PLAN:END -->
