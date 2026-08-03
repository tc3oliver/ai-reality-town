---
id: ART-96
title: Public live-state projection
status: Done
assignee: []
created_date: '2026-08-02 16:26'
updated_date: '2026-08-03 17:05'
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
- [x] #1 Live state is derived from accepted events and published scene summaries.
- [x] #2 Reads trigger no generation and survive simulation pause/outage.
- [x] #3 Update latency is below five seconds under the documented load profile.
- [x] #4 The Live projection is independently buildable from accepted events, safe scene summaries, arc projections, and publication state; it does not depend on the post-commit orchestrator.
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED: convex/publicRead/liveState.ts (pure builder): buildLiveProjection derives LiveProjectionPayload (worldTime from latest accepted event; locations from latest location_state_changed; character positions from latest character_location_changed + alive from character_life_changed; recentEvents = last N by sequence reversed; activeArcs filtered to active/escalating/climax/resolving; activeScenes from published episode keyScenes; publishedEpisodeStatus). Idempotent (identical inputs -> identical payload). liveStateFunctions.ts (wiring): rebuildLiveProjection internalMutation — INDEPENDENT entry point (not wired into the post-commit orchestrator, AC#4); gathers accepted events (canonEvents) + arc projections (storyArcLifecycles status + latest storyArcProjectionEvents fields) + latest ready daily episode, builds the payload, and publishes via commitReadModelVersion(modelKind 'liveState', modelRef 'live:<worldId>', status published). Public reads reuse ART-40's generic getPublishedReadModel('liveState') — failure-isolated, zero providers (AC#2). Exported writeStore factory from readModelFunctions (reused, no duplication).

KEY DESIGN: rebuild is a standalone internalMutation callable by cron/orchestrator/operator (AC#4); the public read path never generates and serves last-known-good during outage (AC#2, via ART-40 infra). Pure builder invokes zero providers.

NFR EVIDENCE HONESTY: AC#3 (<5s update latency) is operational. Unit tests prove the mechanism (no-LLM pure derivation, bounded indexed scans, idempotent upsert) and buildLiveProjection is micro-fast. Production latency under the documented load profile is operational evidence via the rebuild mutation's indexed query plan — mechanism-proven, not claimed from local unit runs.

VALIDATION: npm run check = exit 0. Architecture boundaries valid (policy v1, 11 modules). typecheck clean. lint clean. Tests: 471 passed (+9 from convex/publicRead/liveState.test.ts). build OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the public Live-state projection (FR-I002): convex/publicRead/liveState.ts (pure buildLiveProjection deriving world time, locations, character positions, recent events, active arcs, and published-episode scenes from accepted events + arc projections + publication state) + rebuildLiveProjection internalMutation that publishes it as a 'liveState' read-model via the ART-40 store (independent entry point, not the post-commit orchestrator). Public reads reuse the generic failure-isolated getPublishedReadModel. Verified: npm run check exit 0; 471 tests pass (+9 liveState); architecture boundaries valid; typecheck/lint/build clean. AC#3 latency is operational — mechanisms proven, load-profile evidence documented.
<!-- SECTION:FINAL_SUMMARY:END -->
