---
id: ART-13
title: Append-only accepted event store
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-d
milestone: m-0
dependencies:
  - ART-12
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
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
- [ ] #1 FR-D002: Accepted events cannot be directly modified or deleted.
- [ ] #2 FR-D002: Correction, Compensation, and Retcon are new events.
- [ ] #3 FR-D002: Sequence numbers are monotonic and source/trace links are retained.
- [ ] #4 FR-D002: The store supports complete ordered replay.
- [ ] #5 Event commit is idempotent under duplicate keys, retries, and concurrent attempts.
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
