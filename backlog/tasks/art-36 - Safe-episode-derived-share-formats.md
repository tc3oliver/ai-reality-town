---
id: ART-36
title: Safe episode-derived share formats
status: To Do
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-08-02 16:24'
labels:
  - prd-1.0
  - epic-i
milestone: m-0
dependencies:
  - ART-34
  - ART-66
  - ART-51
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-G005

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Generate local news, social copy, share-card copy, and next-day teasers linked to their source episode.

Scope
Generate local news, social copy, share-card copy, and next-day teasers linked to their source episode.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-34, ART-66, ART-51

Schema Impact
Episode, recap, machine-summary, coverage, or derived-content records named by the task, each linked to accepted source events.

API Impact
Editorial generation/validation interfaces and publication-candidate outputs; no direct Canon mutation.

Security Impact
Spoilers and unsafe content are withheld through field visibility and publication gates.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests verify provenance, canon isolation, and publication gating.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-G005: 衍生內容不得產生新 Canon。
- [ ] #2 FR-G005: 必須標記來源 Episode。
- [ ] #3 FR-G005: 不適當內容不得自動外部發布。
- [ ] #4 Automated tests provide evidence for every mapped FR-G005 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-G005 to doc-1 and the merged implementation evidence.
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
