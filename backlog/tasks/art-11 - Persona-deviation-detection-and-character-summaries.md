---
id: ART-11
title: Persona deviation detection and character summaries
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-25 12:56'
labels:
  - prd-1.0
  - epic-c
milestone: m-0
dependencies:
  - ART-9
  - ART-25
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-B003

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Flag important actions that depart from persona unless supported by emotion, events, goal conflict, growth, or breakdown, then refresh summaries.

Scope
Flag important actions that depart from persona unless supported by emotion, events, goal conflict, growth, or breakdown, then refresh summaries.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-9, ART-25

Schema Impact
Versioned character, relationship, location, asset, or organization projection records explicitly named by the task.

API Impact
Typed reducer/projection queries for the named domain state; no direct LLM mutation interface.

Security Impact
Private character state and secret-derived changes remain event-authorized and excluded from public reads unless published.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests cover accepted and rejected deviations plus summary refresh.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-B003: 高重要度人格偏離必須被標記。
- [x] #2 FR-B003: 無原因的人格反轉必須被拒絕或送審。
- [x] #3 FR-B003: 角色轉折應更新 Character Summary。
- [x] #4 Automated tests provide evidence for every mapped FR-B003 acceptance criterion, including rejection and failure paths.
- [x] #5 PRD traceability links FR-B003 to doc-1 and the merged implementation evidence.
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pure module `convex/canon/personaDeviation.ts`. `PersonaAnchor` = the seed's structural identity fields (occupation, seeded organizations, traits/values/goals/fear/behaviourRules kept for the summary). Deviation signals are computed from STRUCTURED event data + the current projection only, never by matching persona prose: (a) occupation abandoned away from the anchor, (b) a seeded organization membership dropped, (c) a relationship dimension crossing zero with a swing >= PERSONA_SIGNIFICANT_SWING [reversal class], (d) a same-sign relationship swing >= the same threshold [deviation class]. Justifications map FR-B003's four bullets to structural evidence in the same event: explicit emotion change; a causal accepted event that materially involved the character; a recorded adversarial relationship change toward a co-participant (goal conflict as Canon can witness it); a high-importance character_memory_formed (growth/breakdown marker).
2. Gate in `validateCanon`, driven by a new optional `CanonRuleContext.characterPersonas`. Unsupported REVERSAL -> reject with `UNSUPPORTED_PERSONA_REVERSAL`; unsupported high-importance non-reversal deviation -> `PERSONA_DEVIATION_REVIEW_REQUIRED` (AC#2's two arms; both are stable codes that the FR-K002 review console already surfaces). Superseding remediation events are exempt; an absent persona map leaves the gate inert so existing history and tests are unaffected.
3. Flags and summaries are a DERIVED projection, not a table: `buildCharacterSummaries(initialProjection, events, anchors)` folds accepted events, appending one flag per high-importance deviation (AC#1) and bumping `version` plus appending a turning point when the deviation revises who the character is (AC#3). No schema change, no snapshot version bump.
4. Wire anchors through `createConvexCanonStore.loadCanonRuleContext` (worldCharacters payloads are already loaded there) and expose an internal-only `getCharacterSummaries` query. Summaries carry state-change reasons, which may contain secrets, so they stay internal and out of every public read.
5. Tests in `convex/canon/personaDeviation.test.ts`: flagged-and-committed, rejected reversal, review-required deviation, allowed small change, supported reversal accepted, replay determinism, gate inertness without anchors, and a structural boundary assertion that no publicRead/viewer module imports the summary module. Fault injection to prove non-vacuity.
6. Docs: `docs/persona-deviation.md` design note; update the FR-B003 row of `docs/prd-1.0-closure-matrix.md`. Gate with `npm run check`.
<!-- SECTION:PLAN:END -->
