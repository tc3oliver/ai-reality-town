---
id: ART-77
title: Mistwood public-world seed content
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 16:19'
updated_date: '2026-08-02 21:24'
labels:
  - prd-1.0
  - epic-b
milestone: m-0
dependencies:
  - ART-5
  - ART-6
  - ART-7
references:
  - 'PR #76 https://github.com/tc3oliver/ai-reality-town/pull/76'
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
modified_files:
  - convex/canon/mistwoodSeed.ts
  - convex/canon/mistwoodSeed.test.ts
  - convex/canon/publicWorldRegistry.ts
  - docs/mistwood-seed.md
  - docs/DEVELOPMENT.md
priority: high
type: feature
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Sections 5.1, 10.3, 13, 17, 18 Milestone 0

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Author the production-intended fictional Mistwood seed: 6–10 locations, 12–20 principal characters, organizations, assets, secrets, knowledge, relationships, history, required tensions, shared misconception, and launchable arc.

Scope
Author the production-intended fictional Mistwood seed: 6–10 locations, 12–20 principal characters, organizations, assets, secrets, knowledge, relationships, history, required tensions, shared misconception, and launchable arc.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-5, ART-6, ART-7

Schema Impact
World import/seed schemas for world, locations, organizations, history, rules, characters, relationships, knowledge, secrets, and assets named by the task.

API Impact
Validated administrative import/readiness commands; imports are atomic and unavailable to public callers.

Security Impact
Seed/import data rejects real-person data, invalid references, unsafe defaults, and partial writes.

Validation Commands
npm run check; run the task-focused automated or documented manual validation and record exact evidence.

Test Requirements
Tests or documented human evaluation cover every acceptance criterion, negative case, retry boundary, and privacy rule applicable to this task.

Documentation Impact
Update relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The seed imports through the validated world/character import path without errors.
- [x] #2 The seed contains 6–10 principal locations and 12–20 fictional principal characters.
- [x] #3 Every required initial-tension threshold passes, including the shared historical misconception and launchable major arc.
- [x] #4 Content-safety review confirms no real person, personal data, or prohibited default content.
- [x] #5 Section 5.1: Mistwood is the only configured public world for MVP; warmup/test worlds cannot appear in the public world index or routing surface.
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
1. Add a versioned production-intended Mistwood seed module that composes the validated WorldConfigurationV1, CharacterSeedBundleV1, and InitialTensionProfileV1 contracts, with 8 connected locations, fictional organizations/history/rules, 12 principal residents, secrets, source-proven knowledge, assets, directional relationships, and all seven readiness thresholds. 2. Add a fail-closed MVP public-world registry that exposes only Mistwood and explicitly excludes fixture/warmup/test world IDs from public indexing and routing. 3. Add an end-to-end seed validation test that runs the real parsers and in-memory atomic import/seed/readiness stores, verifies counts/references/tensions, rerun rejection without partial replacement, public-world isolation, and pre-generation content-safety review. 4. Document seed ownership and validation commands, run focused tests/codegen/full checks, then record PR and merge evidence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Authored Mistwood seed v1 with 8 connected locations, 3 organizations, 3 historical events, 12 complete fictional residents, 12 secrets, source-proven true/false knowledge, 12 assets, directional relationships involving every resident, and a launchable Station Ledger Arc. Added a fail-closed public registry containing only Mistwood; fixture, test, warmup, and unknown routes resolve to null.

Objective evidence: npm test -- --runTestsByPath convex/canon/mistwoodSeed.test.ts passed 5 tests using the real world/character parsers, atomic adapters, readiness evaluator, safety policy, and public resolver. npm run check passed architecture policy, 6 architecture tests, typecheck, lint, 43 suites/369 tests, and Vite build. git diff --check passed; no credentials or deployment changes.

After rebasing onto merged ART-33/ART-21 evidence, npm run check passed again with 44 suites/375 tests. Implementation commit 5157917 was pushed to origin.

Opened PR #76 and enabled merge-commit auto-merge.

Merged implementation evidence: PR #76 merged into main at 2026-08-02T21:19:11Z (merge commit 8ddf6e5).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the production-intended Mistwood world seed and single-public-world registry. Real import paths accept 8 locations and 12 complete fictional residents; all seven initial-tension checks and deterministic safety review pass; duplicate/partial-write and non-public route tests pass. Full verification: 43 suites/369 tests, typecheck, lint, architecture checks, and build.

Implementation PR #76 is merged; all acceptance criteria and Definition of Done items are satisfied.
<!-- SECTION:FINAL_SUMMARY:END -->
