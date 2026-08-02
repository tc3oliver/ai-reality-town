---
id: ART-96
title: Public live-state projection
status: To Do
assignee: []
created_date: '2026-08-02 16:26'
updated_date: '2026-08-02 16:51'
labels:
  - prd-1.0
  - epic-k
milestone: m-0
dependencies:
  - ART-40
  - ART-9
  - ART-79
  - ART-22
  - ART-29
  - ART-65
  - ART-51
  - ART-55
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 96000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-I002 read model; Section 13.1–13.4

Problem / Context
This independently reviewable PR closes a public projection ownership gap.

Goal
Build the last-known-good Live projection for world time, locations, character positions, active scenes, recent events, and active arcs.

Scope
Build the last-known-good Live projection for world time, locations, character positions, active scenes, recent events, and active arcs.

Out of Scope
Other public projections, UI, generation, and production deployment.

Dependencies
ART-40, ART-9, ART-79, ART-22, ART-29, ART-65, ART-51, ART-55

Schema Impact
Owns only the publication-safe projection records and DTOs named in Goal.

API Impact
Internal idempotent projection writer and read-only public queries for the named data.

Security Impact
Server-side field allowlists and publication state exclude private cognition, prompts, raw output, and admin notes.

Validation Commands
npm run check; run focused projection rebuild, privacy, correction, and query tests.

Test Requirements
Tests cover replay/rebuild, correction refresh, privacy, idempotency, and last-known-good reads.

Documentation Impact
Update read-model/API and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Live state is derived from accepted events and published scene summaries.
- [ ] #2 Reads trigger no generation and survive simulation pause/outage.
- [ ] #3 Update latency is below five seconds under the documented load profile.
- [ ] #4 The Live projection is independently buildable from accepted events, safe scene summaries, arc projections, and publication state; it does not depend on the post-commit orchestrator.
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
