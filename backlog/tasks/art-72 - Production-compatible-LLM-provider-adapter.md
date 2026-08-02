---
id: ART-72
title: Production-compatible LLM provider adapter
status: Done
assignee:
  - '@codex'
created_date: '2026-08-02 15:43'
updated_date: '2026-08-02 21:00'
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
- [x] #1 At least one real provider implements the shared adapter without provider-specific formats in business logic.
- [x] #2 Adapter normalizes structured output, errors, timeout, retry, and trace metadata.
- [x] #3 Credential-safe configuration and redaction tests prove secrets do not enter public output or unsafe logs.
- [x] #4 Contract tests run the same scenarios against Fake and real adapter boundaries without requiring live credentials in the offline gate.
- [x] #5 The selected MVP real-provider path uses configurable OpenAI-compatible HTTP endpoints; no OpenAI-specific SDK or vendor-specific response type appears in business/domain modules.
- [x] #6 Configuration validates LLM_API_URL, LLM_MODEL, LLM_EMBEDDING_MODEL, and embedding dimension before a run; LLM_API_KEY is optional only for endpoints that explicitly permit unauthenticated access.
- [x] #7 Chat and embedding capability probes fail with stable actionable errors when endpoint compatibility, model availability, structured output, or embedding dimensions do not match.
- [x] #8 Live credentials are stored only in the target Convex deployment environment, never in repository files, Backlog, logs, traces, browser bundles, or conversation text.
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
1. Define credential-safe server configuration for LLM_API_URL, LLM_MODEL, LLM_EMBEDDING_MODEL, LLM_EMBEDDING_DIMENSION, optional LLM_API_KEY, timeout, and retry; validate URL/model/dimension/auth policy without exposing secrets. 2. Implement a vendor-neutral OpenAI-compatible HTTP adapter for chat structured output and embeddings behind shared ports, with abort timeout, bounded retry, runtime wire normalization, stable errors, and secret-safe trace metadata. 3. Add explicit chat/embedding capability probes for endpoint/model/JSON-schema/dimension compatibility and Convex server-only actions that read deployment environment variables. 4. Add Fake/HTTP adapter contract tests with mocked fetch (no live credentials), timeout/retry/error/redaction/config/probe cases; update .env.example/docs, run optional configured dev probe without printing credentials, then codegen and full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented vendor-neutral structured chat/embedding ports and an OpenAI-compatible HTTP adapter with runtime wire normalization, abort timeout, bounded retry, stable errors, token/latency/retry trace metadata, config validation, endpoint normalization/overrides, explicit unauthenticated opt-in, and server-only capability probe. Offline Fake/HTTP parity and negative tests passed 7 tests. Dev deployment probe passed chat structured output with model auto and embeddings with model bge-m3 at 1024 dimensions; output was credential/prompt free. npm run check passed architecture, typecheck, lint, 40 suites/348 tests, and build. agent:check confirmed no tracked secrets.

PR #70 merged at 2026-08-02T20:56:35Z: https://github.com/tc3oliver/ai-reality-town/pull/70
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented NFR-004/Milestone 2 OpenAI-compatible chat and embedding adapter with safe Convex configuration, structured-output normalization, timeout/retry/error handling, secret-safe traces, Fake parity, and actionable capability probes. Verified offline with 7 focused tests/full 348-test gate, live dev compatibility for chat model auto plus bge-m3/1024 embeddings, and merged PR #70.
<!-- SECTION:FINAL_SUMMARY:END -->
