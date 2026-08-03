---
id: ART-23
title: Core world-day proposal and commit orchestration
status: Done
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:32'
updated_date: '2026-08-03 16:04'
labels:
  - prd-1.0
  - epic-f
milestone: m-0
dependencies:
  - ART-22
  - ART-17
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
modified_files:
  - convex/simulation/worldDayOrchestration.ts
  - convex/simulation/worldDayOrchestrationFunctions.ts
  - convex/simulation/worldDayOrchestration.test.ts
  - convex/simulation/schema.ts
  - convex/_generated/api.d.ts
  - docs/world-day-orchestration.md
  - docs/DEVELOPMENT.md
priority: high
type: feature
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 12 stages 1–10

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Orchestrate load state, environment events, arcs, Director, intents, grouping, scene simulation, structural/Canon validation, and accepted-event commit with durable checkpoints.

Scope
Orchestrate load state, environment events, arcs, Director, intents, grouping, scene simulation, structural/Canon validation, and accepted-event commit with durable checkpoints.

Out of Scope
Post-commit projections, cognition, story/editorial generation, publication, snapshots, metrics, and production deployment.

Dependencies
ART-22, ART-17

Schema Impact
Simulation Run, Director Plan, Intent, Scene, checkpoint, failure-stage, and proposal references named by the task.

API Impact
Internal scheduling/orchestration commands with idempotent start, resume, retry, pause, and inspection boundaries.

Security Impact
Generated data is untrusted, knowledge-scoped, safety-checked, and unable to bypass validation or commit directly.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
Failure injection covers every pre-commit boundary, retry, duplicate commit, and partial-write rejection.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Section 12 stages 1–10 execute in order with durable run and checkpoint status.
- [x] #2 Structural and Canon validation failures reject the proposal without any partial Canon write.
- [x] #3 Accepted-event commit is durable and idempotent; retry cannot duplicate an accepted event.
- [x] #4 A failure records its exact stage and stable error information, and retry resumes only from a safe boundary.
- [x] #5 Automated failure-injection tests cover every pre-commit boundary, duplicate commit, and partial-write rejection.
- [x] #6 PRD traceability links Section 12 stages 1–10 to doc-1 and merged implementation evidence.
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
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Define the exact ten pre-commit stage contract, stable stage/error codes, durable checkpoint/run records, and safe-resume rules where completed checkpoints are reused and failed/in-progress stages restart without skipping predecessors. 2. Implement an injected orchestration engine that persists every transition, normalizes stage artifacts, structurally validates and Canon-validates all proposals before a single atomic idempotent batch commit boundary, and records exact failure provenance without partial Canon writes. 3. Add internal Convex persistence/inspection operations and schema indexes for world-day runs and append-only checkpoint attempts, keeping post-commit projection/editorial work out of scope. 4. Add exhaustive failure injection for stages 1–10, validation rejection, commit rollback, retry/resume, and duplicate commit; update documentation, codegen, and run focused plus full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the exact Section 12 stages 1-10 contract with ordered immutable artifacts, durable per-attempt checkpoints, stable failure stage/code, safe first-incomplete-stage resume, terminal completed-run idempotency, and run identity conflict protection. Internal Convex tables/functions persist and inspect run/checkpoint state. Validation stages cannot invoke commit; stage 10 is one atomic idempotent commit adapter boundary and malformed commit evidence fails closed. Verification: NODE_OPTIONS=--experimental-vm-modules npx jest convex/simulation/worldDayOrchestration.test.ts --runInBand passed 16/16 including failure injection at all ten stages, safe retry, duplicate run, validation no-write, atomic rollback, and invalid evidence; npx convex codegen passed; npm run check passed architecture, typecheck, lint, 46 suites/397 tests, and build; git diff --check passed.

Post-rebase verification on merged ART-34 and ART-22 evidence: npm run check passed 47 suites/406 tests plus architecture, typecheck, lint, and build at commit 17487f0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented world-day orchestration for PRD Section 12 stages 1-10 (load state -> env events -> arcs -> director plan -> intents -> grouping -> scene sim -> structural validation -> canon validation -> commit) as a pure, dependency-injected orchestrator (convex/simulation/worldDayOrchestration.ts) with durable checkpoint + failure-stage records, atomic idempotent commit, and resume-from-safe-boundary retry. Verified: 16/16 tests pass in worldDayOrchestration.test.ts covering every pre-commit failure boundary, atomic rollback, idempotent reruns, and safe-boundary resume. Merged via PR #82 (feat/ART-23-world-day-orchestration). PRD Section 12 stages 1-10 traced to doc-1 in docs/world-day-orchestration.md. (Metadata finalized retroactively: code merged in a prior session; task status is being corrected to Done.)
<!-- SECTION:FINAL_SUMMARY:END -->
