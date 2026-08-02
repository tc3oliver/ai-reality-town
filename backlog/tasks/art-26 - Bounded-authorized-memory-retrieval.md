---
id: ART-26
title: Bounded authorized memory retrieval
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 20:04'
labels:
  - prd-1.0
  - epic-g
milestone: m-0
dependencies:
  - ART-25
  - ART-57
references:
  - 'https://github.com/tc3oliver/ai-reality-town/pull/49'
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-E003

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Rank authorized memories by relevance, importance, recency, emotion, and arc relevance with strict result limits and trace output.

Scope
Rank authorized memories by relevance, importance, recency, emotion, and arc relevance with strict result limits and trace output.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-25, ART-57

Schema Impact
Character Knowledge, Memory, compression, retrieval-trace, or rumor-chain records named by the task.

API Impact
Authorized cognition queries and event-derived update interfaces; no cross-character unrestricted access.

Security Impact
Private knowledge/memory is least-privilege, source-proven, and excluded from public output.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Deterministic ranking and authorization tests cover limits and provenance.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-E003: 每次檢索有數量上限。
- [x] #2 FR-E003: 檢索結果可追蹤。
- [x] #3 FR-E003: 不得將完整歷史放入每次 Prompt。
- [x] #4 FR-E003: 不得返回角色無權取得的記憶。
- [x] #5 Automated tests provide evidence for every mapped FR-E003 acceptance criterion, including rejection and failure paths.
- [x] #6 PRD traceability links FR-E003 to doc-1 and the merged implementation evidence.
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
1. Define a runtime-validated bounded retrieval request and secret-safe trace result, including strict server-owned maximums and deterministic world-time inputs. 2. Implement pure authorization-first ranking over only the target character's memories using semantic token overlap, importance, recency, emotional magnitude, and explicit Story Arc relevance, with deterministic tie-breaking. 3. Expose only an internal cognition query that replays accepted events, verifies character authorization, returns at most the requested bounded selection plus provenance/score traces, and never builds or returns a full-history prompt. 4. Add focused authorization, ranking, limit, trace, malformed input, deterministic tie, and no-full-history tests; update docs/codegen and run full quality gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented authorization-first deterministic retrieval with a server maximum of 12, five-factor ranking, stable tie-breaking, selected-record event provenance and factor traces, internal-only cognition access, and no prompt/full-history response. Convex codegen succeeded. Focused verification passed 5 tests; final npm run check passed architecture, typecheck, lint, 30 suites/294 tests, and build.

Implementation PR #49 merged into main on 2026-08-02T20:00:14Z after Bootstrap and CI checks succeeded.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered FR-E003 through merged PR #49: deterministic five-factor authorized memory retrieval, strict self-access and result bounds, Accepted Event provenance traces, and no full-history or Prompt output. Full pre-merge verification passed 294 tests.
<!-- SECTION:FINAL_SUMMARY:END -->
