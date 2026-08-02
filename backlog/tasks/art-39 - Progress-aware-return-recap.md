---
id: ART-39
title: Device-aware return recap
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 17:00'
labels:
  - prd-1.0
  - epic-j
milestone: m-0
dependencies:
  - ART-38
  - ART-46
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-H004; Section 13.12

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Produce a concise return recap from last-viewed progress that prioritizes followed content when available, major changes, vote effects, and a recommended continuation point, including anonymous device progress.

Scope
Produce a concise return recap from last-viewed progress that prioritizes followed content when available, major changes, vote effects, and a recommended continuation point, including anonymous device progress.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-38, ART-46

Schema Impact
Current-situation, primer, entry-point, return-recap, viewer-progress, or spoiler-compatibility contracts named by the task.

API Impact
Cached onboarding/recap read contracts; visitor reads never trigger generation.

Security Impact
Viewer progress is isolated by viewer/device and recap visibility obeys spoiler/publication rules.

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
- [ ] #1 FR-H004: 不逐日完整列出所有事件。
- [ ] #2 FR-H004: 優先顯示使用者追蹤內容。
- [ ] #3 FR-H004: 無登入使用者可使用裝置層級進度。
- [ ] #4 Automated tests provide evidence for every mapped FR-H004 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-H004 to doc-1 and the merged implementation evidence.
- [ ] #6 Section 13.12: Viewer Progress records an isolated viewer-or-device identity, worldId, lastViewedEpisodeId, followedCharacterIds, followedArcIds, spoilerMode, and updatedAt with runtime validation.
- [ ] #7 Anonymous device progress and authenticated progress cannot be read or modified across identities; merging or migration is explicit, authorized, and lossless.
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
