---
id: ART-34
title: Incremental recap pyramid
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 21:32'
labels:
  - prd-1.0
  - epic-i
milestone: m-0
dependencies:
  - ART-33
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
modified_files:
  - convex/recaps/model.ts
  - convex/recaps/model.test.ts
  - convex/recaps/functions.ts
  - convex/recaps/schema.ts
  - convex/schema.ts
  - convex/_generated/api.d.ts
  - docs/incremental-recap-pyramid.md
  - docs/DEVELOPMENT.md
priority: high
type: feature
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-G002; Section 13.11

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Maintain the traceable Raw Event to Scene, Episode, Arc, Season, and Viewer summary pyramid incrementally from prior summaries plus new accepted events.

Scope
Maintain the traceable Raw Event to Scene, Episode, Arc, Season, and Viewer summary pyramid incrementally from prior summaries plus new accepted events.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-33

Schema Impact
Episode, recap, machine-summary, coverage, or derived-content records named by the task, each linked to accepted source events.

API Impact
Editorial generation/validation interfaces and publication-candidate outputs; no direct Canon mutation.

Security Impact
Spoilers and unsafe content are withheld through field visibility and publication gates.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every mapped PRD acceptance condition, negative case, and failure boundary.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-G002: 高層摘要可追蹤來源事件。
- [x] #2 FR-G002: 更新時優先使用前一版摘要與新增事件。
- [x] #3 FR-G002: 不得每次讀取完整世界歷史。
- [x] #4 FR-G002: 摘要可重新生成，但不得改變 Canon。
- [x] #5 Automated tests provide evidence for every mapped FR-G002 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-G002 to doc-1 and the merged implementation evidence.
- [x] #7 Section 13.11: Recap Snapshot records id, worldId, recapType, targetId, sourceFromEventId, sourceToEventId, content, structuredPayload, version, and generatedAt; its source range resolves only to Accepted Events.
- [x] #8 Recap Snapshot regeneration creates a new version, preserves prior versions for audit, and never mutates Canon.
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
1. Replace the placeholder recap model with a strict Recap Snapshot v1 contract for scene, episode, arc, season, and viewer-context layers, containing every Section 13.11 field plus exact Accepted Event IDs/sequences and prior-version provenance. 2. Implement deterministic incremental generation from only the latest prior snapshot plus newly accepted contiguous Events; validate source ranges against the supplied Accepted Event window and reject proposed, foreign, gapped, or overlapping ranges. 3. Add append-only internal persistence that queries canonEvents strictly after the prior source endpoint, creates monotonically versioned recap rows, supports explicit regeneration as a new audit version, and never writes Canon. 4. Add tests proving cross-layer provenance, bounded incremental reads, accepted-only source ranges, preserved regeneration history, idempotency/failure paths, and Canon isolation; update docs, codegen, and full verification.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented strict Recap Snapshot v1 for scene, episode, arc, season, and viewer_context with every Section 13.11 field, ordered Accepted Event provenance, sequence bounds, prior version, and incremental/regeneration metadata. Normal updates query only the contiguous range after the latest snapshot; explicit regeneration appends a new version over the prior accepted range.

Validation rejects proposed-shaped, foreign, duplicate, gapped, overlapping, forged, and mismatched sources. Snapshot ID reuse with different inputs is an explicit conflict. Persistence is internal-only, append-only in recapSnapshots, and does not import Canon commit/reducer paths. Verification: focused Jest 9/9; Convex codegen; npm run check passed architecture, typecheck, lint, 45 suites/384 tests, and build; git diff --check passed.

Post-rebase verification and push evidence: commit 8d40aa0 is published at origin/feat/ART-34-recap-pyramid; npm run check passed after rebasing onto merged ART-22.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the traceable incremental Raw Event→Scene→Episode→Arc→Season→Viewer recap pyramid and full Recap Snapshot contract. Updates use only prior summary plus bounded new Accepted Events; regeneration preserves old versions and cannot mutate Canon. Focused tests and full 384-test/typecheck/lint/build checks pass; merged traceability evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
