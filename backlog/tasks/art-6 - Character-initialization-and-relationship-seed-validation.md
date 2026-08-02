---
id: ART-6
title: Character initialization and relationship seed validation
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:30'
updated_date: '2026-08-02 18:04'
labels:
  - prd-1.0
  - epic-b
milestone: m-0
dependencies:
  - ART-5
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-A002

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Load 12–20 fictional characters with public/private profiles, goals, secrets, assets, knowledge, location, and deduplicated relationships.

Scope
Load 12–20 fictional characters with public/private profiles, goals, secrets, assets, knowledge, location, and deduplicated relationships.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-5

Schema Impact
World import/seed schemas for world, locations, organizations, history, rules, characters, relationships, knowledge, secrets, and assets named by the task.

API Impact
Validated administrative import/readiness commands; imports are atomic and unavailable to public callers.

Security Impact
Seed/import data rejects real-person data, invalid references, unsafe defaults, and partial writes.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Fixture tests load at least 12 characters and exercise all rejection cases.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-A002: MVP 至少可載入 12 位主要角色。
- [x] #2 FR-A002: 每位角色必須具備 Public Goal 與 Private Goal。
- [x] #3 FR-A002: 所有角色與地點參照有效。
- [x] #4 FR-A002: 所有 Secret 必須定義初始知情者。
- [x] #5 FR-A002: 相互關係不得產生無效或重複記錄。
- [x] #6 FR-A002: 不得使用真實個人資料或真實人物作為預設角色。
- [x] #7 Automated tests provide evidence for every mapped FR-A002 acceptance criterion, including rejection and failure paths.
- [ ] #8 PRD traceability links FR-A002 to doc-1 and the merged implementation evidence.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
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
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Define a versioned CharacterSeedBundle contract for 12–20 fictional primary characters, full persona/goals, locations, organizations, secrets/initial knowers, knowledge, assets, and directional relationship dimensions.
2. Validate all identifiers and world/location/organization/character/secret references, goal completeness, relationship ranges/self-links/duplicates, and fictional/no-real-person declarations before writes.
3. Add internal-only Convex seed tables/mutation and an atomic offline adapter; ensure a failed or repeated seed produces no partial/duplicate world character state.
4. Add a 12-character fixture plus rejection/rollback tests for every FR-A002 criterion, document the seed contract, run codegen/focused/full gates, then finalize and merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented CharacterSeedBundleV1 for 12–20 adult fictional primary characters with complete persona/public-private goals, valid initial location/organizations, personal secrets/initial knowers, knowledge, owned assets, and six-dimensional directional relationships. Added strict stable-code runtime validation for counts, declarations, duplicates, every cross-reference, per-character completeness, relationship self/duplicate/range rules, missing world, repeated seed, and atomic injected-failure rollback. Added internal-only Convex seed mutation and dedicated character/secret/knowledge/asset/relationship tables. Convex codegen succeeded and uploaded functions/schema to the configured development deployment only. Focused validation: 1 suite/22 tests. Full npm run check: architecture gates, typecheck, lint, 15 suites/138 tests, build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the atomic FR-A002 character seed boundary for 12–20 complete fictional residents, including goals, profiles, locations, organizations, secrets/knowers, knowledge, assets, and non-duplicated directional relationships. Verified all rejection and rollback paths with 22 focused tests, development codegen, and the complete 138-test build gate.
<!-- SECTION:FINAL_SUMMARY:END -->
