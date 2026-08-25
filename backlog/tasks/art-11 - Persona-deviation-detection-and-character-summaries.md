---
id: ART-11
title: Persona deviation detection and character summaries
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-25 13:06'
labels:
  - prd-1.0
  - epic-c
milestone: m-0
dependencies:
  - ART-9
  - ART-25
references:
  - 'https://github.com/tc3oliver/ai-reality-town/pull/202'
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
- [x] #14 Pull request is merged or explicitly blocked
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered FR-B003 as a structural gate plus a derived projection. PR #202 (auto-merge armed).

DESIGN DECISIONS AND WHAT WAS REJECTED
1. Detection reads NO persona prose. Matching `personalityTraits`/`values`/`behaviorRules` against an event's `reason`/`publicSummary` was rejected: it is a second unversioned classifier that cannot be replayed, drifts when a seed is reworded, and judges strings authored by the very provider under judgement. `docs/proposed-event-review.md` already bans exactly this for rejection reasons. Signals are instead comparisons between values the world holds: seeded occupation and organizationIds vs the FR-B001 projection, and FR-B002 relationship state vs the proposal's delta.
2. No self-declared deviation field on the proposal. That would make AC#1 a claim rather than a guarantee; detection is computed FROM the proposal, never read OFF it.
3. A reversal cannot supply its own conflict. A trust reversal IS trust going down, so the goal-conflict support must come from a DIFFERENT state change or every reversal would clear itself.
4. A cited cause must be material. `causedByEventIds` naming any accepted event is a bar a provider clears trivially; the cause must have had the character as a participant. `knownEventParticipantIds` is built in `commitProposedEvent` from events already loaded, so it costs no extra read.
5. Two refusal codes because AC#2 offers two remedies: `UNSUPPORTED_PERSONA_REVERSAL` (reject) and `PERSONA_DEVIATION_REVIEW_REQUIRED` (review). Nothing unsupported enters Canon either way; both are stable SCREAMING_SNAKE_CASE so the FR-K002 console reports them verbatim and no second review queue was needed.
6. Deviating from the task's boilerplate Schema Impact line: NO new table and NO snapshot version bump. A flag is a pure function of (accepted event, prior projection, seeded anchor); a stored copy could disagree with Canon and would need back-filling onto all history.
7. Turning point is strictly narrower than flag (reversal, or a growth/breakdown marker), so ordinary drama does not refresh every summary and `version` keeps its meaning.
8. Gate runs LAST in `validateCanon`; exempts superseding remediations and worlds with no seeded anchors.

STATED LIMITATION (not faked, not hidden): this cannot detect a character betraying a `behaviorRule` in dialogue alone. Canon records no such thing and inventing it would assert a world fact nobody accepted. Documented in the module header and `docs/persona-deviation.md` §1.

FILES
convex/canon/personaDeviation.ts (new, pure); validators.ts (`validatePersonaConsistency`); commit.ts (anchors + causal participants into CanonRuleContext); model.ts (2 optional CanonRuleContext fields); queries.ts (`getCharacterSummaries`, internalQuery); shared/errors.ts (2 codes); docs/persona-deviation.md; docs/DEVELOPMENT.md; docs/prd-1.0-closure-matrix.md.

VERIFICATION
npm run check -> exit 0. check:architecture ok, test:architecture ok, check:asset-licenses ok, test:asset-licenses ok, tsc --noEmit clean, lint clean, 170 suites / 2631 tests (2626 passed, 5 skipped) after merging origin/main (ART-27); 167 suites / 2599 tests at the ART-11 commit itself. Vite build ok.
Focused: NODE_OPTIONS=--experimental-vm-modules npx jest --runTestsByPath convex/canon/personaDeviation.test.ts convex/canon/personaDeviation.boundary.test.ts -> 2 suites / 28 tests passed.

FAULT INJECTION (temp-dir backup + restore, never git checkout) proving non-vacuity:
- every outcome forced to 'flag' -> 6 tests failed
- every flag forced to a turning point -> 2 failed
- self-justification exclusion removed -> 10 failed
- superseding-remediation exemption removed -> 1 failed
- cause materiality dropped to 'any cited event' -> 1 failed
- gate's anchors withheld from validateCanon -> 5 failed
- CharacterSummary imported into convex/publicRead/conversationState.ts -> 1 failed (boundary)
- swing threshold 40 -> 1 -> 3 failed in the long-run harness, proving the gate is live in the real pipeline
All restored; full check green afterwards.

SECURITY: summaries are internal only. The anchor carries occupation/organizationIds/personalityTraits/values and deliberately excludes privateProfile, privateGoal, fear and behaviorRules. Refusal details carry structured signals and never a `reason` string. `personaDeviation.boundary.test.ts` reads every file under convex/publicRead, convex/viewer and src and fails on any persona symbol, asserting over the file list so a new public file is covered automatically.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered FR-B003 via PR #202. Canon detects a major action departing from a seeded persona structurally — comparing projected occupation, seeded organization memberships and FR-B002 relationship polarity against their anchors, never matching persona prose, which was rejected because it would judge strings written by the provider under judgement. High-importance deviations are flagged (AC#1); an unsupported reversal is rejected with UNSUPPORTED_PERSONA_REVERSAL and an unsupported same-direction deviation is refused with PERSONA_DEVIATION_REVIEW_REQUIRED, both stable codes the FR-K002 console already reports (AC#2); a turning point bumps a derived CharacterSummary's version (AC#3). Flags and summaries are a projection, not a table: no schema change, no snapshot version bump, and summaries stay internal.

Verified: npm run check exit 0 — architecture ok, asset licences ok, tsc --noEmit clean, lint clean, 170 suites / 2631 tests (2626 passed, 5 skipped), Vite build ok. Focused personaDeviation.test.ts 23/23 and personaDeviation.boundary.test.ts 5/5 (AC#4 — every criterion including the reject and review paths). Eight fault injections proved the tests non-vacuous, failing 6/2/10/1/1/5/1/3 tests respectively; the threshold injection failed three long-run-harness tests, showing the gate is live in the real pipeline rather than only in unit tests. AC#5: docs/prd-1.0-closure-matrix.md FR-B003 row moved Deferred P1 -> P1 delivered, citing both test files and docs/persona-deviation.md, with doc-1 named as the requirement source.
<!-- SECTION:FINAL_SUMMARY:END -->
