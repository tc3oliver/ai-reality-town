---
id: ART-51
title: Independent editorial publication lifecycle
status: In Progress
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-03 16:05'
labels:
  - prd-1.0
  - epic-m
milestone: m-0
dependencies:
  - ART-13
  - ART-55
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-K004

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Manage Generated, Validated, Safety Review, Ready, Published, Withheld, and Superseded states independently from canon, including safe regeneration.

Scope
Manage Generated, Validated, Safety Review, Ready, Published, Withheld, and Superseded states independently from canon, including safe regeneration.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-13, ART-55

Schema Impact
Simulation control, review, correction, publication, model-config, kill-switch, operator audit, and queue/run records named by the task.

API Impact
Authenticated administrative commands and queries with explicit roles and audit trails.

Security Impact
Every mutation is server-authorized, reasoned, auditable, secret-safe, and non-destructive to accepted history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
State-machine, authorization, regeneration, withholding, and projection tests pass.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FR-K004: Canon Event 與公開內容發布狀態分離。
- [ ] #2 FR-K004: 不適當 Episode 可被暫停公開，但 Canon 不因此刪除。
- [ ] #3 FR-K004: 管理者可重新生成公開摘要。
- [ ] #4 Automated tests provide evidence for every mapped FR-K004 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-K004 to doc-1 and the merged implementation evidence.
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ART-51 — Independent editorial publication lifecycle (FR-K004). Publication status is a layer SEPARATE from canon: accepted events are never deleted/edited by publication changes; publication only governs visibility of derived public content.

1. Pure module convex/editorial/publicationLifecycle.ts: PublicationStatus = generated|validated|safety_review|ready|published|withheld|superseded; legal-transition graph + assertLegalTransition; PublicationRecord {publicationId,worldId,contentKind,contentRef,status,version,currentSummary,audit[]}; PublicationAuditEvent {action,fromStatus,toStatus,actor,reason,at}; pure fns advance/publish/withhold/resume/regenerate (regenerate supersedes current -> new Generated version, never mutates canon); assertAuthorized(actor,action). No canon imports.
2. Schema editorial/schema.ts: add publicationRecords table (status,version,contentKind,contentRef,summary,audit) indexed by world/content + status. dailyEpisodes stays as the generation feed; publicationRecords is the independent lifecycle.
3. Wiring publicationLifecycleFunctions.ts: authenticated admin internal mutations (publish/withhold/resume/regenerate) each server-authorized + audit-appended + idempotent on (contentRef,version); ops queries. Zero canon writes.
4. Tests publicationLifecycle.test.ts: legal+illegal transitions; withhold keeps canon intact; regenerate supersedes+bumps version+audits; non-admin rejected; fail-closed.
5. Gate npm run check green; PRD traceability FR-K004->doc-1.
<!-- SECTION:PLAN:END -->
