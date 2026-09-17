---
id: ART-203
title: >-
  Stop asking the scene author for causedByEventIds instead of only discouraging
  it
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 20:18'
updated_date: '2026-09-17 20:18'
labels: []
dependencies: []
priority: high
ordinal: 200000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ART-201 told the model, in prose, that causedByEventIds must be empty because it has no event ids.
The very next live slot obeyed and committed six events; the one after that did not, and failed
again with:

  mistwood day 5 night -- UNKNOWN_EVENT_REFERENCE at validate_canon
  'causal event does not exist'

So the rule holds only as often as the model chooses to follow it. A field that has exactly one
valid value should not be a field the model is asked to fill.

## The precedent already in this file

ART-139 met the same situation with schemaVersion and sceneId: fields whose correct value is a fixed
constant or an echo of caller-supplied input rather than model-generated content.
`parseWholeSceneOutput` fills those in when the provider omits them, because the caller already
knows their only valid value. causedByEventIds is the same kind of field for a scene author -- the
only value it can correctly hold is [].

## The change

Remove causedByEventIds from proposedEventItem in WHOLE_SCENE_JSON_SCHEMA, so the request stops
asking, and fill [] in the parser when it is ABSENT.

Deliberately NOT: rewriting a value the model did supply. Filling an omitted field whose only valid
value is known is a parse; overwriting a value the model chose is a repair that changes meaning, and
an invented causal link should be refused rather than quietly erased. A volunteered value therefore
still reaches Canon and is still rejected.

This lowers no validation threshold. Canon's rule is unchanged and still enforced.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The request no longer asks for causedByEventIds
- [ ] #2 An omitted causedByEventIds is filled with the empty array, as ART-139 fills schemaVersion and sceneId
- [ ] #3 A value the model did supply is still validated and still refused if invented
- [ ] #4 A test drives the real prompt and asserts the field is absent from the serialized schema
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
