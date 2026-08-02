---
id: ART-46
title: Causal viewer-intervention consequence tracking
status: To Do
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-l
milestone: m-0
dependencies:
  - ART-45
  - ART-13
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-J002

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Trace the winning intervention, direct effects, descendants, and uncertain indirect effects without overstating causality.

Scope
Trace the winning intervention, direct effects, descendants, and uncertain indirect effects without overstating causality.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-45, ART-13

Schema Impact
Viewer Intervention, vote, consequence, analytics, or authenticated progress schemas explicitly named by the task.

API Impact
Untrusted viewer command/ingestion interfaces and privacy-safe read/aggregate queries.

Security Impact
Rate limits, authorization, injection defenses, data minimization, and no direct character control are mandatory.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Causal-chain tests cover direct, multi-hop, unrelated, and uncertain effects.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-J002: Consequence view identifies the winning viewer-triggered event, direct effects, downstream events, and uncertain indirect effects.
- [ ] #2 The system never labels all downstream outcomes as directly caused by the vote.
- [ ] #3 Every displayed causal link traces to accepted-event provenance.
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
