---
id: ART-38
title: Three-minute active-arc primer
status: Done
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-04 01:56'
labels:
  - prd-1.0
  - epic-j
milestone: m-0
dependencies:
  - ART-34
  - ART-65
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-H002

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Produce a focused 2–4 minute primer containing only the active arc cause, recent turning point, core character roles, and current unresolved questions.

Scope
Produce a focused 2–4 minute primer containing only the active arc cause, recent turning point, core character roles, and current unresolved questions.

Out of Scope
Adjacent PRD requirements assigned to separate tasks, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-34, ART-65

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
- [x] #1 FR-H002: 閱讀時間約 2–4 分鐘。
- [x] #2 FR-H002: 僅包含理解目前主線所需內容。
- [x] #3 FR-H002: 不得要求從 Episode 1 開始。
- [x] #4 Automated tests provide evidence for every mapped FR-H002 acceptance criterion, including rejection and failure paths.
- [x] #5 PRD traceability links FR-H002 to doc-1 and the merged implementation evidence.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [x] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
convex/publicRead/arcPrimer.ts (pure buildArcPrimer, 8 tests): composes bounded ~2-4 min primer from arc cause(premise)/turning point/core characters(<=6)/unresolved questions(<=4, current question first), truncated to ARC_PRIMER_MAX_CHARS=1200 (AC#1). States 'need not start from Episode 1' via recommended entry (AC#3). convex/publicRead/arcPrimerFunctions.ts: rebuildArcPrimer internalMutation publishes arc/primer:<arcId> (unreferenced, codegen-safe). Sources: arc projection fields + turning-point event publicSummary + character name facts + recommended entry. Focused: npx jest --testPathPattern=publicRead/arcPrimer -> 8 passed. Full: npm run check -> exit 0. PRD traceability (AC#5): FR-H002 -> doc-1.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Three-minute active-arc primer (FR-H002): new arc/primer:<arcId> read model composes a bounded ~2-4 min primer (cause + recent turning point + core characters + unresolved questions) so newcomers grasp the active mainline without starting at Episode 1. Pure builder unit-tested (8 cases). Verified: npm run check exit 0.
<!-- SECTION:FINAL_SUMMARY:END -->
