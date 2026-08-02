---
id: ART-57
title: Secret-safe LLM trace pipeline
status: In Progress
assignee:
  - '@codex'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 18:38'
labels:
  - prd-1.0
  - epic-o
milestone: m-0
dependencies:
  - ART-3
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
modified_files:
  - convex/observability/llmTrace.ts
  - convex/observability/llmTrace.test.ts
  - convex/observability/schema.ts
  - convex/observability/traces.ts
  - convex/schema.ts
  - convex/_generated/api.d.ts
  - docs/llm-tracing.md
  - docs/DEVELOPMENT.md
priority: high
type: feature
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Record world/day/run/scene/arc/characters, model/prompt version, token counts, latency, retries, validation, and final status with redaction and access control.

Scope
Record world/day/run/scene/arc/characters, model/prompt version, token counts, latency, retries, validation, and final status with redaction and access control.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-3

Schema Impact
Versioned LLM trace, budget, degradation, evaluator, metric-definition, aggregate, and reason-dimension records named by the task.

API Impact
Authorized observability/configuration queries and internal accounting/evaluation interfaces.

Security Impact
Metrics and traces redact secrets, resist duplicate counting, and cannot become or mutate Canon.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Trace completeness, correlation, authorization, and redaction tests pass.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-M001: Every model call records World ID, World Day, Run ID, Scene ID, Arc ID, Character IDs, Model, Prompt Version, Input Tokens, Output Tokens, Latency, Retry Count, Validation Result, and Final Status.
- [x] #2 Trace fields have defined optionality for calls without scene, arc, or character context.
- [x] #3 Complete prompts and secrets are redacted from public and unauthorized trace access.
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
1. Define a strict versioned LLM trace draft/record contract containing every FR-M001 field, with scene/arc optional and characterIds required as an empty-or-populated list.
2. Reject sensitive/raw or unknown fields at runtime, store only metadata, and provide separate minimal public versus internal authorized views.
3. Add idempotent trace persistence through a pure store and Convex internal mutation/query boundary; reject conflicting duplicate trace IDs and invalid metrics.
4. Test completeness, optionality, correlation, redaction, authorization, and duplicate behavior; document, run codegen/full gates, then finalize and merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented LLM trace v1 with every FR-M001 metric, explicit optional scene/arc and required empty-or-populated character list, strict sensitive-field rejection, idempotent/conflict-safe persistence, minimal public projection, and internal-only full queries. Convex codegen succeeded against the configured development deployment only. Focused validation: 1 suite/15 tests. Full npm run check passed architecture checks, typecheck, lint, 19 suites/205 tests, and Vite build.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented a complete secret-safe LLM accounting pipeline: all required model-call metadata is validated and correlated, raw prompts/secrets cannot enter storage, public access is minimized, full access is internal-only, and duplicate counting is prevented. Verified with development codegen, 15 focused tests, and the full 205-test quality gate.
<!-- SECTION:FINAL_SUMMARY:END -->
