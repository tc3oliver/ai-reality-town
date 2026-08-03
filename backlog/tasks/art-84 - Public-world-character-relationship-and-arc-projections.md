---
id: ART-84
title: Public World and Character projections
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 16:20'
updated_date: '2026-08-03 17:15'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-9
  - ART-24
  - ART-25
  - ART-78
  - ART-79
  - ART-80
  - ART-81
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Sections 13.1, 13.2, 13.5–13.7; Public Read Model

Problem / Context
World and Character public projections need a focused owner separate from relationship and arc projections.

Goal
Build publication-safe World and Character projections with explicit field allowlists.

Scope
World/current-day/environment and Character public profile/current-state/dramatic-irony projection only.

Out of Scope
Relationship, Arc, Episode, Timeline, Live UI, and production deployment.

Dependencies
ART-40, ART-9, ART-24, ART-25, ART-78, ART-79, ART-80, ART-81

Schema Impact
Owns publication-safe World and Character projection records and DTOs only.

API Impact
Internal idempotent projection writers and read-only World/Character queries.

Security Impact
Server allowlists exclude private profiles, Knowledge, memories, prompts, raw output, and admin notes.

Validation Commands
npm run check; run focused projection rebuild, privacy, correction, and query tests.

Test Requirements
Tests cover every public/forbidden Character field, world state, rebuild, correction, and idempotency.

Documentation Impact
Update read-model/API and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 World projection exposes publication-safe day, time, environment, and public Canon facts.
- [x] #2 Character projection exposes every allowed FR-I005 field and excludes every forbidden field server-side.
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
IMPLEMENTED: convex/publicRead/worldCharacterProjection.ts (pure, EXPLICIT allowlists): WORLD_ALLOWED_FIELDS (§13.1), CHARACTER_ALLOWED_FIELDS (§13.2 MINUS privateProfile/privateGoal), CHARACTER_FORBIDDEN_FIELDS. buildWorldProjection (picks only §13.1 fields + publicFacts), buildCharacterProjection (reads ONLY allowed fields — privateProfile/privateGoal/knowledge/memory structurally never read, AC#2), ProjectionError, assertNoForbiddenCharacterFields. worldCharacterProjectionFunctions.ts (wiring): rebuildWorldProjection + rebuildCharacterProjection internalMutations — gather accepted events (+ worldSchedules for mode/status), assemble source records (character state from character_location_changed/character_life_changed/character_state_changed; stable attrs from public fact_created), build projection, publish via commitReadModelVersion (modelKind world/character). Public reads reuse ART-40 getPublishedReadModel. Zero canon writes.

PRD TRACEABILITY: §13.1/§13.2/§13.5 (public facts) -> doc-1; FR-I005 Character allowlist.

VALIDATION: npm run check = exit 0. Architecture boundaries valid. typecheck clean. lint clean. Tests: 496 passed (+10 from convex/publicRead/worldCharacterProjection.test.ts). build OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added publication-safe World and Character projections (§13.1/§13.2, FR-I005): explicit-allowlist pure builders (Character projects only the §13.2 public subset — privateProfile/privateGoal/knowledge/memory are structurally never read, AC#2) + rebuild wiring that publishes them as world/character read-models via ART-40 (deterministic, idempotent, AC#3). Zero canon writes; public reads reuse the failure-isolated getPublishedReadModel. Verified: npm run check exit 0; 496 tests pass (+10); architecture boundaries valid; typecheck/lint/build clean.
<!-- SECTION:FINAL_SUMMARY:END -->
