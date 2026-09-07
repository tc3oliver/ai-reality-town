---
id: ART-28
title: Versioned rumor propagation chains
status: Done
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-09-07 00:37'
labels:
  - prd-1.0
  - epic-g
milestone: m-0
dependencies:
  - ART-24
  - ART-25
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-E005

Problem / Context
PRD 1.0 requires this independently reviewable capability and durable evidence; conversation context is not an implementation source.

Goal
Track rumor origin, transmission chain, versions, credibility, objective truth, corrections, and character-specific belief via events.

Scope
Track rumor origin, transmission chain, versions, credibility, objective truth, corrections, and character-specific belief via events.

Out of Scope
Unlisted adjacent features, production deployment, and changes that bypass Canon, safety, idempotency, or publication controls.

Dependencies
ART-24, ART-25

Schema Impact
Character Knowledge, Memory, compression, retrieval-trace, or rumor-chain records named by the task.

API Impact
Authorized cognition queries and event-derived update interfaces; no cross-character unrestricted access.

Security Impact
Private knowledge/memory is least-privilege, source-proven, and excluded from public output.

Validation Commands
npm run check; run the focused unit, integration, or end-to-end test command added by this task and record the exact command and result in implementation notes.

Test Requirements
Integration tests cover multi-hop propagation, mutation, correction, and replay.

Documentation Impact
Update relevant architecture, development, operations, API, and PRD traceability documentation.

Definition of Done
Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-E005: 謠言不得自動轉為 Canon Fact。
- [x] #2 FR-E005: 不同角色可相信不同版本。
- [x] #3 FR-E005: 謠言傳播必須由 Event 表示。
- [x] #4 Automated tests provide evidence for every mapped FR-E005 acceptance criterion, including rejection and failure paths.
- [x] #5 PRD traceability links FR-E005 to doc-1 and the merged implementation evidence.
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
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## What exists today, and what does not

Surveyed before planning:

- `canon/eventTypes.ts` has a `rumor` event type; nothing consumes it as a chain.
- `sceneSimulation.ts` accepts a `rumors[]` collection on whole-scene output — but its own prompt calls these "short narrative notes about a proposed event, not state changes", with exactly `{sourceCharacterId, content, proposedEventIndex}` and explicitly no confidence or visibility.
- `publicDynamicProjection.ts` mentions rumors only as text.
- `knowledge/` has the ledger (ART-24) and subjective memory (ART-25), both Done, and both already model per-character belief with provenance.

So FR-E005's seven obligations — origin, transmission chain, versions, credibility, objective truth, corrections, character-specific belief — are entirely unimplemented. The existing `rumors[]` is a narrative note, not a propagation record, and must not be mistaken for a partial implementation.

## Approach

1. Model the rumor chain as CANON, not as a derived table. Origin, each transmission, each version and each correction are events; the chain is a projection replayed from them. Anything else would let a rumor's history be edited in place, which ADR-0001 forbids.
2. Keep OBJECTIVE TRUTH and BELIEF strictly separate. Truth is a property of the world; belief is per character and is already the knowledge ledger's job. The projection must be able to say "A believes v2, B believes v1, the world says neither" without those three living in one field.
3. Credibility is derived, never authored. A model that could write a credibility score would be authoring the world's opinion of its own output.
4. Corrections supersede rather than mutate: a corrected rumor keeps its prior version readable, because "who believed the wrong version, and when" is the thing the feature exists to answer.
5. Public exposure last, and behind the existing safety/publication gates — a rumor chain is exactly the shape of content that can leak a Canon secret.

## Sequence

1. Extend the versioned proposed-event contract with the rumor-chain state changes, and pin the schema.
2. Add the deterministic chain projection with replay tests, before any provider involvement.
3. Wire the scene author's existing `rumors[]` into proposals through Canon validation, keeping the note/record distinction explicit.
4. Integrate per-character belief with the knowledge ledger rather than duplicating it.
5. Public read model, gated.

Fault injection is required at each step; a passing test is not evidence a guarantee holds.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was there, and what it was not

FR-E005 was entirely unimplemented, and two things looked like partial implementations without
being any:

- `canon/eventTypes.ts` declared a `rumor` event type that nothing consumed as a chain.
- `sceneSimulation.ts` accepts a `rumors[]` collection whose own prompt calls it "short narrative
  notes about a proposed event, not state changes", with exactly
  `{sourceCharacterId, content, proposedEventIndex}` and explicitly no confidence or visibility.

Neither carried origin, chain, versions, credibility, objective truth, corrections or per-character
belief. `rumors[]` survives as narrative colour, and the prompt now says outright that a note never
creates a tracked rumor.

## Domain model

Four state changes, because the PRD asks for four separable histories: `rumor_originated`,
`rumor_propagated`, `rumor_belief_changed`, `rumor_corrected`. Collapsing them would make "A was
told, then B doubted" indistinguishable from "A doubted, then B was told", and the order is the
story. The chain is folded by the deterministic reducer, so history cannot be edited in place.

Two of the six PRD fields are DERIVED and cannot be authored:

- 客觀真假 by asking Canon about the claim (`unknown` until a `fact_created` settles it, then a
  strict comparison). A provider that could write it would be authoring the world's verdict on its
  own output, which is AC#1 with the rule removed.
- 可信程度 by folding what holders currently make of it (believes 1, doubts 1/2, rejects 0),
  in character-id order. The sort is load-bearing: a projection loaded from a stored snapshot need
  not preserve object key order, and an unsorted fold would make a snapshot-resumed world disagree
  with an identical replayed one, which `projectionIntegrityHash` reports as corruption.

`rumor_originated` carries a fact-SHAPED claim without being a fact, which is what makes objective
truth derivable rather than asked-of-the-author.

## Knowledge-ledger integration

No second store. A rumor holding is an ordinary `characterKnowledge` record with `rumorId`,
`rumorVersionId` and `rumorStance` attached, superseded through the ledger's own
`correctsKnowledgeId`/`correctedByKnowledgeId` link. Propagation pins `sourceType: 'told'` so
hearsay cannot claim to be first-hand; an origin may declare any source type except `told`.
`factId` is `rumor:<rumorId>` -- naming the claim without asserting a fact exists. `truthStatus`
records what Canon could have said AT THE MOMENT OF LEARNING, which is what a misconception is
made of.

## Enforcement

- A character may only pass on, doubt or correct a rumor that reached them
  (`RUMOR_SOURCE_NOT_HELD`), enforced in `validateCanon` AND again in the reducer, because a
  projection built by replay must not depend on validation having run.
- `RUMOR_CANNOT_BECOME_FACT` in either order, plus no `fact_created` at all on a `rumor` event.
- An unattributed correction is the world speaking, so only `admin`/`system` may issue one.
- Public read carries nothing: the field names are forbidden ahead of any emitter, and the
  character/world builders are fixed allowlists.

## Verification

- `npm run check`: exit 0. Architecture boundaries valid (policy v1, 20 modules). typecheck clean,
  lint clean (4 pre-existing warnings in `liveStateFunctions.ts`, 0 errors), build OK.
  **221 suites / 3677 passed, 11 skipped, 3688 total.**
- `npm run e2e`: **82 passed** (2.6m).
- Focused: `convex/canon/rumorChain.test.ts` 35, `convex/knowledge/rumorLedger.test.ts` 14,
  `convex/publicRead/rumorPublicBoundary.test.ts` 7.

## Fault injection (8 of 8 reddened a named test; no run reported `Tests: 0 total`)

1. rumor seeded into `emptyProjection` (state with no event) -> "a narrative rumors[] note is not a rumor"
2. propagation hop dropped -> 3 tests including "records origin, chain, current version..."
3. unsourced acquisition -> "refuses a hop from someone the chain never reached"
4. `fact_created` pushed from `rumor_originated` -> "produces no projected fact..."
5. holders merged across characters -> 8 tests across two suites
6. correction rewriting its version instead of appending -> "records the correction against the version it corrected"
7. `cloneProjection` truncating versions and hops -> "resuming from a mid-chain snapshot yields the same rumors"
8. rumor content written into the public character payload -> "publishes no rumor content..."

Injection 3 found a real hole rather than confirming one: removing canon validation's holders
check ALONE left every test green, because the reducer refuses the same hop with the same code.
Two enforcement points is the right design, but neither was isolated, so either could have been
deleted unnoticed. Two tests were added to pin them separately.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
FR-E005 delivered as Canon: four state changes (rumor_originated / rumor_propagated /
rumor_belief_changed / rumor_corrected) folded by the deterministic reducer into a replayable
chain carrying origin, propagation chain, versions, credibility, objective truth and known
corrections.

The two fields a provider must not author are DERIVED: objective truth by asking Canon about the
claim, credibility by folding what holders currently make of it (sorted by character id, so a
snapshot-resumed world cannot disagree with a replayed one). Per-character belief is the existing
knowledge ledger with a rumorId/rumorVersionId/rumorStance link rather than a second store, so
「角色知道什麼」 keeps one answer with its provenance and authorization attached.

AC#1 is enforced structurally (no rumor path writes `facts`) and by refusal
(RUMOR_CANNOT_BECOME_FACT, in either change order). The chain rule -- a character may only pass on
a rumor that reached them -- is enforced in canon validation and again in the reducer. Rumor
chains are internal; a character sees only what reached them, and no public read model carries a
rumor field.

Verified: npm run check exit 0 (221 suites / 3677 passed, 11 skipped, boundaries valid, build
clean); npm run e2e 82 passed; 8/8 fault injections reddened a named test, none reporting
Tests: 0 total. Injection 3 found a real test hole -- removing canon validation's holders check
alone left everything green because the reducer refuses the same hop -- and two tests were added
to pin the two enforcement points separately. PR #239, auto-merge enabled.
<!-- SECTION:FINAL_SUMMARY:END -->
