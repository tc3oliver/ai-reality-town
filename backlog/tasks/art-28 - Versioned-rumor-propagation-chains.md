---
id: ART-28
title: Versioned rumor propagation chains
status: In Progress
assignee: []
created_date: '2026-08-02 15:32'
updated_date: '2026-09-06 17:32'
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
- [ ] #1 FR-E005: 謠言不得自動轉為 Canon Fact。
- [ ] #2 FR-E005: 不同角色可相信不同版本。
- [ ] #3 FR-E005: 謠言傳播必須由 Event 表示。
- [ ] #4 Automated tests provide evidence for every mapped FR-E005 acceptance criterion, including rejection and failure paths.
- [ ] #5 PRD traceability links FR-E005 to doc-1 and the merged implementation evidence.
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
