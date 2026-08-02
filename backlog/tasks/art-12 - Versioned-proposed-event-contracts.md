---
id: ART-12
title: Versioned proposed-event contracts
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-d
milestone: m-0
dependencies:
  - ART-3
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-D001, NFR-004

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Define runtime-validated, versioned Proposed Event and typed state-change unions with idempotency, source, participant, and causal metadata.

Scope
Define runtime-validated, versioned Proposed Event and typed state-change unions with idempotency, source, participant, and causal metadata.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-3

Schema Impact
Versioned Proposed/Accepted Event schemas, typed state-change unions, sequences, idempotency, and provenance records.

API Impact
Proposal validation and append interfaces with no update/delete operation for accepted events.

Security Impact
Only validated authorized commits append history; secrets are minimized in traces and public summaries.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Contract tests cover supported versions, required provenance, idempotency, and invalid unions.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-D001: Proposed Event uses a versioned runtime-validated schema.
- [ ] #2 FR-D001: Every proposal has an idempotency key, source, participants, and causal-event references.
- [ ] #3 FR-D001: Core state changes use a typed union and reject undefined payloads.
- [ ] #4 Structured provider output is normalized before it can enter the proposal boundary.
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
