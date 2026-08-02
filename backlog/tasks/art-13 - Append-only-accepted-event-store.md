---
id: ART-13
title: Append-only accepted event store
status: In Progress
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 18:26'
labels:
  - prd-1.0
  - epic-d
milestone: m-0
dependencies:
  - ART-12
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
modified_files:
  - convex/canon/commit.ts
  - convex/canon/commit.test.ts
  - convex/canon/eventTypes.ts
  - convex/canon/inMemoryStore.ts
  - convex/canon/mistwoodFixture.ts
  - convex/canon/model.ts
  - convex/canon/reducer.test.ts
  - convex/canon/serialize.ts
  - convex/canon/validators.ts
  - docs/architecture/adr/ADR-0002-append-only-canon-events.md
  - docs/foundation-scope.md
priority: high
type: feature
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-D002, NFR-003, NFR-008

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Persist accepted events immutably with monotonic sequence, trace/source links, idempotent commits, and correction-event-only remediation.

Scope
Persist accepted events immutably with monotonic sequence, trace/source links, idempotent commits, and correction-event-only remediation.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-12

Schema Impact
Versioned Proposed/Accepted Event schemas, typed state-change unions, sequences, idempotency, and provenance records.

API Impact
Proposal validation and append interfaces with no update/delete operation for accepted events.

Security Impact
Only validated authorized commits append history; secrets are minimized in traces and public summaries.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Persistence tests cover concurrency, duplicate keys, sequence monotonicity, and mutation prevention.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-D002: Accepted events cannot be directly modified or deleted.
- [x] #2 FR-D002: Correction, Compensation, and Retcon are new events.
- [x] #3 FR-D002: Sequence numbers are monotonic and source/trace links are retained.
- [x] #4 FR-D002: The store supports complete ordered replay.
- [x] #5 Event commit is idempotent under duplicate keys, retries, and concurrent attempts.
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
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend AcceptedEvent persistence with retained trace provenance and typed Correction/Compensation/Retcon proposal semantics that append new causal events.
2. Make the repository contract express an atomic event-plus-idempotency append and per-world serialized commit; implement matching Convex transaction and isolated in-memory semantics.
3. Add immutable ordered read APIs and tests for mutation resistance, complete replay ordering, partial-write prevention, duplicate retries, and concurrent same/different-key attempts.
4. Update Canon documentation, run focused/full gates, then finalize, push, and auto-merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented a per-world exclusive commit transaction and atomic event/idempotency append contract, immutable cloned in-memory boundaries, retained trace/source/causal provenance, and admin-only correction/compensation/retcon event types. Focused validation: commit, proposal-contract, and replay suites passed 33 tests. Full npm run check passed architecture checks, typecheck, lint, 17 suites/173 tests, and Vite build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the append-only Accepted Event store contract with atomic idempotent commits, monotonic concurrent sequencing, immutable reads, complete ordered replay, retained trace/source links, and append-only remediation event types. Verified by 33 focused tests and the full 173-test quality gate.
<!-- SECTION:FINAL_SUMMARY:END -->
