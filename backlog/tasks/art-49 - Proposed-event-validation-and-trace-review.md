---
id: ART-49
title: Proposed-event validation and trace review
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-04 07:30'
labels:
  - prd-1.0
  - epic-m
milestone: m-0
dependencies:
  - ART-15
  - ART-57
  - ART-48
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-K002

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Show proposals, validation/rejection results, traces, participants, state changes, arcs, and safety labels to authorized operators.

Scope
Show proposals, validation/rejection results, traces, participants, state changes, arcs, and safety labels to authorized operators.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-15, ART-57, ART-48

Schema Impact
Simulation control, review, correction, publication, model-config, kill-switch, operator audit, and queue/run records named by the task.

API Impact
Authenticated administrative commands and queries with explicit roles and audit trails.

Security Impact
Every mutation is server-authorized, reasoned, auditable, secret-safe, and non-destructive to accepted history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Authorization, redaction, filtering, and result-rendering tests pass.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-K002: Event review shows Proposed Event, Validation Result, Rejection Reason, Model Trace, participants, state changes, related arcs, and Safety Label.
- [ ] #2 Review data is filterable and secret-safe for authorized operators only.
- [ ] #3 Stable validation reason codes render without free-text classification logic.
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
1. Reuse ART-48 authorization verbatim: convex/operations/operatorAuthorization.ts (authorizeOperator + parseOperatorRegistry + SIMULATION_OPS_OPERATORS registry, uniform OPS_UNAUTHORIZED denial, roles viewer<operator<admin). The review surface is a READ capability, so it is gated on the existing 'world.inspect' capability (minimum role: viewer). No second auth mechanism, no new capability, no edit to opsConsoleFunctions.ts (ART-53 works there in parallel).

2. Derive the review record from durable records already written by the pipeline; add no new table and no new pipeline write:
   - sceneSimulationRuns (ART-30/ART-55) is the single durable proposal record: result.output.proposedEvents (Proposed Event, participants, state changes), result.scene (worldDay/timeSlot/location/participantIds/arcIds), result.safety (ART-54/55 Safety Label + stable reasonCodes/warningCodes), result.reviewStatus, result.trace (provider accounting metadata).
   - canonEvents.by_world_and_idempotency_key decides Validation Result = accepted (committed eventId + sequenceNumber + validationVersion + traceId).
   - worldDayRuns (by_world_day_slot) supplies the stable Rejection Reason code + failure stage for a slot whose proposals never reached Canon.
   - llmTraces (ART-57, by_world_and_day + sceneId/runId) supplies the Model Trace.
   - storyArcEventClassifications (by_world_and_source_event) unions arc memberships of the committed event with scene.arcIds for Related Arcs.

3. New pure module convex/operations/proposalReview.ts (no Convex imports, unit tested):
   - PROPOSAL_DISPOSITIONS = committed | rejected | withheld | pending; PROPOSAL_VALIDATION_RESULTS = accepted | rejected | not_run.
   - buildProposalReview(source, role): deterministic derivation. committed -> accepted; safety reviewStatus 'required' -> withheld with the safety reason code; slot failure -> rejected with the run's stable error code; otherwise pending.
   - AC#3: reason codes are passed through as stable machine codes only. A code that is not SCREAMING_SNAKE_CASE collapses to UNCLASSIFIED_REJECTION; free-text error messages are never read, parsed, or returned.
   - AC#2 redaction: role viewer receives only the ART-57 publicLlmTrace projection and no proposal metadata; operator/admin receive the full ART-57 trace metadata record (which by construction can never contain prompts or secrets). Proposal metadata is scrubbed with ART-57's sensitive-key predicate, exported from convex/observability/llmTrace.ts as isSensitiveTraceKey (2-line additive rename).
   - AC#2 filtering: filterProposalReviews by worldDay, timeSlot, disposition, validationResult, safetyLabel, reasonCode, eventType, participantId, arcId, sceneId, with a bounded limit.

4. New store module convex/operations/proposalReviewStore.ts: reads the tables above through a Convex db handle (same shape as simulation/schedulerOperations.ts) so it can be driven by an in-memory db double in tests.

5. New wiring convex/operations/proposalReviewFunctions.ts: two caller-facing queries, each authorizing FIRST via authorizeOperator with 'world.inspect':
   - reviewProposedEvent(worldId, idempotencyKey)
   - listProposedEventReviews(worldId, filters..., limit)

6. Tests: proposalReview.test.ts (pure derivation, stable reason codes, filtering, role redaction, uniform denial for the review capability) and proposalReviewStore.test.ts (fake-db assembly of committed / rejected / withheld records incl. arcs and trace correlation).

7. Docs: docs/proposed-event-review.md (surface, authorization, redaction, filters, reason-code table); register the three new modules in convex/_generated/api.d.ts.

8. Verify with npm run check (architecture boundaries, boundary test, typecheck, lint, full jest, build). Merge origin/main before the final push and re-run npm run check.
<!-- SECTION:PLAN:END -->
