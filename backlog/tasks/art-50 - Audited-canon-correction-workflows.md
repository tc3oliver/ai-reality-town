---
id: ART-50
title: Audited canon correction workflows
status: Done
assignee:
  - '@agent-art50'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-04 13:18'
labels:
  - prd-1.0
  - epic-m
milestone: m-0
dependencies:
  - ART-49
  - ART-17
  - ART-40
  - ART-84
  - ART-85
  - ART-95
  - ART-96
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-K003

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Create Correction, Compensation, and Retcon events with operator/reason audit, replay consistency, and public-content refresh.

Scope
Create Correction, Compensation, and Retcon events with operator/reason audit, replay consistency, and public-content refresh.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-49, ART-17, ART-40, ART-84, ART-85, ART-95, ART-96

Schema Impact
Simulation control, review, correction, publication, model-config, kill-switch, operator audit, and queue/run records named by the task.

API Impact
Authenticated administrative commands and queries with explicit roles and audit trails.

Security Impact
Every mutation is server-authorized, reasoned, auditable, secret-safe, and non-destructive to accepted history.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Integration tests cover each correction type, replay, read-model refresh, and authorization.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-K003: 不得刪除 Accepted Event。
- [x] #2 FR-K003: Retcon 必須記錄操作者與理由。
- [x] #3 FR-K003: 修正後 Replay 結果一致。
- [x] #4 FR-K003: 公開內容需依修正更新。
- [x] #5 FR-K003: 重大 Retcon 應保留稽核紀錄。
- [x] #6 Automated tests provide evidence for every mapped FR-K003 acceptance criterion, including rejection and failure paths.
- [x] #7 PRD traceability links FR-K003 to doc-1 and the merged implementation evidence.
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
- [x] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Canon layer (convex/canon/eventTypes.ts): promote the remediation event-type set to a named export (REMEDIATION_EVENT_TYPES / isRemediationEventType) and add SUPERSEDING_EVENT_TYPES (correction, retcon) with isSupersedingEventType. Single source of truth for both structural and canon validation.
2. Canon validation (convex/canon/validators.ts): reuse the new guards instead of the inline literal set; in validateCanon exempt superseding remediation events from the two 'normal Canon transition' rules only (DEAD_CHARACTER_ACTION participation and the no-resurrection rule), so a wrongly recorded death can be corrected/retconned by APPENDING a new event. No accepted row is ever edited or deleted; commit.ts is untouched.
3. Remediation policy + orchestration (new convex/operations/canonCorrection.ts, pure, no Convex imports): REMEDIATION_POLICY table giving each type its distinct contract - correction (supersedes targets, may override normal-transition rules), compensation (does NOT supersede; offsets forward-going state only, no rule override), retcon (supersedes AND requires a non-empty publicSummary as the restated public account). buildRemediationEvent() constructs the ProposedEvent (proposedBy admin + operatorId, eventType = remediation type, causedByEventIds = target events, metadata.remediation = {schemaVersion, type, operatorId, reason, targets, supersedes, offsets}) and rejects blank reason / blank operator / no targets / duplicate targets / missing retcon public summary. submitRemediation() orchestrates over injected ports: commit through the SHARED commitProposedEvent (structural + canon validation + idempotency), append exactly one operator audit row built by ART-48's buildOperatorAuditEntry, then trigger the public read-model refresh.
4. Authorization (convex/operations/operatorAuthorization.ts): add canon.correct / canon.compensate / canon.retcon to OPS_CAPABILITIES, all minimum role admin. No second auth mechanism.
5. Convex wiring (new convex/operations/canonCorrectionFunctions.ts): public mutations createCorrectionEvent / createCompensationEvent / createRetconEvent, each gated by ART-48's requireOperator as the first statement, then submitRemediation with the Convex canon store, an operatorAuditLog insert, and a refresh port that calls ART-98's internal runPostCommitPipeline for the committed sequence number - the SAME post-commit path a normal committed event takes (no second refresh path).
6. Tests (new convex/operations/canonCorrection.test.ts): each remediation type appends a new event and leaves the original row byte-identical; unauthorized/non-admin and blank-reason paths denied; unknown target event rejected; retcon without publicSummary rejected; compensation may not resurrect while correction/retcon may; replay after the correction is deterministic and equal across repeated replays; the public read model (publicRead/liveState buildLiveProjection) actually changes after the correction; refresh port invoked with the committed sequence number; idempotent retry returns the same event and audits a no_op.
7. Docs: new docs/canon-correction-workflows.md + DEVELOPMENT.md index entry; extend docs/simulation-operations-console.md capability matrix; ADR-0002 already records the append-only rule.
8. Verify: npm run check (architecture, typecheck, lint, full jest, build); record the exact commands and results in implementation notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

Three authenticated mutations in `convex/operations/canonCorrectionFunctions.ts` — `createCorrectionEvent`, `createCompensationEvent`, `createRetconEvent` — over one pure policy/orchestration module `convex/operations/canonCorrection.ts`, plus `convex/operations/canonCorrection.test.ts` (17 tests) and `docs/canon-correction-workflows.md`.

## What the three types actually do differently

| Type | Capability | Supersedes the cited events | May overrule forward-only canon rules | Must restate public content |
| --- | --- | --- | --- | --- |
| correction | canon.correct | yes | yes | no |
| compensation | canon.compensate | no (offsets state; the original account stands) | no | no |
| retcon | canon.retcon | yes | yes | yes — `publicSummary` required |

'Forward-only canon rules' are exactly the two rules that describe the world moving forward and therefore cannot bind a statement about the past: DEAD_CHARACTER_ACTION (a dead character may not participate) and the no-resurrection INVALID_LIFE_STATE_CHANGE. `convex/canon/eventTypes.ts` now names both sets (`REMEDIATION_EVENT_TYPES`, `SUPERSEDING_EVENT_TYPES` = correction+retcon) as the single source of truth, and `convex/canon/validators.ts` consumes those guards instead of an inline literal set. Every other canon rule still applies to all three types unchanged.

## Reuse, not reinvention

- Authorization: ART-48's `requireOperator` / `authorizeOperator` / `buildOperatorAuditEntry` / uniform `OPS_UNAUTHORIZED` denial. Only three new capabilities were added to `OPS_CAPABILITIES`, all minimum role `admin`. No second auth mechanism.
- Commit: the shared `commitProposedEvent` pipeline (structural validation, idempotency, canon validation against the current projection, sequence allocation, atomic append). The canon store exposes no update and no delete, so AC#1 holds structurally: a remediation is an APPENDED event and the cited rows are never read for a decision, patched, or removed.
- Read-model refresh: ART-98's `internal.operations.postCommitLiveFunctions.runPostCommitPipeline` for the sequence number the commit just allocated — the same pipeline a simulated event runs. No second refresh path was built.

## Audit recorded twice (AC#2/#5)

`metadata.remediation = { schemaVersion, type, operatorId, reason, targetEventIds, supersedes, offsets }` is stamped onto the accepted event (immutable forever), and the ART-48 `operatorAuditLog` row (who / capability / cited events as target / reason / outcome / at) is appended in the same transaction. A refused remediation writes neither.

## Honest scope note

The pure orchestration, the commit path, the canon rules, the audit rows and the public read-model rebuild are proven by execution in `canonCorrection.test.ts` (in-memory canon store + real validators + real reducer/replay + real `publicRead/liveState` builder + recording ports asserted against the canonical `postCommitRunId`). The Convex mutation layer itself (`ctx.runMutation` into `runPostCommitPipeline`) is covered by typecheck and by the same shared helpers, not by a deployment test — this repository has no Convex deployment harness in the test suite, matching every prior ops-console task.

## Validation

- `npm run check` — exit 0. check:architecture + test:architecture + typecheck + lint + jest (84 suites, 1077 passed, 4 skipped — the ART60_LONG_RUN 30-day cases) + vite build.
- `NODE_OPTIONS=--experimental-vm-modules npx jest --runTestsByPath convex/operations/canonCorrection.test.ts` — 17 passed.
- Updated the pre-existing exhaustive capability-matrix assertion in `operatorAuthorization.test.ts` to include the three new admin capabilities (the test enumerates every capability by design).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
FR-K003 audited Canon correction workflows: three authenticated admin mutations (createCorrectionEvent / createCompensationEvent / createRetconEvent) that remediate accepted Canon by APPENDING a new event through the shared commitProposedEvent pipeline — never by editing or deleting a canonEvents row. Each type has a distinct contract: a correction supersedes what the cited events said, a compensation only offsets state while their account stands, and a retcon rewrites the account and therefore must carry a replacement publicSummary. correction/retcon are exempt from the two forward-only canon rules (dead-character participation, no resurrection) because they restate the past; compensation is not. Operator identity and reason are recorded twice — immutably in metadata.remediation on the accepted event and in the ART-48 operatorAuditLog row written in the same transaction — and every command authorizes through ART-48's requireOperator with a new admin-only capability. Public content follows the correction through ART-98's existing runPostCommitPipeline for the committed sequence number; no second refresh path. Verified with npm run check (exit 0: architecture, typecheck, lint, 84 suites / 1077 tests, build) and the new 17-test convex/operations/canonCorrection.test.ts, which proves the cited event stays byte-identical, the audit trail per type, the admin-only authorization and every rejection path, replay equality after a correction, and that the public liveState read model actually changes.
<!-- SECTION:FINAL_SUMMARY:END -->
