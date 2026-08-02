---
id: ART-20
title: Knowledge-scoped character intents
status: In Review
assignee:
  - '@codex'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 20:48'
labels:
  - prd-1.0
  - epic-f
milestone: m-0
dependencies:
  - ART-19
  - ART-24
  - ART-26
  - ART-9
  - ART-80
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-C003

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Build traceable, bounded character contexts and structured intents from authorized persona, goals, emotions, memories, knowledge, assets, location, and arc context.

Scope
Build traceable, bounded character contexts and structured intents from authorized persona, goals, emotions, memories, knowledge, assets, location, and arc context.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-19, ART-24, ART-26, ART-9, ART-80

Schema Impact
Simulation Run, Director Plan, Intent, Scene, checkpoint, failure-stage, and proposal references named by the task.

API Impact
Internal scheduling/orchestration commands with idempotent start, resume, retry, pause, and inspection boundaries.

Security Impact
Generated data is untrusted, knowledge-scoped, safety-checked, and unable to bypass validation or commit directly.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests inspect context provenance and reject or downgrade illegal intents.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-C003: 所有輸入均可追蹤。
- [x] #2 FR-C003: Intent 必須結構化。
- [x] #3 FR-C003: Intent 不得直接修改世界。
- [x] #4 FR-C003: 不合法 Intent 必須被拒絕或降級。
- [x] #5 Automated tests provide evidence for every mapped FR-C003 acceptance criterion, including rejection and failure paths.
- [ ] #6 PRD traceability links FR-C003 to doc-1 and the merged implementation evidence.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
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
1. Define a versioned Character Intent context assembled only from the target character's persona summary, current goal/emotion/location, authorized knowledge, bounded memory retrieval traces, current assets, and active-Arc context, with source provenance for every input. 2. Define a strict structured Intent output that expresses attempted action, target/location, rationale, urgency, and referenced input IDs but contains no world-state mutation or outcome fields. 3. Validate intent authorization and feasibility against the supplied context; reject unknown knowledge/memory/assets and downgrade unavailable-location or capability requests to a safe no-op intent with stable reasons. 4. Persist contexts/intents idempotently behind internal boundaries, add provenance/privacy/illegal-output/downgrade tests and docs, then run codegen and full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented source-proven character cognition contexts, strict structured intents with no mutation/outcome fields, authorization against the target character's replayed Canon/seed knowledge, memories, current asset ownership, and location, plus safe unreachable-location downgrade. Persistence is internal, Director-linked, and idempotent. Focused Jest passed 10 tests; Convex codegen succeeded; npm run check passed architecture, typecheck, lint, 39 suites/343 tests, and build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented FR-C003 traceable, knowledge-scoped Character Intents with strict non-mutating output, Canon-backed context authorization, illegal-reference rejection, and deterministic safe downgrade. Verified with 10 focused tests and full npm run check (343 tests); merge evidence remains pending.
<!-- SECTION:FINAL_SUMMARY:END -->
