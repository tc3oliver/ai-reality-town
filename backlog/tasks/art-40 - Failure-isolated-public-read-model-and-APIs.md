---
id: ART-40
title: Public read-model infrastructure and failure isolation
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:57'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-13
  - ART-51
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
NFR-001; NFR-002 read API clauses; NFR-005 public API clause; Section 16.3

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Provide publication-gated read-model storage, cache/version switching, last-known-good serving, and public read APIs isolated from simulation writes.

Scope
Provide publication-gated read-model storage, cache/version switching, last-known-good serving, and public read APIs isolated from simulation writes.

Out of Scope
Domain-specific world/character/arc/episode/live projection builders and public UI.

Dependencies
ART-13, ART-51

Schema Impact
No Canon mutation schema; owns published read-model records, query DTOs, cache/version metadata, or UI state explicitly named by the task.

API Impact
Read-only public query contracts and internal projection writers; UI never calls providers.

Security Impact
Server-side field allowlists, publication status, accessibility, and secret/privacy boundaries apply to every public view.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
Load, privacy, stale-version, cache-switch, simulation-outage, and 99.5% availability evidence tests pass.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Published read data remains available during simulation/model failure and publication service state is isolated from simulation writes.
- [ ] #2 Public Read API P95 is below 500ms under the documented load profile.
- [ ] #3 Public reads never invoke LLM generation.
- [ ] #4 Public API returns no private Knowledge, private memory, Prompt, raw model output, or administrator notes.
- [ ] #5 Version switching and cache invalidation preserve the last-known-good public version.
- [ ] #6 Section 16.3: Public visitor traffic produces zero incremental LLM calls; load tests verify LLM-call count is invariant as public read volume increases.
- [ ] #7 NFR-001: Documented availability testing and operational evidence demonstrate a 99.5% public-content availability objective while simulation and publication failures remain isolated.
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
