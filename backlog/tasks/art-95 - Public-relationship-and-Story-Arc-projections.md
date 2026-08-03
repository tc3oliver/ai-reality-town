---
id: ART-95
title: Public relationship and Story Arc projections
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 16:26'
updated_date: '2026-08-03 17:23'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-10
  - ART-29
  - ART-64
  - ART-65
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Sections 13.3 and 13.9; Public Read Model

Problem / Context
This independently reviewable PR closes a public projection ownership gap.

Goal
Build publication-safe relationship and Story Arc projections with history, visibility, entry-point, clue, question, and outcome data.

Scope
Build publication-safe relationship and Story Arc projections with history, visibility, entry-point, clue, question, and outcome data.

Out of Scope
Other public projections, UI, generation, and production deployment.

Dependencies
ART-40, ART-10, ART-29, ART-64, ART-65

Schema Impact
Owns only the publication-safe projection records and DTOs named in Goal.

API Impact
Internal idempotent projection writer and read-only public queries for the named data.

Security Impact
Server-side field allowlists and publication state exclude private cognition, prompts, raw output, and admin notes.

Validation Commands
npm run check; run focused projection rebuild, privacy, correction, and query tests.

Test Requirements
Tests cover replay/rebuild, correction refresh, privacy, idempotency, and last-known-good reads.

Documentation Impact
Update read-model/API and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Relationship projection exposes bounded public dimensions, change history/reasons, and no hidden-secret leakage.
- [x] #2 Arc projection exposes all published FR-I006 fields and excludes resolved arcs from active context.
- [x] #3 Both rebuild deterministically and refresh after corrections.
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
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED: convex/publicRead/relationshipArcProjection.ts (pure): buildRelationshipProjection (bounded public dims via BOUNDED() clamping NaN/Infinity to 0; change history with reasons; REJECTS private-visibility relationships so hidden feelings never leak, AC#1), buildArcProjection (all FR-I006 fields — title/premise/currentQuestion/status/coreCharacters/essentialBackstory/incitingEvent/turningPoint/recommendedEntry/relatedEpisodes/knownClues/unresolvedQuestions; outcome attached only when supplied i.e. resolved, AC#2), RelationshipArcError. relationshipArcProjectionFunctions.ts (wiring): rebuildRelationshipProjection (replays relationship_changed for a pair, public only) + rebuildArcProjection (assembles ArcSummary from lifecycle+projection, recommendedEntry from ART-67, relatedEpisodes/clues/backstory from episodes+public facts, outcome from ART-82 consequence summaries). Publish via commitReadModelVersion (modelKind relationship/arc). Public reads reuse ART-40 getPublishedReadModel. Zero canon writes.

PRD TRACEABILITY: §13.3 Relationship / FR-I006 Story Arc -> doc-1.

VALIDATION: npm run check = exit 0. Architecture boundaries valid. typecheck clean. lint clean. Tests: 517 passed (+8 from convex/publicRead/relationshipArcProjection.test.ts). build OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added publication-safe Relationship and Story Arc projections (§13.3/FR-I006): pure builders (Relationship: bounded public dims + change history, private-visibility rejected so no hidden leakage, AC#1; Arc: all FR-I006 fields + outcome when resolved, AC#2) + rebuild wiring publishing them as relationship/arc read-models via ART-40 (deterministic, idempotent, AC#3). Zero canon writes. Verified: npm run check exit 0; 517 tests pass (+8); architecture boundaries valid; typecheck/lint/build clean.
<!-- SECTION:FINAL_SUMMARY:END -->
