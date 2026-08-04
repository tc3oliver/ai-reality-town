---
id: ART-49
title: Proposed-event validation and trace review
status: In Review
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-04 07:41'
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
- [x] #1 FR-K002: Event review shows Proposed Event, Validation Result, Rejection Reason, Model Trace, participants, state changes, related arcs, and Safety Label.
- [x] #2 Review data is filterable and secret-safe for authorized operators only.
- [x] #3 Stable validation reason codes render without free-text classification logic.
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

Delivered as three new files under convex/operations/ plus one documentation page; ART-48's opsConsoleFunctions.ts was NOT edited (ART-53 is building there in parallel).

- convex/operations/proposalReview.ts (pure, 376 lines): disposition + validation-result derivation, stable-reason-code policy, role-based redaction, and filtering. No Convex imports, no clock, no I/O.
- convex/operations/proposalReviewStore.ts: assembles a review record from records the pipeline already wrote. Adds no table, no pipeline write, and no re-execution of validation, safety, or the model. Exported as plain functions over a Convex db handle (same shape as simulation/schedulerOperations.ts) so the assembly is driven by an in-memory db double in tests.
- convex/operations/proposalReviewFunctions.ts: caller-facing queries listProposedEventReviews and reviewProposedEvent.
- convex/observability/llmTrace.ts: 2-line additive change exporting the existing internal sensitive-key predicate as isSensitiveTraceKey.
- docs/proposed-event-review.md and convex/_generated/api.d.ts module registration.

## Key decisions

1. AUTHORIZATION IS ART-48'S, UNCHANGED. Both queries call authorizeOperator as their first statement with the SAME SIMULATION_OPS_OPERATORS registry, the same viewer<operator<admin ordering, the same identity-then-ops-token resolution, and the same uniform OPS_UNAUTHORIZED denial. Review is a READ, so it is gated on the existing world.inspect capability rather than a new one; a role that may already inspect world state is the role that may read why an event was accepted. No second auth mechanism was built.

2. NO AUDIT ROW FOR READS. operatorAuditLog records privileged mutations. Review never mutates, and a read that logged would let any caller grow the audit trail. Reads stay observable in the Convex function logs, matching what ART-48 documented for denials.

3. REVIEW IS A PROJECTION, NOT A NEW WRITE PATH. Every FR-K002 field maps to an existing durable record: Proposed Event / participants / state changes from sceneSimulationRuns.result.output.proposedEvents; Validation Result from the presence of a canonEvents row for the idempotency key; Rejection Reason from worldDayRuns.errorCode + failureStage or the safety reason codes; Model Trace from llmTraces (ART-57); Related Arc from scene arcIds union storyArcEventClassifications memberships; Safety Label from result.safety (ART-54/55). An operator must see what actually happened, not a fresh re-judgement, so validation and safety are never re-run.

4. DISPOSITION PRECEDENCE. committed > withheld > rejected > pending. Accepted Canon wins outright because a slot can fail AFTER one proposal committed, and accepted history is never re-judged by a review surface. A safety-withheld scene reports validationResult 'not_run' because Canon validation genuinely never ran on it.

5. AC#3 IS ENFORCED AS A POLICY, NOT A CONVENTION. A reported reason code must be bounded SCREAMING_SNAKE_CASE; anything else collapses to UNCLASSIFIED_REJECTION (and a withheld scene with no category to SAFETY_REVIEW_REQUIRED). The free-text errorMessage is never read, parsed, or returned. Tests assert the message text is absent from the serialized record.

6. REDACTION IS ROLE-DRIVEN FROM THE AUTHENTICATED PRINCIPAL, never from caller input. viewer gets the ART-57 publicLlmTrace projection and no provider-supplied proposal metadata; operator/admin get the full accounting record, which ART-57's write boundary already makes incapable of holding a prompt or secret. Proposal metadata (the only free-form provider JSON on this surface) is scrubbed recursively with ART-57's own predicate, imported rather than copied so the rule cannot drift. An unreadable persisted safety decision fails closed to human_review_required.

## Verification

Exact commands and results on the merged tree (branch merged with origin/main at 23b7136 before the final run):

- npm run check -> ALL GREEN
  - check:architecture -> 'Architecture boundaries valid (policy v1, 11 modules).'
  - test:architecture   -> '# pass 6, # fail 0'
  - typecheck (tsc --noEmit) -> 0 errors
  - lint (eslint over 12 convex modules incl. convex/operations) -> 0 problems
  - test (jest) -> 'Test Suites: 79 passed, 79 total / Tests: 963 passed, 963 total'
  - build (tsc && vite build) -> 'built in 2.60s'

- Focused suites added by this task:
  - NODE_OPTIONS=--experimental-vm-modules npx jest convex/operations/proposalReview.test.ts -> 37 passed, 37 total
  - NODE_OPTIONS=--experimental-vm-modules npx jest convex/operations/proposalReviewStore.test.ts -> 17 passed, 17 total

AC evidence:
- AC#1 proven by proposalReviewStore.test.ts 'assembles the proposal, validation result, trace, participants, state changes, arcs, and safety label', which asserts all eight FR-K002 fields on one record built from seeded durable rows.
- AC#2 proven by the filter suites (11 filter dimensions, conjunctive combination, page bounds) plus the redaction suites: a viewer receives only the public trace projection and no metadata; a smuggled 'prompt' value is absent from the serialized response for viewer, operator, and admin; every read is world-scoped; and unauthorized/unknown/forged/out-of-allowlist callers all receive the uniform OPS_UNAUTHORIZED denial.
- AC#3 proven by the parameterised 'collapses %s to the placeholder rather than inventing a category' cases (free-text message, lowercase word, empty string, missing code) plus an assertion that the free-text message never appears in the serialized record.

DoD #10: FR-K002 traceability is recorded in docs/proposed-event-review.md, which maps each PRD bullet to its record field and source of truth; the repository keeps no separate traceability index file.

PR: https://github.com/tc3oliver/ai-reality-town/pull/124 (opened, auto-merge enabled with --merge --delete-branch, awaiting CI). DoD #14 stays unchecked until GitHub completes the auto-merge.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the authenticated proposed-event review surface (FR-K002): two caller-facing Convex queries (listProposedEventReviews, reviewProposedEvent) that show an authorized operator, per proposed event, the Proposed Event, Validation Result, Rejection Reason, Model Trace, participants, state changes, related arcs, and Safety Label.

Authorization reuses ART-48's operatorAuthorization gate verbatim - same SIMULATION_OPS_OPERATORS registry, same viewer<operator<admin ordering, same uniform OPS_UNAUTHORIZED denial - gated on the existing read capability world.inspect; no second auth mechanism and no edit to ART-48's opsConsoleFunctions.ts. Review is a projection over records the pipeline already wrote (sceneSimulationRuns, canonEvents, worldDayRuns, llmTraces, storyArcEventClassifications), so it adds no table, no pipeline write, and never re-runs validation or safety. Rejection reasons are the stable machine codes the producing layer recorded; free text is never read, parsed, or returned, and a non-code value collapses to UNCLASSIFIED_REJECTION. Trace redaction follows the authenticated principal's role - viewer gets the ART-57 public projection and no provider metadata, operator/admin get the full accounting record - and proposal metadata is scrubbed with ART-57's own sensitive-key predicate.

Verified with npm run check on the tree merged with origin/main: architecture boundaries valid (policy v1, 11 modules), boundary tests 6 pass / 0 fail, tsc --noEmit 0 errors, eslint 0 problems, jest 79 suites / 963 tests passed, vite build succeeded. The 54 tests added by this task (proposalReview.test.ts 37, proposalReviewStore.test.ts 17) prove each acceptance criterion by execution, including that a smuggled prompt never appears in the response for any role and that a free-text error message never becomes a reason code.
<!-- SECTION:FINAL_SUMMARY:END -->
