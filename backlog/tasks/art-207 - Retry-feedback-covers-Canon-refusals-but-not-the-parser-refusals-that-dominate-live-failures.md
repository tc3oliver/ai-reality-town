---
id: ART-207
title: >-
  Retry feedback covers Canon refusals but not the parser refusals that dominate
  live failures
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-18 02:34'
updated_date: '2026-09-18 02:34'
labels: []
dependencies: []
priority: high
ordinal: 204000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From inspectAuthoringFailures on colorless-deer-917, 20 most recent authoring failures:

  SCENE_OUTPUT_INVALID              13   'relationship endpoints must differ',
                                         'character is not a Scene participant',
                                         'must be a non-empty string'
  INVALID_EVENT_SHAPE                4   'fromValue does not match the selected state field',
                                         'sourceEventId has invalid reference format'
  SCENE_OUTPUT_PROVENANCE_MISMATCH   2
  PROVIDER_EXCEPTION_CANON_ERROR     1
  SCENE_CANON_REJECTED               0

ART-205 built a feedback loop so a refusal becomes the next attempt's instruction, and wired it to
Canon refusals only. Every failure above is a PARSER refusal from parseWholeSceneOutput, which is
retried with the identical prompt -- the same request that produced the rejected answer. Zero
SCENE_CANON_REJECTED rows exist, so the loop that was built is not the loop the world needs.

The retry is not useless: a stochastic model sometimes produces a valid scene on the second sample.
But it is a reroll, not a correction, and the evidence is that it frequently rerolls into the same
rule.

## The fix

Extend the ART-205 feedback path to parser refusals. The mechanism already exists -- the refusal is
already classified, the prompt already carries a correction block first, and canonFeedback.ts
already maps codes to instructions. What is missing is that parseWholeSceneOutput's own errors are
thrown rather than turned into feedback.

Instructions are needed for the SCENE_OUTPUT_* codes, keyed on code as the existing table is.

## Open question this does NOT answer

Stage 8 refuses DUPLICATE_CHARACTER_MOVEMENT on scenes the ART-205 authoring check passed, and no
SCENE_CANON_REJECTED row has ever been written. The wiring is present and the query works when
called directly. Why the in-authoring check does not refuse what stage 8 refuses is unexplained and
is NOT assumed to be fixed by this task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A parser refusal becomes the next attempt's instruction, as a Canon refusal already does
- [ ] #2 The instruction table covers the SCENE_OUTPUT_* codes the live world actually produces
- [ ] #3 A test drives a parser refusal and asserts the correction reaches the retry request
- [ ] #4 The existing Canon-refusal path is unchanged
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
