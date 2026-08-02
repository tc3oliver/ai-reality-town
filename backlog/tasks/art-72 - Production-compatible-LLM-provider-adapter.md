---
id: ART-72
title: Production-compatible LLM provider adapter
status: To Do
assignee: []
created_date: '2026-08-02 15:43'
updated_date: '2026-08-02 17:10'
labels:
  - prd-1.0
  - epic-a
milestone: m-0
dependencies:
  - ART-3
  - ART-57
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-004, Milestone 2

Problem / Context
PRD 1.0 requires a replaceable real-model boundary; the selected MVP integration is a configurable OpenAI-compatible HTTP provider, not a provider-specific SDK.

Goal
Implement a configurable OpenAI-compatible provider adapter behind the shared interface with structured-output conversion, runtime validation, normalized errors, timeout, retry, trace metadata, and credential-safe configuration.

Scope
OpenAI-compatible chat and embedding endpoints configured by base URL, model identifiers, embedding dimension, and optional bearer credential, plus Fake Provider parity and offline contract tests.

Out of Scope
Adjacent PRD requirements, production deployment, and bypasses of Canon, safety, idempotency, authorization, or publication controls.

Dependencies
ART-3, ART-57

Schema Impact
Versioned module-boundary, provider-adapter, prompt/model-config, fixture, or trace contracts named by the task; persisted changes require compatibility evidence.

API Impact
Shared provider/configuration ports and offline test interfaces only; business logic cannot import provider-specific APIs.

Security Impact
Credentials, prompts, and provider metadata are redacted and accessed only through authorized configuration boundaries.

Validation Commands
npm run check; run the focused test command added by this task and record its exact invocation in implementation notes.

Test Requirements
Automated tests cover every acceptance criterion and all stated negative or failure cases.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 At least one real provider implements the shared adapter without provider-specific formats in business logic.
- [ ] #2 Adapter normalizes structured output, errors, timeout, retry, and trace metadata.
- [ ] #3 Credential-safe configuration and redaction tests prove secrets do not enter public output or unsafe logs.
- [ ] #4 Contract tests run the same scenarios against Fake and real adapter boundaries without requiring live credentials in the offline gate.
- [ ] #5 The selected MVP real-provider path uses configurable OpenAI-compatible HTTP endpoints; no OpenAI-specific SDK or vendor-specific response type appears in business/domain modules.
- [ ] #6 Configuration validates LLM_API_URL, LLM_MODEL, LLM_EMBEDDING_MODEL, and embedding dimension before a run; LLM_API_KEY is optional only for endpoints that explicitly permit unauthenticated access.
- [ ] #7 Chat and embedding capability probes fail with stable actionable errors when endpoint compatibility, model availability, structured output, or embedding dimensions do not match.
- [ ] #8 Live credentials are stored only in the target Convex deployment environment, never in repository files, Backlog, logs, traces, browser bundles, or conversation text.
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
