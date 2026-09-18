---
id: ART-211
title: A scene author may reference a rumorId it was never given
status: To Do
assignee: []
created_date: '2026-09-18 19:06'
labels: []
dependencies: []
ordinal: 208000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during acceptance qualification on day 8, after ART-209 closed.

```
[SCENE_CANON_REJECTED] RUMOR_NOT_FOUND: rumor does not exist in this world
```

`WHOLE_SCENE_JSON_SCHEMA` offers four rumor state-change variants. One of them, `rumor_originated`,
creates the rumor it names. The other three — `rumor_propagated`, `rumor_belief_changed`,
`rumor_corrected` — each take a `rumorId` that must ALREADY exist, and the scene author is told no
rumor ids at all.

They are not unconditionally illegal, which is what makes this narrower than ART-209 and closer to
`character_state_changed` before ART-198: `validateCanon` builds a prospective rumor set as it scans
an event, so a scene that originates a rumor and then spreads it in the same event is legal. A
scene that names a rumorId out of nowhere is not.

The prompt states the neighbouring rule — "a character may only be the fromCharacterId of a
rumor_propagated ... if an earlier accepted change already gave them that rumor" — and that is about
WHO may spread. It does not say which rumorIds EXIST, which is the rule the live world broke.

Two candidate fixes, and the choice is a real one:

- The ART-198 pattern: carry the world’s current rumors (id, claim, holders) on
  `WholeScenePromptContext`, and the three variants become usable for real rather than usable by
  luck. This is the one that gains capability.
- The ART-203 pattern: state that a rumorId must be one this scene originated, and say so in the
  prompt with the scene’s own values.

`canonFeedback` already carries the right correction for `RUMOR_NOT_FOUND` and `RUMOR_SOURCE_NOT_HELD`,
so a retry is told what to do; this is about the first attempt not wasting itself.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A scene author can either see the rumors it is allowed to reference, or is told plainly that it may only reference one this scene originated
- [ ] #2 A live slot no longer fails on RUMOR_NOT_FOUND for a rumorId the author invented
- [ ] #3 No validator is relaxed and the rumor chain rules are unchanged
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
