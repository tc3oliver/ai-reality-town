---
id: ART-98
title: Wire live post-commit cognition and editorial pipeline
status: To Do
assignee: []
created_date: '2026-08-04 05:07'
labels:
  - prd-1.0
  - epic-g
  - launch-readiness
dependencies:
  - ART-97
  - ART-83
  - ART-24
  - ART-25
  - ART-26
  - ART-29
  - ART-30
  - ART-31
  - ART-33
  - ART-34
  - ART-51
priority: high
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second half of the live daily-cycle gap (first half: ART-97). After a canon event is committed, the PRD requires character knowledge/memory updates, story-arc classification/lifecycle transitions, daily episode generation, recap pyramid updates, and editorial release so public read models reflect real content (Section 12, Epic E/F/G, ART-83). ART-24/25/26 (knowledge/memory), ART-29/30/31 (arc classification/count-control/stagnation), ART-33/34 (daily episodes/recap pyramid), ART-51 (editorial lifecycle), and ART-83 are all Done as pure, unit-tested logic, but confirmed by grep that convex/operations/postCommitOrchestration*.ts exposes only bookkeeping internalMutations with no caller anywhere in production code -- nothing invokes the knowledge/memory/arc/episode/editorial chain after a commit today. This task wires a live-invokable post-commit orchestration (triggered after ART-97's commit step) that runs: knowledge/memory updates -> arc classification and lifecycle transitions -> daily episode assembly -> recap pyramid update -> editorial release (rebuild the affected publicRead projections). Do not re-implement the underlying pure logic; wire the existing, already-tested modules together.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After ART-97 live-commits a world day, character knowledge/memory projections, story arc lifecycle state, and daily episode records update automatically with no manual per-step script or CLI call
- [ ] #2 Newly committed high-importance events cause the affected read-model projections (character, world, episode, timeline, arc, relationship, liveState, onboarding, arc primer) to rebuild and become servable automatically, not only via manual internalMutation calls
- [ ] #3 An integration test proves that after running one or more live world-days (via ART-97), a public reader (getPublishedReadModel) sees updated content reflecting the new events, with no direct LLM call from the public read path
- [ ] #4 Story Arc lifecycle respects existing FR-F001-F005 rules as already specified by ART-29/30/31/64 -- this task verifies those guarantees hold when driven live, it does not redefine them
- [ ] #5 npm run check passes; the live post-commit entry point is documented in code comments and, if applicable, docs/architecture
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
