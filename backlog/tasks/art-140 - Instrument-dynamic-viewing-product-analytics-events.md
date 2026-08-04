---
id: ART-140
title: Instrument dynamic viewing product analytics events
status: To Do
assignee: []
created_date: '2026-08-04 16:16'
updated_date: '2026-08-04 16:17'
labels:
  - prd-2.0
  - v2-i
  - epic-q
dependencies:
  - ART-118
  - ART-121
priority: high
type: feature
ordinal: 140000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** PRD 2.0 §17 (dynamic analytics events), enabling §18.1 measurement

**Problem / Context:** PRD 2.0 §17 defines seventeen new `live_*` analytics events. FR-Q001 (ART-133) covers operational metrics only — projection latency, drift, mutation attempts — not product analytics. Without these events the PRD 2.0 §18.1 MVP targets "Live View to Character click rate >= 20%", "Live View to Episode/Arc click rate >= 15%" and "Replay completion rate >= 50%" cannot be measured at all.

Note the internal PRD tension: §18.1 states these as MVP targets, while §19 places analytics in P1. This task delivers the instrumentation so the targets are measurable; whether the targets gate release is a product call recorded on ART-138.

**Goal:** Emit the seventeen PRD 2.0 §17 events through the existing compliant collection path, with no expansion of personal tracking.

**Scope:**
- Emit: `live_view_opened`, `live_map_ready`, `live_map_failed`, `live_fallback_used`, `live_character_selected`, `live_scene_selected`, `live_arc_opened`, `live_episode_opened`, `live_camera_follow_enabled`, `live_camera_follow_disabled`, `live_zoom_used`, `live_runtime_stale_seen`, `live_return_to_town`, `live_replay_started`, `live_replay_completed`, `live_replay_skipped`, `live_replay_manual_triggered`.
- Use only the existing compliant collection mechanism until ART-47 lands; do not widen personal tracking.
- Exclude private character data, full dialogue, secrets, prompts and precise personal identifiers from every payload.

**Out of Scope:** The privacy-preserving analytics platform itself (ART-47, carried forward); operational metrics (ART-133); dashboards.

**Dependencies:** ART-118 (live view surface), ART-121 (replay lifecycle).

**Schema Impact:** Analytics event records only; no Canon impact.

**API Impact:** None public beyond event emission.

**Security Impact:** Payload contents are a privacy surface and require explicit negative tests.

**Test Requirements:** Tests asserting every listed event fires on its trigger, and negative tests asserting no forbidden field appears in any payload.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Analytics event reference for the dynamic surface.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All seventeen PRD 2.0 section 17 live events are emitted on their triggers
- [ ] #2 No event payload contains private character data, full dialogue, secrets, prompts or precise personal identifiers
- [ ] #3 Only the existing compliant collection mechanism is used and personal tracking is not widened
- [ ] #4 The PRD 2.0 section 18.1 click-rate and replay-completion metrics become measurable from the emitted events
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
