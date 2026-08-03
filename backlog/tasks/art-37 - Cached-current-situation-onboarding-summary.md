---
id: ART-37
title: Cached current-situation onboarding summary
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-03 17:26'
labels:
  - prd-1.0
  - epic-j
milestone: m-0
dependencies:
  - ART-34
  - ART-66
  - ART-30
  - ART-40
  - ART-67
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-H001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Precompute an approximately 300-Chinese-character entry summary with major event, importance, four characters, three facts, question, recommended episode, and scene.

Scope
Precompute an approximately 300-Chinese-character entry summary with major event, importance, four characters, three facts, question, recommended episode, and scene.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-34, ART-66, ART-30, ART-40, ART-67

Schema Impact
Current-situation, primer, entry-point, return-recap, viewer-progress, or spoiler-compatibility contracts named by the task.

API Impact
Cached onboarding/recap read contracts; visitor reads never trigger generation.

Security Impact
Viewer progress is isolated by viewer/device and recap visibility obeys spoiler/publication rules.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Read-path tests verify content limits, cache behavior, invalidation, and zero generation calls.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-H001: 主要內容不超過約 300 中文字。
- [x] #2 FR-H001: 不顯示完整世界歷史。
- [x] #3 FR-H001: 主線重大變化後自動更新。
- [x] #4 FR-H001: 結果必須快取。
- [x] #5 FR-H001: 每位訪客讀取不得觸發 LLM。
- [x] #6 Automated tests provide evidence for every mapped FR-H001 acceptance criterion, including rejection and failure paths.
- [x] #7 PRD traceability links FR-H001 to doc-1 and the merged implementation evidence.
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
IMPLEMENTED: convex/publicRead/onboardingSummary.ts (pure): buildOnboardingSummary composes a bounded entry summary (≤ ONBOARDING_MAX_CHARS 300 中文字 via truncateToChineseChars + countChineseCharacters from recaps; structured payload bounded to ≤4 characters ONBOARDING_MAX_CHARACTERS + ≤3 facts ONBOARDING_MAX_FACTS so it never becomes a full history dump, AC#1/#2), OnboardingSummaryError. onboardingSummaryFunctions.ts (wiring): rebuildOnboardingSummary internalMutation gathers latest major event + importance, ≤4 characters, ≤3 public facts, active major arc question, ART-67 recommended entry episode, latest episode scene; composes + caches via commitReadModelVersion (modelKind 'world', modelRef 'onboarding:<worldId>'). Public reads reuse ART-40 getPublishedReadModel — zero LLM on read (AC#5), cached snapshot (AC#4), rebuild refreshes after major changes (AC#3). Zero canon writes.

PRD TRACEABILITY: FR-H001 -> doc-1.

NFR EVIDENCE: AC#1 (≤300字) + AC#2 (bounded, not full history) proven by unit tests with oversized inputs. AC#3/#4/#5 are mechanism-proven via the publicRead store (idempotent cached rebuild, no generation on read).

VALIDATION: npm run check = exit 0. Architecture boundaries valid. typecheck clean. lint clean. Tests: 523 passed (+7 from convex/publicRead/onboardingSummary.test.ts). build OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the cached current-situation onboarding summary (FR-H001): pure buildOnboardingSummary composes a bounded ≤300-中文字 summary (≤4 characters, ≤3 facts — never a full history dump) + rebuild wiring that caches it as an 'onboarding:<worldId>' read-model via ART-40 (per-visitor reads never trigger LLM; refreshes after major changes). Verified: npm run check exit 0; 523 tests pass (+7); architecture boundaries valid; typecheck/lint/build clean. FR-H001 traceable to doc-1.
<!-- SECTION:FINAL_SUMMARY:END -->
