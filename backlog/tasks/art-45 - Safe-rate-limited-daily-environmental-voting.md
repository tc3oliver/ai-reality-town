---
id: ART-45
title: Safe rate-limited daily environmental voting
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-08-25 13:13'
labels:
  - prd-1.0
  - epic-l
milestone: m-0
dependencies:
  - ART-15
  - ART-56
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-J001

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Offer 3–4 validated environmental candidates, enforce per-device daily limits and cutoff, select one winner, and inject it as a proposed world event without prescribing outcomes.

Scope
Offer 3–4 validated environmental candidates, enforce per-device daily limits and cutoff, select one winner, and inject it as a proposed world event without prescribing outcomes.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-15, ART-56

Schema Impact
Viewer Intervention, vote, consequence, analytics, or authenticated progress schemas explicitly named by the task.

API Impact
Untrusted viewer command/ingestion interfaces and privacy-safe read/aggregate queries.

Security Impact
Rate limits, authorization, injection defenses, data minimization, and no direct character control are mandatory.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Tests cover candidate rules, abuse limits, cutoff/tie behavior, injection, safety, and canon rejection.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-J001: 候選事件通過安全與 Canon 檢查。
- [x] #2 FR-J001: 每個裝置每日投票次數受限。
- [x] #3 FR-J001: 投票截止後只有一項勝出。
- [x] #4 FR-J001: 勝出事件作為 Proposed World Event 注入。
- [x] #5 FR-J001: 勝出不代表指定後續結果。
- [x] #6 Automated tests provide evidence for every mapped FR-J001 acceptance criterion, including rejection and failure paths.
- [x] #7 PRD traceability links FR-J001 to doc-1 and the merged implementation evidence.
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
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Architectural decision (recorded before coding)

FR-J001 is the project's ONLY viewer write. The repo enforces a machine-checked
read-only public surface (`readOnlyClientBoundary` + `publicFunctionSurface` in
`architecture/module-boundaries.json`; `convex/publicRead/publicReadOnlyGuarantee.test.ts`),
and `validatePolicy` currently rejects ANY public mutation that is not operator-gated.

Reading the PRDs rather than the enforcement prose: PRD 2.0 §22.16 says 「公開**觀看**不執行
任何成功 Mutation」, FR-O009 scopes the claim to `/live`, and RISK2-002 is 「公開**觀看**意外
啟動模擬」. The guarantee is about VIEWING. PRD 1.0 §5.1 G11 / FR-J001 / §16.1 投票參與率 and
PRD 2.0 §13 (ART-45 "Carry Forward") simultaneously require a viewer ballot. Both hold only if
"viewing never writes" is proven PER SURFACE instead of by a blanket repo-wide ban.

So: add exactly one declared, safety-gated viewer write channel, and make the enforcement
STRICTER around it rather than looser. Rejected alternative: ship the domain server-side with no
intake (AC#2 would then have zero production callers — the same "latent" defect the closure
matrix already records against FR-L003 — i.e. fake completion).

## Steps

1. `convex/shared/environmentVoteCatalog.ts` — the FR-J001 acceptable candidate catalog
   (停電/暴雨/道路封閉/陌生人抵達/報社匿名文件/工廠停工/節慶取消) as pure environment-fact
   descriptors. In `shared` so BOTH `viewer` and `simulation` may read it without a boundary
   violation, and so a viewer can only ever select a server-owned id — never author text.
2. `convex/viewer/environmentVote.ts` — pure domain: deterministic 3–4 candidate selection per
   world-day; candidate safety + Canon-shape validation (AC#1); per-device daily rate limit
   (AC#2); cutoff + deterministic single-winner tie-break (AC#3); winner → queued environment
   intervention (AC#4); catalog shape forbids character outcomes (AC#5).
3. `convex/viewer/schema.ts` — `environmentVoteRounds`, `environmentVoteBallots`,
   `environmentVoteInterventions` (§13.13 Viewer Intervention).
4. `convex/viewer/environmentVoteFunctions.ts` — one anonymous ballot QUERY plus one
   viewer-gated `submitEnvironmentVote` MUTATION; internal round close.
5. `convex/simulation/worldDayLiveFunctions.ts` — `loadScheduledEnvironmentEvents` stops
   returning `[]` and reads queued interventions, building the ProposedEvent server-side from
   the catalog. Injection then goes through the EXISTING structural + Canon commit pipeline.
6. `architecture/module-boundaries.json` + `scripts/architecture/check-boundaries.mjs` — new
   `viewerWriteBoundary`: a `gate: "viewer"` public mutation must live under `convex/viewer`,
   be double-declared, be capped at `maxAnonymousMutations`, name the safety classifier and the
   rate limiter, and may not name any Canon-write symbol. New `clientViewerWrite` module which
   `clientWorldReadOnly`/`clientLive` may NOT depend on; one `exemptFiles` entry for one hook
   file and only the `useMutation` symbol.
7. `src/components/vote/` — pure ballot view model + thin form; `homeRoute.voteAvailable`
   derived from published ballot state instead of hard-coded `false`.
8. Tests: unit suites for every pure module, boundary policy tests, and updates to
   `publicReadOnlyGuarantee.test.ts` so the per-surface claim is what is asserted.
9. `docs/daily-environment-vote.md`; update `docs/public-read-only-guarantee.md`,
   `docs/prd-2.0-requirement-matrix.md`, `docs/prd-1.0-closure-matrix.md`.
10. `npm run check` green; fault-injection evidence recorded in notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Architectural decision: the read-only guarantee, made per-surface

This is the project's first and only viewer WRITE, and it collided with the machine-enforced
read-only public surface (ART-128 / FR-O009). `validatePolicy` rejected any public mutation that
was not operator-gated; `readOnlyClientBoundary` forbade `useMutation` anywhere under `src`; the
guarantee suite asserted the shipped bundle named exactly one Convex function and that it was a
query.

Resolved from the PRDs rather than from the enforcement prose. PRD 2.0 §22.16 says 「公開**觀看**
不執行任何成功 Mutation」, FR-O009 scopes the claim to `/live`, RISK2-002 says 觀看; meanwhile PRD
1.0 §5.1 G11 / FR-J001 / §16.1 投票參與率 and PRD 2.0 §13 (ART-45 "Carry Forward") require a
viewer ballot. Both hold only if "viewing never writes" is proven PER SURFACE instead of by a
repo-wide ban. Full reasoning and the rejected alternative: `docs/daily-environment-vote.md` §2.

Enforcement around the exception is STRICTER than what it replaced:

- `anonymous` still means read-only; `validatePolicy` still rejects an anonymous mutation.
- The new `viewer` gate needs TWO declarations (`publicFunctionSurface.allowed` AND
  `viewerWriteBoundary.allowed`).
- New `viewerWriteBoundary`: must live under `convex/viewer`; `maxViewerMutations: 1`; never an
  action; the module must NAME `classifyViewerInput` and `evaluateVoteSubmission` (the only rule
  in the policy that fails on ABSENCE); may name no Canon-write symbol.
- Client: one exemption, one file, one symbol — and a new rule makes an exemption grantable ONLY
  under `src/components/vote`. `/live`, the world renderer, every public page and the app shell
  are covered by exactly the check they always were.

## A vote structurally cannot author a world fact

`viewer` writes a catalog id + target day and stops. `viewer` may not depend on `canon`;
`simulation` may not depend on `viewer`; the queue's contract is the TABLE. `simulation` rebuilds
the Proposed World Event from `convex/shared/environmentVoteCatalog.ts` (reviewed repo source),
`proposedBy: system`, then puts it through the existing structural + Canon pipeline.

## Abuse resistance (first-class, not an afterthought)

1 accepted vote/device/round; 5 submissions/device/round counting REFUSALS (so the endpoint is
not a free oracle); 100k submissions/round (one row per (round, device), so key rotation buys
rows out of a fixed budget); closed candidate set; `classifyViewerInput` runs BEFORE the id is
compared. An exhausted device writes nothing at all. `deviceKey` is a random browser token, not a
fingerprint — stated plainly rather than overclaimed; an IP-derived key was rejected (shared NAT
disenfranchises a building, rotating proxies defeat it, and §15 would then have to carry a
personal-data field). Stored as a 64-bit digest — 64 bits for CORRECTNESS, since a 32-bit digest
collides across a full round and would silently merge two strangers' vote budgets.

## Verification

`npm run check` GREEN, end to end:

- `check:architecture` — Architecture boundaries valid (policy v1, 19 modules)
- `test:architecture` — 37 pass, 0 fail (was 30; +7 viewer-write-gate tests)
- `check:asset-licenses` — 24 assets verified; `test:asset-licenses` 21 pass, 0 fail
- `typecheck` — clean; `lint` — clean
- `test` — 169 suites, 2629 passed, 5 pre-existing skips, 0 failed (2634 total)
- `build` — tsc + vite, built in 2.12s

New/updated suites: `convex/viewer/environmentVote.test.ts` (30),
`convex/viewer/environmentVoteInjection.test.ts` (9),
`src/components/vote/environmentVoteModel.test.ts` (10),
`src/components/vote/voteDeviceKey.test.ts` (6),
`convex/publicRead/publicReadOnlyGuarantee.test.ts` (37 -> 43),
`src/components/world/readOnlyWorldSurface.test.ts` (+2 tests),
`scripts/architecture/check-boundaries.test.mjs` (30 -> 37).

## Fault injection (non-vacuity)

Backups taken with `mktemp -d` + `cp` (`/tmp/art45-fi-0Wm63m`), mutated in place, restored from
the copies. No `git checkout` was used on any mutated file.

| # | Mutant | Failures caught |
|---|---|---|
| 1 | Drop the per-device accepted-vote limit | 2 |
| 2 | Stop counting refused attempts toward the budget | 2 |
| 3 | Tie-break made order-dependent (`>` -> `>=`) | 1 |
| 4 | Catalog gains 指定犯人 + a prompt-injection description | 4 |
| 5 | Proposal names a character in `participantIds` | 2 |
| 6 | Policy loosened: `maxViewerMutations: 99`, `clientRoots: ["src"]` | 2 |
| 7 | Move the write out of the exempt file into the panel | 1 boundary error + 1 test |

Total: 14 injected failures across 7 mutants. Every one was caught by an assertion that names the
property it protects.

## Deliberately NOT done

- FR-J002 vote-consequence tracking (ART-46). The attribution it needs IS laid down — the `vote:`
  idempotency-key prefix survives into accepted Canon and the applied event id is recorded — but
  presenting causality is ART-46's job.
- `vote_viewed` / `vote_submitted` analytics (§17, ART-47). §18.1's participation metric stays
  「未量測」.
- Authenticated voting (ART-71). FR-J001 says 每個裝置.
- Operator control over a round. No console command opens, closes or overrides a ballot — a
  hand-picked winner is exactly what a stated tie-break rule exists to prevent.

## Flagged for ART-138 (release gate)

§22 item 16 must be recorded as "zero successful mutations caused by VIEWING; one deliberately
declared ballot write exists", not "zero anywhere". Written into
`docs/public-read-only-guarantee.md` §9 and `docs/prd-2.0-requirement-matrix.md` §5.6 so the gate
run does not meet it as a surprise. `e2e/dynamicView.spec.ts` is unchanged and still asserts zero
writes from `/live` through two independent mechanisms.
<!-- SECTION:NOTES:END -->
