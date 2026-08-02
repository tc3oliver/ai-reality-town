---
id: ART-33
title: Accepted-event daily episodes
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 21:09'
labels:
  - prd-1.0
  - epic-i
milestone: m-0
dependencies:
  - ART-13
  - ART-29
  - ART-65
  - ART-55
references:
  - 'PR #74 https://github.com/tc3oliver/ai-reality-town/pull/74'
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
modified_files:
  - convex/editorial/episode.ts
  - convex/editorial/episodeFunctions.ts
  - convex/editorial/episode.test.ts
  - convex/editorial/schema.ts
  - convex/schema.ts
  - convex/_generated/api.d.ts
  - package.json
  - docs/accepted-event-episodes.md
  - docs/DEVELOPMENT.md
priority: high
type: feature
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-G001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Generate one editorial episode per world day with required metadata, scenes, relationship/question changes, arcs, characters, and tease solely from accepted events.

Scope
Generate one editorial episode per world day with required metadata, scenes, relationship/question changes, arcs, characters, and tease solely from accepted events.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-13, ART-29, ART-65, ART-55

Schema Impact
Episode, recap, machine-summary, coverage, or derived-content records named by the task, each linked to accepted source events.

API Impact
Editorial generation/validation interfaces and publication-candidate outputs; no direct Canon mutation.

Security Impact
Spoilers and unsafe content are withheld through field visibility and publication gates.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Integration tests cover provenance, coverage, spoiler safety, and failure isolation.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-G001: Episode 只能使用 Accepted Event。
- [x] #2 FR-G001: 高重要度事件必須被涵蓋。
- [x] #3 FR-G001: 不得將未公開 Canon Secret 誤放入公開內容。
- [x] #4 FR-G001: Episode 生成失敗不影響 Canon State。
- [x] #5 Automated tests provide evidence for every mapped FR-G001 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-G001 to doc-1 and the merged implementation evidence.
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
- [x] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Define a versioned daily Episode candidate contract with episode number/title/headline/one-line summary, 3-5 key scenes, relationship changes, new/resolved questions, Arc/character IDs, tease, and immutable source Event IDs. 2. Build the editorial input exclusively from one world's Accepted Events for one day; require every high-importance event to appear and validate all Episode/scene references against that accepted set. 3. Enforce visibility-safe public facts and post-generation safety labels so private/secret facts cannot enter public fields; persist editorial failure separately and leave Canon untouched. 4. Add one-episode-per-day idempotency, provenance, high-importance coverage, secret/spoiler rejection, generation/safety failure isolation tests and docs; run codegen and full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented a versioned, idempotent one-Episode-per-world-day editorial projection sourced exclusively from accepted canonEvents. Validation enforces exact source-reference provenance, public Fact visibility, complete >=0.7 importance coverage across 3-5 scenes, and unpublished-secret exclusion. Post-generation safety scans every public Episode field; withheld output stores no raw Episode. Generation/validation failures persist only an editorial failure record and never invoke Canon commit/reducer paths.

Verification: npm test -- --runTestsByPath convex/editorial/episode.test.ts (1 suite, 6 tests passed); npx convex codegen (passed); npm run check (architecture boundaries, 6 architecture tests, typecheck, lint, 42 suites/364 tests, and Vite build all passed). git diff --check passed. No credentials added.

Implementation committed as b41b9eb, pushed, and opened as PR #74; auto-merge enabled.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added accepted-event daily Episode generation with full FR-G001 metadata, exact Accepted Event provenance, high-importance coverage, secret/safety gates, quiet-day handling, idempotency, and Canon-isolated failure records. Focused tests and the complete 364-test/typecheck/lint/build check pass; merge evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
