---
id: ART-121
title: Build Visual Replay playback with honest time-state labelling
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-07 12:19'
labels:
  - prd-2.0
  - v2-g
  - epic-o
dependencies:
  - ART-119
priority: high
type: feature
ordinal: 121000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O013, FR-O014 (PRD 2.0 §12 Epic O, §9.1.4, §10.4)

**Problem / Context:** A viewer arriving between Canon slots sees a world where nothing recently happened. PRD 2.0 §9.1.4 replays the most recent completed scenes from existing data. RISK2-009 warns that replay mistaken for live would corrupt the product's core honesty promise.

**Ownership boundary (review correction):** This task owns the replay schema, construction and playback mechanics only. It does **not** own publication lifecycle integration — withhold/supersede detection and replay invalidation/rebuild triggered by a safety or publication status change is **ART-132's** responsibility (ART-132 depends on this task's schema). This task's scope ends at defining the reference-only payload shape (`publicExcerptId`/`publicSummaryId` + `publicationVersion`) that makes ART-132's invalidation possible.

**Goal:** On entering `/live`, replay the most recent important scenes from existing Canon data, then return to the current ambient state, with the time state always unambiguous.

**Scope:**
- Build `VisualReplay` (PRD 2.0 §10.4) from accepted events, start/end positions, scene summaries, participants, public dialogue highlights and arc progress.
- Playback of 1–3 recent important scenes, roughly 20–60 seconds each, then return to ambient.
- Auto-play at most once per viewing session; manual "replay today" control; always skippable; never loops.
- Persistent time-state labelling distinguishing replay, earlier and now, not by colour alone.
- `dialogue`/`eventCard` steps reference `publicExcerptId`/`publicSummaryId` plus `publicationVersion` — no free-text copies.

**Out of Scope:** Generating any new narrative content; scene visualization of the live active scene (FR-O003); publication-status change detection and invalidation/rebuild triggering (ART-132).

**Dependencies:** FR-O002 Canon-driven movement rendering (ART-119).

**Schema Impact:** New `VisualReplay` derived payload (PRD 2.0 §14.7).

**API Impact:** Public read of replay payloads; strictly derived from already-published data.

**Security Impact:** Replay may only include already-published, safety-approved text; it must trigger no LLM call and no Canon write. The reference-only shape is what makes ART-132's invalidation possible — storing free text would defeat it.

**Test Requirements:** Replay construction tests from fixed event fixtures; an integration test asserting replay adds no LLM trace and no accepted event; session auto-play-once tests; skip and manual-trigger tests; a test that no step stores literal dialogue or summary text.

**Validation Commands:**
- `npm run check`
- Browser E2E: replay auto-plays once, then the view enters the ambient state.

**Documentation Impact:** Replay semantics and time-state labelling documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Entering /live replays one to three recent important scenes of roughly twenty to sixty seconds each
- [ ] #2 Playback finishes by returning to the current ambient state
- [ ] #3 Replay uses only existing accepted events and already-published summaries
- [ ] #4 Replay triggers no LLM call, no re-simulation, no new event and no Canon change
- [ ] #5 A given replay auto-plays at most once per viewing session
- [ ] #6 Viewers can manually trigger a replay of today events
- [ ] #7 Replay never loops or repeats automatically
- [ ] #8 Replay can be skipped at any time to reach the current state
- [ ] #9 The screen always distinguishes replay, earlier and now, and not by colour alone
- [ ] #10 Replay dialogue and eventCard steps reference publicExcerptId or publicSummaryId plus publicationVersion and never store a free-text copy
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
