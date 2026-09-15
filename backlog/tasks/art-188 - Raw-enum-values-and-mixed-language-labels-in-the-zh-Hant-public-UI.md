---
id: ART-188
title: Raw enum values and mixed-language labels in the zh-Hant public UI
status: Done
assignee: []
created_date: '2026-09-15 14:11'
updated_date: '2026-09-15 15:53'
labels: []
dependencies: []
priority: high
ordinal: 186000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ART-183 gave timeSlot a zh-Hant label table and a test that cross-checks it against canon's TIME_SLOTS. Three more values a public surface prints were not covered, and two headings are written half in English.

- TimelineView.tsx:190 renders 「[日 3 night · conversation]」. Both are raw: timeSlot has a label function that is simply not called here, and eventType has none. EVENT_TYPES in convex/canon/eventTypes.ts is a CLOSED nine-value union, so its table can be complete and cross-checked exactly as the time-slot one is.
- LiveView.tsx:82 prints a location's locationType raw. That one is NOT a closed enum — convex/canon/proposedEvent.ts declares it v.string() and the seed authors it freely — so it takes the factPredicateLabel treatment: label when known, and when not, omit rather than print an English schema word.
- CharacterPage.tsx:233 prints a relationship's type raw. RELATIONSHIP_TYPE_LABELS already exists in src/components/public/relationshipGraphRoute.ts and is used by the graph page alone, so the two pages describe the same edge in two different vocabularies. The table belongs in convex/shared/publicLabels.ts with the rest.
- CharacterPage.tsx:212 heads a section 「所屬 Arc」 while every other surface says 故事線, and LiveView.tsx:138 and ActiveScenePanel.tsx:87 both link out as 「閱讀當日 Episode」 where the rest of the product says 本日故事.

Scope: convex/shared/publicLabels.ts and its test, src/components/public/TimelineView.tsx, LiveView.tsx, CharacterPage.tsx, src/components/live/ActiveScenePanel.tsx, src/components/public/relationshipGraphRoute.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every event type renders in Chinese, and a NAMED test fails when a value is added to canon's EVENT_TYPES without a label
- [ ] #2 A relationship type is described with one vocabulary across the character page and the relationship graph
- [ ] #3 An unlabelled locationType is omitted rather than printed, and a NAMED test pins that
- [ ] #4 No public surface renders a bare English identifier for timeSlot, eventType, locationType or relationshipType
- [ ] #5 所屬 Arc and 閱讀當日 Episode are replaced by the vocabulary the rest of the product uses
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Three values, three different guarantees, because each has a different kind of vocabulary.

EventType is a CLOSED canon union, so LABELLED_EVENT_TYPES is cross-checked against EVENT_TYPES in both directions — the same treatment ART-183 gave TIME_SLOTS, and the strongest form available. relationshipType and locationType are both v.string() in Canon and cannot be checked that way.

The relationshipType defect was not a missing table but a SECOND one: RELATIONSHIP_TYPE_LABELS lived in relationshipGraphRoute.ts and served the graph alone while CharacterPage rendered the same edge's type raw. That is the identical 'two surfaces, one relationship, two vocabularies' shape ART-187 fixed for the NAME, one field to its left on the same row.

locationType takes the factPredicateLabel treatment — null for an unknown value, caller omits the line — and the reason it differs from a fact is worth keeping: a fact's VALUE is public prose written for a reader, so showing it alone is safe; a location type carries nothing a viewer loses, because the place's name and description are beside it.

The location-type test scans mistwoodWorldConfiguration rather than a hand-written list, and asserts the scan is non-empty first so an empty roster cannot make the block vacuous.

## Fault injection — four, all bit

1. Canon gains an event type with no label — three named failures including the cross-check.
2. locationTypeLabel falls back to the raw value — failed 'returns null — not the raw value'.
3. One seeded location type loses its label — failed the seed scan.
4. relationshipTypeLabel returns the raw value — three named failures including 'is ONE table'.

## Caught after the first CI run

dynamicView.spec.ts named the scene panel's Episode link by its visible text, which this task renamed from 「閱讀當日 Episode」 to 「閱讀本日故事」. npm run check passed because the assertion lives in the Playwright suite, which check does not run — the trap CLAUDE.md section 7 names explicitly. Fixed in a second commit; full local E2E then 124 passed.
<!-- SECTION:NOTES:END -->
