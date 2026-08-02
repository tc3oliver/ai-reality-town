---
id: ART-4
title: Deterministic fake provider and Mistwood fixtures
status: To Do
assignee: []
created_date: '2026-08-02 15:30'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-a
milestone: m-0
dependencies:
  - ART-3
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-007, Milestone 0

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Provide deterministic fake model responses, fixed seeds, and reusable world fixtures for offline domain and workflow testing.

Scope
Provide deterministic fake model responses, fixed seeds, and reusable world fixtures for offline domain and workflow testing.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-3

Schema Impact
Versioned module-boundary, provider-adapter, prompt/model-config, fixture, or trace contracts named by the task; persisted changes require compatibility evidence.

API Impact
Shared provider/configuration ports and offline test interfaces only; business logic cannot import provider-specific APIs.

Security Impact
Credentials, prompts, and provider metadata are redacted and accessed only through authorized configuration boundaries.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Offline tests demonstrate deterministic provider behavior and a valid fixed-world fixture.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Domain logic runs without an LLM or network.
- [ ] #2 A deterministic Fake Provider returns identical structured output for a fixed seed and scenario.
- [ ] #3 A fixed valid world fixture is available for domain and workflow tests.
- [ ] #4 Long-run 7/30/90-day execution is owned by ART-60 and ART-73, not this fixture task.
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
