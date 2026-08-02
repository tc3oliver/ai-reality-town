---
id: ART-3
title: Project architecture and module boundaries
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:30'
updated_date: '2026-08-02 17:44'
labels:
  - prd-1.0
  - epic-a
milestone: m-0
dependencies: []
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-004, NFR-006

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Define install/build/test baseline, domain boundaries, ownership, provider ports, and PRD traceability without coupling Canon to the presentation layer.

Scope
Define install/build/test baseline, domain boundaries, ownership, provider ports, and PRD traceability without coupling Canon to the presentation layer.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
None

Schema Impact
Versioned module-boundary, provider-adapter, prompt/model-config, fixture, or trace contracts named by the task; persisted changes require compatibility evidence.

API Impact
Shared provider/configuration ports and offline test interfaces only; business logic cannot import provider-specific APIs.

Security Impact
Credentials, prompts, and provider metadata are redacted and accessed only through authorized configuration boundaries.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Architecture boundaries and ownership checks pass; the project installs, typechecks, lints, tests, and builds without external credentials.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Architecture defines and enforces dependency boundaries for Canon, Simulation, Character Knowledge, Story, Editorial/Recap, Public Read Model, Viewer, Operations, Safety, and Observability modules.
- [x] #2 Provider-specific formats remain behind a shared versioned adapter boundary.
- [x] #3 Project installs, typechecks, lints, tests, and builds without external credentials.
- [x] #4 PRD traceability and module ownership documentation identify the owner of every module.
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
1. Inventory current and target modules, provider boundaries, build/test baseline, and PRD traceability requirements.
2. Add executable architecture-boundary policy and fixtures/tests covering all ten required domains and provider isolation.
3. Add durable module ownership, dependency direction, provider contract, and PRD traceability documentation; align stale Phase 0 development docs.
4. Run focused architecture checks plus npm run check, record evidence, finalize the task, and merge its PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented policy v1 in architecture/module-boundaries.json with executable import scanning and provider-adapter isolation. Added module ownership and PRD-area routing documentation. Validation: npm run check:architecture (pass, 11 modules); npm run test:architecture (pass, 6 tests including reverse-dependency and provider-leak failures); npm run check (pass: typecheck, lint, 12 Jest suites/102 tests, production build). No external credentials were used.

Committed as the ART-3 implementation commit and pushed to origin/feat/ART-3-module-boundaries.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Defined and enforced versioned dependency and provider boundaries for every PRD domain, documented module ownership and requirement routing, and added the architecture gate to offline/full checks. Verified with 6 policy tests and the complete npm run check gate (102 existing tests plus build).
<!-- SECTION:FINAL_SUMMARY:END -->
