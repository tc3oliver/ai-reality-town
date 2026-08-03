---
id: ART-82
title: Arc resolution consequence summary integration
status: To Do
assignee: []
created_date: '2026-08-02 16:20'
updated_date: '2026-08-03 16:26'
labels:
  - prd-1.0
  - epic-h
milestone: m-0
dependencies:
  - ART-31
  - ART-34
  - ART-9
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 82000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-F005 consequence updates

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Apply resolved-arc outcomes and consequences to related character and world summaries without rewriting Canon history.

Scope
Apply resolved-arc outcomes and consequences to related character and world summaries without rewriting Canon history.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-31, ART-34, ART-9

Schema Impact
Versioned Story Arc state, fields, event links, lifecycle, scores, outcomes, and summary-consequence references named by the task.

API Impact
Deterministic arc classification/lifecycle/query interfaces; public ordering consumes published projections only.

Security Impact
Arc data cannot reveal unpublished facts or mutate Canon outside accepted events.

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
- [ ] #1 Resolving or resolved arcs update affected character and world summaries from accepted events.
- [ ] #2 Summary updates retain source arc and event provenance.
- [ ] #3 Failure to refresh a summary does not alter Canon and can be retried safely.
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
ART-82 — Arc resolution consequence summary integration (FR-F005). Apply resolved-arc outcomes/consequences to related character & world summaries derived from accepted events, WITHOUT rewriting canon history.

EXPLORATION NEEDED (next session):
- convex/story/resolution.ts + resolutionFunctions.ts (ART-31 arc resolution lifecycle/outcome)
- convex/story/projection.ts + projectionFunctions.ts (arc projection, currentQuestion/status)
- convex/recaps/recapFormats.ts (ART-66 formats) + convex/recaps/model.ts (recap snapshot)
- convex/canon/model.ts AcceptedEvent + reducer (character/world projection)

DESIGN DIRECTION: a pure consequence-summary layer. Given a resolved arc + its accepted source events, derive a consequence summary (outcome text + affected characterIds/world scope) tagged with provenance (arcId + sourceEventIds). Pure module — never mutates canon; refresh failure leaves canon intact and is idempotent/safely retryable on arc resolution version.

AC MAP: #1 resolved/resolving arc updates affected character+world summaries from accepted events; #2 every summary retains arc+event provenance; #3 refresh failure is non-destructive + retryable (no canon writes).

GATE: npm run check green; PRD FR-F005 -> doc-1. Use the ART-66 pattern: implement -> check -> finalize task Done BEFORE push -> one PR carries code+task metadata.
<!-- SECTION:PLAN:END -->
