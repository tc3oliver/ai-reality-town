---
id: ART-24
title: Source-proven character knowledge ledger
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 19:37'
labels:
  - prd-1.0
  - epic-g
milestone: m-0
dependencies:
  - ART-13
  - ART-16
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-E001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Store event-derived beliefs with source, truth status, confidence, time, correction, and shareability, enforcing character authorization.

Scope
Store event-derived beliefs with source, truth status, confidence, time, correction, and shareability, enforcing character authorization.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-13, ART-16

Schema Impact
Character Knowledge, Memory, compression, retrieval-trace, or rumor-chain records named by the task.

API Impact
Authorized cognition queries and event-derived update interfaces; no cross-character unrestricted access.

Security Impact
Private knowledge/memory is least-privilege, source-proven, and excluded from public output.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests cover all allowed sources, corrections, permissions, and replay.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-E001: 每筆 Knowledge 具有來源。
- [x] #2 FR-E001: 每筆 Knowledge 標記 Truth Status。
- [x] #3 FR-E001: 角色不得存取未授權資訊。
- [x] #4 FR-E001: Knowledge 更新必須由 Event 產生。
- [x] #5 Automated tests provide evidence for every mapped FR-E001 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-E001 to doc-1 and the merged implementation evidence.
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
1. Extend the additive v1 knowledge event payload with belief value, truth status, confidence, shareability, optional correction target, and source provenance while safely normalizing legacy events. 2. Replace the fact-ID list projection with immutable per-character knowledge records derived only by the reducer, preserving learned time and correction links through replay/snapshots. 3. Enforce allowed sources, causal-source existence, confidence bounds, correction ownership/identity, and least-privilege character/admin reads through internal APIs. 4. Add tests for all six source types, truth states, corrections, unauthorized cross-character access, event-only updates, backward compatibility, and replay; document and run full gates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented an event-derived knowledge ledger with all six source types, belief value, truth status, bounded confidence, learned world time, shareability, immutable correction chains, and safe additive v1 normalization. Initial seed knowledge now also retains source provenance. Internal authorization permits self/operations reads and rejects cross-character access; no public query exists. Duplicate corrections in one event and invalid correction targets are rejected. Convex codegen succeeded. Focused verification passed 79 tests; final npm run check passed architecture, typecheck, expanded knowledge lint coverage, 25 suites/262 tests, and build.

Implementation commit 47e5363 pushed on feat/ART-24-knowledge-ledger.

Merged current main/ART-10 into the feature branch, preserving both relationship history and knowledge ledger behavior. Combined npm run check passed architecture, typecheck, lint, build, and 26 suites/266 tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-E001 source-proven knowledge projection, corrections, seed provenance, least-privilege internal reads, replay/snapshot support, and validation failure paths. Full verification passed 262 tests; merged PR evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
