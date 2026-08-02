---
id: ART-12
title: Versioned proposed-event contracts
status: In Progress
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 18:16'
labels:
  - prd-1.0
  - epic-d
milestone: m-0
dependencies:
  - ART-3
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
modified_files:
  - convex/canon/model.ts
  - convex/canon/proposedEvent.ts
  - convex/canon/proposedEvent.test.ts
  - convex/canon/reducer.test.ts
  - convex/canon/validators.ts
  - convex/simulation/provider.ts
  - convex/simulation/workflow.ts
  - convex/simulation/workflow.test.ts
  - docs/proposed-event-contract.md
  - docs/DEVELOPMENT.md
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
- [x] #1 FR-D001: Proposed Event uses a versioned runtime-validated schema.
- [x] #2 FR-D001: Every proposal has an idempotency key, source, participants, and causal-event references.
- [x] #3 FR-D001: Core state changes use a typed union and reject undefined payloads.
- [x] #4 Structured provider output is normalized before it can enter the proposal boundary.
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
1. Tighten ProposedEvent v1 domain types and define a strict normalizer for unknown provider JSON, including exact envelope/source/state-change keys and JSON-safe metadata.
2. Route every simulation provider result through the shared normalizer before Canon commit; preserve Fake Provider typed ergonomics and stable structured errors.
3. Add contract tests for supported/unsupported versions, required idempotency/source/participants/causes, every state-change union, unknown/undefined payloads, extra keys, and workflow normalization.
4. Document the versioning/provider boundary, run focused/full gates, then finalize and merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented a strict ProposedEvent v1 normalizer for untrusted provider output, exact envelope/source/union keys, JSON-safe metadata, and literal schema typing. Routed simulation workflow output through normalization before Canon commit. Validation: npm test -- convex/canon/proposedEvent.test.ts convex/simulation/workflow.test.ts convex/canon/reducer.test.ts (3 suites, 29 tests passed); npm run check (architecture policy and boundary tests, typecheck, lint, 16 suites/150 tests, and Vite build passed).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Defined and documented the versioned ProposedEvent v1 provider boundary. Provider wire output is now treated as unknown, strictly normalized before commit, rejects unsupported versions, missing provenance, untyped/extra state payloads, and unsafe metadata. Verified with 29 focused tests and the full npm run check gate (150 tests plus typecheck, lint, architecture checks, and build).
<!-- SECTION:FINAL_SUMMARY:END -->
