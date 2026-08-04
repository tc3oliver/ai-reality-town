---
id: ART-61
title: P0 canon and cognition integration suite
status: Done
assignee: []
created_date: '2026-08-02 15:33'
updated_date: '2026-08-04 07:24'
labels:
  - prd-1.0
  - epic-p
milestone: m-0
dependencies:
  - ART-17
  - ART-24
  - ART-25
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: high
type: feature
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
Section 19.2 cases 1, 3, and 4; Public Test AC 3–6

Problem / Context
P0 Canon and cognition invariants need focused integration evidence without depending on P1 rumor or voting features.

Goal
Verify sourced secret acquisition and sharing, deceased-character exclusion from normal scenes, and unique item ownership across repeated transfers.

Scope
P0 integration scenarios for knowledge provenance, alive status, location consistency, item ownership, replay, and duplicate-event protection.

Out of Scope
P1 rumor propagation and viewer voting, covered separately; production deployment.

Dependencies
ART-17, ART-24, ART-25

Schema Impact
No new production domain schema unless explicitly named; owns deterministic fixtures, reports, rubrics, and verification evidence.

API Impact
Test harnesses consume documented domain/public interfaces without adding production mutation endpoints.

Security Impact
Test evidence minimizes sensitive data and never bypasses Canon, safety, authorization, or publication controls.

Validation Commands
npm run check; run the focused Canon/cognition integration command and record its exact result.

Test Requirements
Each scenario runs deterministically, asserts replay equality, and proves invalid transitions are rejected.

Documentation Impact
Update integration-test and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A character acquires and shares a secret only through allowed accepted-event sources with intact provenance.
- [x] #2 A deceased character cannot participate in a normal new scene after replay or retry.
- [x] #3 Repeated item transfers preserve exactly one canonical owner and reject concurrent or duplicate ownership.
- [x] #4 All scenarios are deterministic and retain 100% replay equality.
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
1. Add one new integration test file `convex/knowledge/canonCognitionIntegration.test.ts` (tests only; no new production domain logic). It is placed under `convex/knowledge` because the suite crosses Canon + cognition and `knowledge` is the module allowed to depend on `canon` + `shared` in `architecture/module-boundaries.json`.
2. Build a deterministic in-test world script on top of the real domain surface: `commitProposedEvent` + `InMemoryCanonStore` (with `setCanonRuleContext` for characters/locations/items/initial owners), `replayWorldEvents`, `reduceWorldEvent`, `buildSnapshot`/`replayFromSnapshot`/`assertSnapshotMatchesHistory`, `serializeProjectionDeterministically`/`projectionIntegrityHash`, plus `authorizeKnowledgeRead`, `authorizeMemoryRead`, `retrieveAuthorizedMemories`. `Date.now` is pinned to a fixed value so committed envelopes are byte-identical run to run.
3. Scenario A — sourced secret acquisition and sharing (AC #1, PRD 19.2 case 1, Public Test AC 5): commit source discovery event -> Cassia learns it (`sourceType: observed`, cited `sourceEventId`) + forms a memory -> Cassia tells Rowan in a conversation event (`sourceType: told`, cited accepted `sourceEventId`). Assert every projected knowledge record cites an accepted event id, `learnedAt` matches the sharing event, and reject unsourced learning (`KNOWLEDGE_SOURCE_MISSING`), non-participant learning (`PARTICIPANT_MISMATCH`) and cross-character reads (`KNOWLEDGE_ACCESS_DENIED` / `MEMORY_ACCESS_DENIED`) with no leak into an uninvolved character's ledger.
4. Scenario B — deceased character exclusion (AC #2, PRD 19.2 case 3, Public Test AC 4): commit a death event, retry the identical proposal (idempotency -> `deduplicated`, single event), then prove a normal new scene with the deceased participant is rejected with `DEAD_CHARACTER_ACTION` against (a) the live commit pipeline, (b) a from-scratch full replay projection, and (c) a snapshot-resumed projection. Also prove resurrection is rejected (`INVALID_LIFE_STATE_CHANGE`).
5. Scenario C — unique item ownership (AC #3, PRD 19.2 case 4, Public Test AC 6): multi-hop repeated transfers Cassia -> Rowan -> Bram -> Cassia; assert exactly one canonical owner at every step and one history entry per accepted transfer. Then run concurrent duplicate commits (same idempotency key) and concurrent conflicting commits (distinct keys, same source owner) through `Promise.all`/`allSettled` and assert exactly one accepted transfer, the rest deduplicated or rejected with `ITEM_OWNERSHIP_CONFLICT`, plus rejection of two transfers of one item inside a single event.
6. Scenario D — determinism and 100% replay equality (AC #4): run the whole world script twice into independent stores and assert byte-identical accepted logs, projections and integrity hashes; assert full replay == incremental reduce == snapshot-resumed replay for every snapshot cut point (measured equality rate asserted to be exactly 1); assert `assertSnapshotMatchesHistory` accepts each cut; include `createMistwoodFixture()` equality as the shared deterministic fixture.
7. Verify with `npm run check` (architecture boundaries, architecture tests, typecheck, lint, full jest, build) and record the focused command `npm test -- --runInBand --runTestsByPath convex/knowledge/canonCognitionIntegration.test.ts` output as evidence.
8. Documentation: add `docs/testing/canon-cognition-integration.md` describing the suite, the invariants proven and the exact commands, and link it from `docs/testing/fixtures.md`; update PRD traceability notes in the task.
9. Do not change production domain code unless the suite finds a real defect; if it does, fix minimally and document the defect and fix in the task implementation notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was added

- `convex/knowledge/canonCognitionIntegration.test.ts` (new, tests only): 13 tests in 5 describe blocks covering PRD 19.2 cases 1/3/4 and Public Test AC 3-6. No production domain code was added or changed - the suite drives the existing `commitProposedEvent` pipeline over `InMemoryCanonStore`, `validateCanon`, `reduceWorldEvent`, `replayWorldEvents`, `buildSnapshot`/`replayFromSnapshot`/`assertSnapshotMatchesHistory`, `serializeProjectionDeterministically`/`projectionIntegrityHash`, plus the cognition read gates `authorizeKnowledgeRead`, `authorizeMemoryRead` and `retrieveAuthorizedMemories`.
- `docs/testing/canon-cognition-integration.md` (new): scenario table, per-AC evidence map, commands, and the explicit scope boundaries.
- `docs/testing/fixtures.md`: cross-link so the shared Mistwood fixture page points at the new suite.

## Decisions

- Placement: the suite lives under `convex/knowledge/` because `architecture/module-boundaries.json` allows `knowledge -> canon` and `knowledge -> shared` but forbids `canon -> knowledge`. A canon-side test that imported the cognition read gates would invert the declared dependency direction even though the boundary checker skips `*.test.*` files.
- The suite drives the real commit pipeline instead of hand-built accepted events, so structural validation, Canon validation, idempotency, sequence allocation and provenance are all exercised for real; hand-built events would have proven only the reducer.
- Determinism is pinned three ways: event ids derive from world + sequence, the reducer reads no clock/randomness, and `Date.now` is stubbed to a fixed value so even `acceptedAt` in the accepted envelopes is byte-identical across runs. That is what lets "run the whole script twice and deep-equal the accepted logs" be a meaningful determinism assertion rather than a projection-only one.
- The scenario world uses a 4-character roster (Cassia, Rowan, Bram, Delia). Delia exists so the concurrent conflicting-transfer contest has two *living* candidate recipients after Bram dies; without her the conflict test would trip `DEAD_CHARACTER_ACTION` before ever reaching the ownership check.
- Replay-equality rate is asserted as a computed ratio (`equal / events.length === 1`) over all 11 snapshot cut points rather than a single spot check, so the "100%" claim in AC #4 is measured, not asserted by narrative.

## Findings while writing the suite (no production defect found)

- `WorldProjection.characterAlive` only carries an entry for a character who has an accepted `character_life_changed` event; living characters are absent and default to alive through `CanonRuleContext.initialCharacterAlive`. This is correct and intentional (the projection is derived purely from events), but it is easy to assert wrongly - the suite now asserts `characterAlive` equals `{ bram: false }` and documents why.
- Validation order in `validateCanon` puts the participant alive check ahead of every state-change check, so a proposal that is both "dead participant" and "ownership conflict" reports `DEAD_CHARACTER_ACTION`. Tests that want a specific code must keep the other preconditions valid.
- No production code was modified. Nothing in the suite required a domain fix.

## Verification

- Focused: `npm test -- --runInBand --runTestsByPath convex/knowledge/canonCognitionIntegration.test.ts` -> 1 suite passed, 13/13 tests passed.
- Full gate: `npm run check` -> exit 0. Architecture boundaries valid (policy v1, 11 modules); `node --test scripts/architecture/check-boundaries.test.mjs` 6/6 pass; `tsc --noEmit` clean; eslint clean over all 12 linted convex modules; jest 71 suites / 694 tests passed (up from 70 / 681 before this change); `tsc && vite build` built in 2.35s.

## Scope boundaries kept

- P1 rumour propagation (19.2 case 2) and viewer voting (19.2 case 5) are out of scope and untouched.
- Deceased-character exclusion is proven at the Canon boundary, which is where the invariant is enforced today: any proposed new scene naming the deceased participant is rejected with `DEAD_CHARACTER_ACTION`, before and after replay and after a retry. There is no alive-based filter in `convex/simulation` scene planning; asserting that would require `knowledge -> simulation`, which the module policy forbids, and it belongs to the simulation lane rather than this suite. Recorded in the doc's "Deliberate scope boundaries" section rather than silently omitted.
- 7/30/90 world-day long-run harnesses stay with ART-60 and ART-73.

Post-merge re-verification after syncing `origin/main` (ART-69 landed first): `npm run check` exit 0 again - architecture boundaries valid, typecheck and lint clean, jest 72 suites / 709 tests passed, build succeeded. The 71/694 figure above was measured against the pre-merge base commit.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the P0 Canon/cognition cross-domain integration suite (PRD 19.2 cases 1, 3, 4 and Public Test AC 3-6) as tests only - no production domain logic was added or changed.

New `convex/knowledge/canonCognitionIntegration.test.ts` commits a fixed 11-event scenario world (`mistwood-p0`, 4 characters, 4 locations, 1 unique item, world days 1-3) through the REAL pipeline - `commitProposedEvent` over `InMemoryCanonStore`, structural + Canon validation, the deterministic reducer, replay, snapshots - and then reads it back through the cognition gates `authorizeKnowledgeRead`, `authorizeMemoryRead` and `retrieveAuthorizedMemories`. It lives under `convex/knowledge/` because `architecture/module-boundaries.json` allows `knowledge -> canon` and forbids the reverse.

What the 13 tests prove:
- AC #1 sourced secrets: Cassia's belief cites the accepted fact event, Rowan's belief cites the accepted event where Cassia learned it, `learnedAt` matches the sharing event, and every projected belief/memory cites an event that exists in accepted history AND is declared in the citing event's `causedByEventIds`. Unsourced learning -> `KNOWLEDGE_SOURCE_MISSING`, unknown source -> `UNKNOWN_EVENT_REFERENCE`, bystander -> `PARTICIPANT_MISMATCH`, each with zero writes. Cross-character reads -> `KNOWLEDGE_ACCESS_DENIED` / `MEMORY_ACCESS_DENIED`, and the uninvolved character's ledger stays empty.
- AC #2 deceased exclusion: retrying the identical death proposal deduplicates to the same event id and still yields exactly one life change; a new scene, a movement and a resurrection naming the deceased character are all rejected with `DEAD_CHARACTER_ACTION`, reproduced against the live pipeline, a from-scratch full replay projection AND a snapshot-resumed projection, while a scene between living characters still commits.
- AC #3 unique ownership: after Cassia -> Rowan -> Bram -> Cassia the item has exactly one canonical owner and one history entry per accepted transfer, each citing an accepted event; 8 concurrent retries of one transfer collapse to a single accepted event; two concurrent conflicting transfers from the same owner resolve to one acceptance plus one `ITEM_OWNERSHIP_CONFLICT`; two transfers of one item inside a single event are rejected.
- AC #4 determinism: `Date.now` is pinned, so running the whole script twice into independent stores yields byte-identical accepted logs, projections and integrity hashes. Replay equality is measured, not asserted by narrative - across all 11 snapshot cut points `assertSnapshotMatchesHistory` accepts the snapshot and the snapshot-resumed replay equals the full replay, giving a computed equality rate of exactly 1 (100%).
- Cross-cutting: for every accepted event, located scenes only involve characters standing in that location (Public AC 3), participants were alive when accepted (Public AC 4), sequence numbers are gapless and duplicate-free and idempotency keys unique (Public AC 6), and no belief or memory exists without an accepted source event (Public AC 5).

Documentation: new `docs/testing/canon-cognition-integration.md` (scenario table, per-AC evidence map, commands, explicit scope boundaries) with a cross-link added from `docs/testing/fixtures.md`.

Verification evidence:
- `npm test -- --runInBand --runTestsByPath convex/knowledge/canonCognitionIntegration.test.ts` -> 1 suite passed, 13/13 tests passed.
- `npm run check` -> exit 0: architecture boundaries valid (policy v1, 11 modules), 6/6 boundary tests, `tsc --noEmit` clean, eslint clean, jest 71 suites / 694 tests passed (was 70 / 681), `tsc && vite build` succeeded.

No production defect was found, so no production file was touched. Honest limit, documented rather than silently narrowed: deceased-character exclusion is proven at the Canon boundary where it is actually enforced; there is no alive-based filter in `convex/simulation` scene planning, and asserting one would require a `knowledge -> simulation` dependency that the module policy forbids. P1 rumour propagation and viewer voting, and the 7/30/90-day long-run harnesses, remain with their own tasks.
<!-- SECTION:FINAL_SUMMARY:END -->
