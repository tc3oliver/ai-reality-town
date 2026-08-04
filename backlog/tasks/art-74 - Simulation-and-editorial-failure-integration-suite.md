---
id: ART-74
title: Simulation and editorial failure integration suite
status: In Progress
assignee:
  - '@oliver'
created_date: '2026-08-02 15:43'
updated_date: '2026-08-04 10:04'
labels:
  - prd-1.0
  - epic-p
milestone: m-0
dependencies:
  - ART-83
  - ART-33
  - ART-50
  - ART-40
  - ART-72
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 19.2 cases 6–10

Problem / Context
PRD 1.0 requires this capability as an independently reviewable delivery unit.

Goal
Verify provider retry, duplicate-event prevention, accepted-event-only episodes, correction-driven read-model refresh, and public-read availability during simulation failure.

Scope
Verify provider retry, duplicate-event prevention, accepted-event-only episodes, correction-driven read-model refresh, and public-read availability during simulation failure.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-83, ART-33, ART-50, ART-40, ART-72

Schema Impact
No new production domain schema unless explicitly named; owns deterministic fixtures, reports, rubrics, and verification evidence.

API Impact
Test harnesses consume documented domain/public interfaces without adding production mutation endpoints.

Security Impact
Test evidence minimizes sensitive data and never bypasses Canon, safety, authorization, or publication controls.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every acceptance criterion and all stated negative or failure cases.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Provider failure retries safely and records normalized trace/error evidence.
- [ ] #2 Retry never duplicates an accepted event.
- [ ] #3 Episode generation consumes accepted events only.
- [ ] #4 Canon correction refreshes every affected public projection.
- [ ] #5 Simulation failure leaves last-known-good public content readable.
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
PRD 19.2 cases 6-10. Reuse the real in-memory pipeline (longRunHarness) with failure injection. (1) Export reusable doubles (MemoryReadStore/WorldDayRunStore/PostCommitRunStore) + seededCanonStore + createWorldDayPort + createPostCommitHarness + add createLongRunFixture(provider?) factory; refactor runLongRunSimulation to use it (pure visibility extraction, digest unchanged). (2) New convex/operations/failureIntegration.test.ts with a FlakyWholeSceneProvider (transient/permanent SimulationProviderError) and 5 describe blocks: AC1 simulateWholeScene retries transient failure, records normalized trace (retryCount>0, finite tokens), does NOT retry permanent; AC2 fail-then-resume a slot commits the event exactly once + completed-run short-circuit + commitProposedEvent idempotency dedup; AC3 every episode.sourceEventIds subset of committed-event IDs (accepted-only), day-scoped; AC4 submitRemediation(retcon) refresh runs post-commit pipeline -> timeline/liveState/episode-index projections republished (new versions); AC5 failed run commits nothing (current projection still served) + invalidateReadModel falls back to last-known-good via serveReadModel. Gate: npm run check + the focused jest project.
<!-- SECTION:PLAN:END -->
