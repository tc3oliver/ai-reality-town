---
id: ART-35
title: Recap coverage and spoiler validation
status: Done
assignee:
  - '@agent-art35'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-04 07:24'
labels:
  - prd-1.0
  - epic-i
milestone: m-0
dependencies:
  - ART-34
  - ART-66
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-G004

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Detect omitted high-importance events, major relationship changes, turning points, and spoiler violations before publication.

Scope
Detect omitted high-importance events, major relationship changes, turning points, and spoiler violations before publication.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-34, ART-66

Schema Impact
Episode, recap, machine-summary, coverage, or derived-content records named by the task, each linked to accepted source events.

API Impact
Editorial generation/validation interfaces and publication-candidate outputs; no direct Canon mutation.

Security Impact
Spoilers and unsafe content are withheld through field visibility and publication gates.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests cover required inclusions, valid exclusions, and spoiler failures.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-G004: 所有高重要度 Event 均被摘要涵蓋或明確排除。
- [x] #2 FR-G004: 重大關係變化必須被提及。
- [x] #3 FR-G004: Arc Turning Point 必須被提及。
- [x] #4 FR-G004: Spoiler Violation 必須被偵測。
- [x] #5 Automated tests provide evidence for every mapped FR-G004 acceptance criterion, including rejection and failure paths.
- [x] #6 PRD traceability links FR-G004 to doc-1 and the merged implementation evidence.
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
ART-35 — Recap coverage and spoiler validation (FR-G004). Pure pre-release coverage gate over accepted events plus the recap/episode candidate that is about to go live.

1. New pure module convex/recaps/coverageValidation.ts (editorial module root; no Convex imports, no canon mutation):
   - CoverageSourceEvent { eventId, worldDay, sequenceNumber, importance, turningPointArcIds, relationshipChanges[], publicFactIds[], privateFactIds[] } — the accepted-event view the gate needs, derived by the wiring layer (same idiom as EpisodeSourceEvent).
   - CoverageRelationshipChange { changeId, sourceCharacterId, targetCharacterId, magnitude, visibility }, with deriveRelationshipChangeId(eventId, index) and relationshipChangeMagnitude(change) summing the six delta fields.
   - CoverageCandidate { contentRef, worldDay, citedEventIds, mentionedRelationshipChangeIds, mentionedFactIds, declaredExclusions[{ eventId, reason }], text } — the content about to go live.
   - HIGH_IMPORTANCE_THRESHOLD reused from ../editorial/episode; MAJOR_RELATIONSHIP_MAGNITUDE exported.
   - validateRecapCoverage(candidate, sources, unreleasedSecretValues) -> CoverageReport { schemaVersion, worldId, contentRef, worldDay, coveredEventIds, excludedEventIds, findings[], releasable } — non-throwing detection so the report can also feed the FR-M002 Recap Coverage / Spoiler Violation metrics.
   - Finding codes: COVERAGE_HIGH_IMPORTANCE_OMITTED (AC#1: a high-importance event neither cited nor explicitly excluded with a non-empty reason), COVERAGE_RELATIONSHIP_CHANGE_OMITTED (AC#2: a major public relationship change is not mentioned), COVERAGE_TURNING_POINT_OMITTED (AC#3: an arc turning-point event is not cited), SPOILER_FUTURE_EVENT / SPOILER_PRIVATE_RELATIONSHIP / SPOILER_PRIVATE_FACT / SPOILER_UNRELEASED_SECRET (AC#4).
   - assertRecapCoverage(...) throws RecapCoverageError on the first blocking finding — hard-gate idiom matching validateDailyEpisode and validateRecapFormats.

2. Wiring convex/recaps/coverageValidationFunctions.ts:
   - Derive CoverageSourceEvent rows from canonEvents (rowToAcceptedEvent) plus storyArcEventClassifications (importance = max membership importance; turningPointArcIds = memberships whose role is turning_point), and secret values from worldSecrets.
   - getEpisodeCoverageReport (internalQuery): side-effect-free report for a stored dailyEpisode.
   - validateEpisodeCoverageGate (internalMutation): the editorial gate — computes the report and only performs the publication generated -> validated transition (existing transitionPublication primitive, full audit) when the report is releasable; otherwise throws RecapCoverageError listing the blocking codes. Zero canon writes; existing publication lifecycle behaviour unchanged.

3. Tests convex/recaps/coverageValidation.test.ts: clean pass path; each AC failure path (omitted high-importance event, accepted explicit exclusion, exclusion without a reason rejected, omitted major public relationship change, minor change not required, omitted turning point, future-event spoiler, private relationship spoiler, private fact spoiler, secret leak); report shape and determinism; assert wrapper throws.

4. Docs: docs/recap-coverage-validation.md plus a DEVELOPMENT.md index entry; PRD traceability FR-G004 -> doc-1.

5. npm run check green; commit, push, PR, auto-merge, task -> In Review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented FR-G004 as a pure pre-release coverage gate plus editorial wiring.

convex/recaps/coverageValidation.ts (pure; no Convex imports, no clock, no randomness, no Canon write):
- CoverageSourceEvent — derived view of one Accepted Event (worldDay, highest Story Arc membership importance, turningPointArcIds, relationship movements with visibility+magnitude, public/private fact IDs).
- CoverageCandidate — the content about to go public (citedEventIds, mentionedRelationshipChangeIds, mentionedFactIds, declaredExclusions with reasons, public text, released worldDay, coverageFromWorldDay).
- validateRecapCoverage() returns a CoverageReport and never throws on a violation, so the same result gates release and can feed the FR-M002 Recap Coverage / Spoiler Violation metrics. Only malformed input throws. assertRecapCoverage() is the hard-gate wrapper carrying every finding on RecapCoverageError.
- Findings: COVERAGE_HIGH_IMPORTANCE_OMITTED and COVERAGE_EXCLUSION_UNJUSTIFIED (AC#1), COVERAGE_RELATIONSHIP_CHANGE_OMITTED (AC#2), COVERAGE_TURNING_POINT_OMITTED (AC#3), SPOILER_FUTURE_EVENT / SPOILER_PRIVATE_RELATIONSHIP / SPOILER_PRIVATE_FACT / SPOILER_UNRELEASED_SECRET (AC#4), plus COVERAGE_SOURCE_NOT_ACCEPTED for untraceable citations.

Decisions:
- High importance reuses the existing HIGH_IMPORTANCE_THRESHOLD (0.7) from convex/editorial/episode.ts rather than introducing a second threshold.
- Major relationship change = largest absolute single-dimension delta >= MAJOR_RELATIONSHIP_DELTA (20) on the canon -100..100 scale; omitted additive v1 dimensions count as zero, matching the reducer.
- Only PUBLIC major relationship changes carry a coverage obligation; mentioning a private movement is a spoiler violation instead. This keeps AC#2 and AC#4 from contradicting each other.
- Events before coverageFromWorldDay are prior context: citable, never required. A daily Episode sets coverageFromWorldDay = worldDay; arc/season recaps can widen the window.
- The module lives under convex/recaps (editorial module root), so importing ../editorial/episode stays inside one architecture module; convex/viewer/spoilerMode.ts was deliberately NOT imported because editorial may not depend on viewer.

convex/recaps/coverageValidationFunctions.ts:
- Derives sources from canonEvents (rowToAcceptedEvent) plus storyArcEventClassifications (importance = max membership importance; turningPointArcIds = memberships whose role is turning_point) and secret text from worldSecrets.
- Reads are bounded: the released world day by index, plus individual by_world_and_sequence lookups for any event the candidate references outside that day, so a forward citation is reported as SPOILER_FUTURE_EVENT rather than an unresolved reference.
- getEpisodeCoverageReport (internalQuery) is side-effect free.
- validateEpisodeCoverageGate (internalMutation) is the gate the editorial path calls in place of a bare validate transition: it advances the current publication record generated -> validated through the existing transitionPublication primitive (full audit) only when the report is releasable, and otherwise throws RecapCoverageError with every blocking finding and leaves the record untouched. Zero Canon writes; existing publication lifecycle behaviour unchanged.

Verification:
- Focused: NODE_OPTIONS=--experimental-vm-modules npx jest --runTestsByPath convex/recaps/coverageValidation.test.ts -> 35/35 passed.
- Full: npm run check -> architecture boundaries valid (policy v1, 11 modules), architecture boundary tests, tsc --noEmit clean, eslint clean, jest 71 suites / 716 tests passed, tsc && vite build succeeded.
- convex/_generated/api.d.ts updated by hand for the two new modules because npx convex codegen requires a CONVEX_DEPLOYMENT that is not available offline; typecheck and build confirm the generated surface is consistent.

Post-merge verification: after merging origin/main (PR #114, ART-69), npm run check re-run green — architecture boundaries valid (policy v1, 11 modules), typecheck clean, lint clean, jest 72 suites / 731 tests passed, build succeeded.

Merged implementation evidence: PR #115 (https://github.com/tc3oliver/ai-reality-town/pull/115) merged into main at 2026-08-04T07:10:26Z as f11e30fff9bde31f873ed507e9bd431bd62aba08. Both required CI checks passed on the merge candidate: 'Offline checks (typecheck, lint, test, build)' and 'Autonomous control plane + offline quality'. This links FR-G004 to PRD doc-1 and the accepted implementation, completing AC#6 and DoD #1, #13, and #14.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered FR-G004 recap coverage and spoiler validation as a pure, unit-tested pre-release gate (convex/recaps/coverageValidation.ts) plus editorial wiring (convex/recaps/coverageValidationFunctions.ts).

Given the Accepted Events of a world day and the recap or Episode about to become public, the gate reports: high-importance events that are neither covered nor explicitly excluded with a reason (AC#1), unmentioned major public relationship changes at or above a 20-point single-dimension delta (AC#2), unmentioned Story Arc turning points (AC#3), and four classes of spoiler violation — future world days, private relationship movements, non-public facts, and unreleased Canon secret text (AC#4). The report is data, not an exception, so it can also feed the FR-M002 Recap Coverage and Spoiler Violation metrics; assertRecapCoverage is the hard-gate wrapper.

validateEpisodeCoverageGate is the internal mutation the editorial publication path calls in place of a bare validate transition: it advances the current publication record generated -> validated only when the report is releasable, and otherwise throws with every blocking finding. It performs zero Canon writes.

Verified: focused suite convex/recaps/coverageValidation.test.ts 35/35 passed (clean pass path plus a rejection path for every acceptance criterion); npm run check green end to end — architecture boundaries valid (policy v1, 11 modules), typecheck clean, lint clean, jest 71 suites / 716 tests passed, build succeeded. Documented in docs/recap-coverage-validation.md and indexed from docs/DEVELOPMENT.md. PRD traceability: FR-G004 -> doc-1.
<!-- SECTION:FINAL_SUMMARY:END -->
