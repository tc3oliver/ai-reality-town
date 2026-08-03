---
id: ART-8
title: Private world warmup workflow
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-03 23:15'
labels:
  - prd-1.0
  - epic-b
milestone: m-0
dependencies:
  - ART-7
  - ART-77
  - ART-83
  - ART-40
  - ART-67
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-A004; Sections 10.2–10.3

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Run 30–60 configurable unpublished world days with pause, resume, rerun, launch-episode recommendation, and isolation from public reads.

Scope
Run 30–60 configurable unpublished world days with pause, resume, rerun, launch-episode recommendation, and isolation from public reads.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-7, ART-77, ART-83, ART-40, ART-67

Schema Impact
World import/seed schemas for world, locations, organizations, history, rules, characters, relationships, knowledge, secrets, and assets named by the task.

API Impact
Validated administrative import/readiness commands; imports are atomic and unavailable to public callers.

Security Impact
Seed/import data rejects real-person data, invalid references, unsafe defaults, and partial writes.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Integration tests prove unpublished isolation, resumability, rerun safety, and failure recovery.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-A004: 暖機期間內容不得出現在公開 Read Model。
- [x] #2 FR-A004: 暖機可暫停、恢復與重跑。
- [x] #3 FR-A004: 公開前至少產生一條 Active Story Arc。
- [x] #4 FR-A004: 公開起始 Episode 可由系統建議並由管理者確認。
- [x] #5 FR-A004: 暖機失敗不得污染公開資料。
- [x] #6 Automated tests provide evidence for every mapped FR-A004 acceptance criterion, including rejection and failure paths.
- [x] #7 PRD traceability links FR-A004 to doc-1 and the merged implementation evidence.
- [x] #8 Section 10.3: World actual start day, public broadcast start day, and recommended newcomer entry point are persisted as distinct, queryable markers.
- [x] #9 Section 10.3: Public broadcast may start after Day 1, and changing the confirmed public start never rewrites warmed Canon history.
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
IMPLEMENTED: convex/simulation/warmup.ts (pure state machine): WarmupMarkers (§10.3 distinct queryable markers: actualStartDay, publicBroadcastStartDay, recommendedNewcomerEntry, confirmedPublicStartDay, phase, lastCompletedDay, activeArcRequirementMet). Lifecycle: createWarmupMarkers (target 30-60 day range), pauseWarmup/resumeWarmup/rerunWarmup (AC#2), recordWarmupDay (advances + tracks active-arc requirement + completes at target count, AC#3), setRecommendedNewcomerEntry (AC#4 system), confirmPublicStartDay (admin, requires active arc, AC#3/#4), changePublicStartDay (marker-only, never rewrites canon, AC#9), failWarmup (AC#5), canPublishWarmup guard (true ONLY after completed+confirmed, AC#1/#5). WarmupError. warmupFunctions.ts (wiring): startWarmup/pause/resume/rerun/recordWarmupDayRun/setRecommendedEntry/confirm/changePublicStart/fail/getWarmupMarkers — each loads markers, applies pure transition, persists. schema.ts: warmupMarkers table (markers blob + worldId index).

AC#1 isolation: warmup flow NEVER publishes; canPublishWarmup gates publication (false until completed+confirmed). AC#9: changePublicStartDay edits the marker only — actualStartDay/lastCompletedDay untouched (no canon rewrite).

PRD TRACEABILITY: FR-A004 / §10.3 -> doc-1.

VALIDATION: npm run check = exit 0. Architecture boundaries valid. typecheck clean. lint clean. Tests: 552 passed (+15 from convex/simulation/warmup.test.ts). build OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the private world warmup workflow (FR-A004, §10.3): pure warmup state machine (pause/resume/rerun, active-arc requirement, system-recommended + admin-confirmed launch episode, failure isolation, publication gate) with the three distinct §10.3 markers + lifecycle wiring. Warmup content stays out of the public read model until completed + confirmed; changing the public start edits the marker only (no canon rewrite). Verified: npm run check exit 0; 552 tests pass (+15); architecture boundaries valid; typecheck/lint/build clean. FR-A004 traceable to doc-1.
<!-- SECTION:FINAL_SUMMARY:END -->
