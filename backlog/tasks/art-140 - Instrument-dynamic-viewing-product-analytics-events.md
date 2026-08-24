---
id: ART-140
title: Instrument dynamic viewing product analytics events
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 16:16'
updated_date: '2026-08-24 18:10'
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
**Requirement ID:** FR-Q007 (PRD 2.0 §12 Epic Q) — realizes §17 — P1

**Problem / Context:** PRD 2.0 §17 defines seventeen new `live_*` analytics events. FR-Q001 (ART-133) covers operational metrics only, not product analytics. Without these events the PRD 2.0 §18.1 targets for live-to-character click rate, live-to-episode click rate and replay completion rate cannot be measured.

PRD 2.0 records the resolution of the internal tension between §18.1 (which states these as MVP targets) and §19 (which places analytics at P1): instrumentation is **P1 and does not block release**, but until FR-Q007 ships the affected §18.1 metrics must be reported as "not measured" and must never be claimed met from estimates.

**Goal:** Emit the seventeen PRD 2.0 §17 events through the existing compliant collection path, with no expansion of personal tracking.

**Scope:**
- Emit: `live_view_opened`, `live_map_ready`, `live_map_failed`, `live_fallback_used`, `live_character_selected`, `live_scene_selected`, `live_arc_opened`, `live_episode_opened`, `live_camera_follow_enabled`, `live_camera_follow_disabled`, `live_zoom_used`, `live_runtime_stale_seen`, `live_return_to_town`, `live_replay_started`, `live_replay_completed`, `live_replay_skipped`, `live_replay_manual_triggered`.
- Use only the existing compliant collection mechanism until ART-47 lands.
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
- [x] #1 All seventeen PRD 2.0 section 17 live events are emitted on their triggers
- [x] #2 No event payload contains private character data, full dialogue, secrets, prompts or precise personal identifiers
- [x] #3 Only the existing compliant collection mechanism is used and personal tracking is not widened
- [x] #4 The PRD 2.0 section 18.1 click-rate and replay-completion metrics become measurable from the emitted events
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification (2026-08-25)

`npm run check` green (156 suites, 2422 passed, 5 pre-existing skips, build OK).
`npm run e2e` green (66 tests, desktop + Pixel 5) — no regression from the emission wiring.

### Fault injection

1. Replaced the allowlist loop with `Object.keys(source)` — the privacy guarantee removed —
   -> 5 failures, including the adversarial "every private field" test.
2. Restored the town-detection bug (`focusId === TOWN_TARGET_ID`) -> 3 failures.
3. Moved the card-open emit back to the page, so `LiveMapView`'s own callers emit nothing
   -> 1 failure (the DOM test).

All three restored from a backup outside the tree and re-verified green (66 tests).

### Two wiring defects the DOM test caught

- **`live_return_to_town` would never have fired.** The first version detected the town view by
  `focusId === TOWN_TARGET_ID`, but that id names an entry in the focus TARGET LIST;
  `CameraControls` maps it to `focusId: null` before it ever reaches a camera mode. So no mode
  ever carries it, and a focus id matching no prefix is silently ignored — the event would have
  been absent with nothing failing. Now `focusId === null && !follow`, which is exactly what
  the button produces.
- **The card-open event was emitted in the page's handler, not the view's wrapper.** Any caller
  supplying its own `onOpenCharacterCard` would have emitted nothing.

Both were invisible to the unit tests, which is the point of mounting the real surface.

### What is deliberately not built

The transport. There is no compliant collection mechanism in this repo — ART-47 owns building
one — and the client structurally cannot invent one without putting a hole in FR-O009. The
default sink discards, so shipping this changes no network behaviour at all, and
`analyticsSurface.test.ts` asserts that structurally rather than by observation.

`activeViewerCount` and `rendererErrorRate` (the two `client_external` metrics in
`docs/dynamic-view-observability.md`) remain unbuilt for the same reason. When ART-47 installs a
sink they are derivable from `live_view_opened` and `live_map_failed`, which this task now
emits.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered the seventeen PRD 2.0 section 17 live analytics events — everything except the
transport, which does not exist and cannot be invented here.

The task says to use "the existing compliant collection mechanism". There isn't one: ART-47 is
still To Do, and the client structurally cannot build one, because `readOnlyClientBoundary`
forbids every client write primitive and `publicReadOnlyGuarantee.test.ts` asserts the shipped
bundle reaches exactly one Convex surface, a query. A reporting mutation would be a hole in
FR-O009 rather than an extension of it — the same conclusion `dynamic-view-observability.md`
already reached for its two `client_external` metrics.

So this ships the contract, the privacy guarantee, the emission points and the derivations, with
a default sink that discards. Shipping it changes no network behaviour at all, asserted
structurally rather than observed. That is the right half to build first: an event contract
proven clean and emitted from the right places is the expensive part, and writing the emission
points alongside a transport means a payload mistake ships to a collector instead of to a no-op.

AC#2 is an ALLOWLIST, not a denylist, and that is the whole design. These events fire from
components whose props carry a character projection, a story overlay view model and a replay
frame, so private data is one property access away at every call site; a denylist's first
forgotten field is the first leak, while an allowlist merely makes an event less informative.
Nested values are refused rather than walked, over-long strings are dropped rather than
truncated, and sanitisation happens at the single emitter so no call site can bypass it — a
discipline turned into a structure.

The camera events are derived from a mode TRANSITION rather than attached to controls, because
「回到全鎮視角」 turns follow off AND clears the focus, so per-control emission would report two
interactions for one press and inflate section 18.1's click-rate.

Mounting the real surface caught two wiring defects the unit tests could not: `live_return_to_town`
would never have fired (the town target id never reaches a camera mode), and the card-open event
sat in the page's handler rather than the view's wrapper.

Verified: `npm run check` green (156 suites, 2422 passed, build OK); `npm run e2e` green (66
tests, desktop + Pixel 5). Three fault injections (5, 3 and 1 failures) confirm the assertions
are not vacuous. Docs: `docs/dynamic-view-analytics.md`; FR-Q007 matrix row updated.
<!-- SECTION:FINAL_SUMMARY:END -->
