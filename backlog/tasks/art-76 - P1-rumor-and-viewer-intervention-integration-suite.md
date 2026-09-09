---
id: ART-76
title: P1 rumor and viewer-intervention integration suite
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:53'
updated_date: '2026-09-09 14:30'
labels:
  - prd-1.0
  - epic-p
milestone: m-0
dependencies:
  - ART-28
  - ART-45
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 19.2 cases 2 and 5

Problem / Context
P1 rumor and viewer-intervention scenarios need verification without blocking the P0 gate.

Goal
Verify multi-person rumor propagation and safe viewer-vote event injection.

Scope
Rumor provenance/version/belief divergence and winning environmental-event injection through safety, structural, and Canon validation.

Out of Scope
P0 Canon/cognition scenarios, direct character control, and production deployment.

Dependencies
ART-28, ART-45

Schema Impact
No new production domain schema unless explicitly named; owns deterministic fixtures, reports, rubrics, and verification evidence.

API Impact
Test harnesses consume documented domain/public interfaces without adding production mutation endpoints.

Security Impact
Test evidence minimizes sensitive data and never bypasses Canon, safety, authorization, or publication controls.

Validation Commands
npm run check; run the focused rumor/voting integration command and record its exact result.

Test Requirements
Both scenarios prove safety, provenance, idempotency, and Canon validation.

Documentation Impact
Update integration-test and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A multi-character rumor preserves origin, chain, versions, credibility, truth status, and divergent beliefs.
- [x] #2 A winning environmental vote enters only as a Proposed Event and passes safety, structural, and Canon validation.
- [x] #3 Neither scenario controls a character result or turns rumor into Canon.
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
1. Read PRD 19.2 cases 2 and 5 verbatim and inventory what the eight covered scenarios already do.
2. Find what the existing rumor and vote suites do NOT cover: for case 2, the four properties asked of one log; for case 5, the FR-L003 classifier, which is only called from Convex handlers that never run under jest.
3. Write one suite per case, in the module that owns the domain, driving production functions end to end with only the Canon store swapped.
4. Inject into PRODUCTION code to prove the suites would catch a regression — the only evidence a test-only task can offer.
5. npm run check, npm run e2e, closure matrix row, docs/testing/p1-integration-suites.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed after PR merged; npm run check and npm run e2e green on the merged branch.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Covered PRD §19.2's last two integration scenarios, each missing something specific rather than missing generally. Case 2 (謠言經多人傳播): rumor coverage was thorough but rule-by-rule; no suite drove one rumor through four people and then asked provenance, version divergence, belief divergence and containment OF THE SAME accepted log — asked separately each can be true of a different world. Case 5 (投票事件安全注入): the part neither existing suite covered is the part the scenario names first, SAFETY. The FR-L003 classifier sits at two points on the path and both are called only from Convex handlers, whose bodies never execute under jest; both underlying functions are pure and exported, so the new suite drives all ten links from selectDailyCandidates to replayWorldEvents without a handler. Both halves of 「安全注入」 are asserted: the winner reaches Canon, and nothing else does. No production logic was added, so the evidence is six injections INTO production code, each turning a named test in the new suites red; a seventh is recorded as rejected because it failed to compile and reported Tests: 0 total, which is not evidence. Verified: npm run check exit 0 (4208 passed, 246 suites); npm run e2e 88 passed; the closure matrix's §19.2 row now reads all ten scenarios covered; docs/testing/p1-integration-suites.md; PR #259 merged.
<!-- SECTION:FINAL_SUMMARY:END -->
