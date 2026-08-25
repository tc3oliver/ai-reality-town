---
id: ART-123
title: Show public conversation and activity hints without leaking private dialogue
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:58'
updated_date: '2026-08-24 19:05'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-119
priority: high
type: feature
ordinal: 123000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O004 (PRD 2.0 §12 Epic O)

**Problem / Context:** Seeing characters talk is central to the live experience, but full private dialogue must never be public and unapproved text must never appear.

**Goal:** Conversation is legible on the map through safe public summaries or status indicators, never raw private dialogue.

**Scope:**
- Public dialogue summary, status or short bubble while characters converse.
- Never render full private conversation.
- Never render content that has not passed safety and publication status.
- Summarise long text so it does not obscure the map.
- Safe fallback state such as "in conversation" when no publishable text exists.

**Out of Scope:** The publication/safety pipeline itself (FR-P004); scene cards (FR-O003).

**Dependencies:** FR-O002 movement and animation rendering.

**Schema Impact:** None.

**API Impact:** Consumes only published, safety-approved public text.

**Security Impact:** A primary leakage surface — requires explicit tests that withheld content cannot render.

**Test Requirements:** Tests that withheld dialogue never renders while the conversing state still shows; long-text summarisation tests; a test that no unapproved text can reach the bubble.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Public dialogue presentation rules.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Conversing characters show a public dialogue summary, status or short bubble
- [x] #2 Full private conversation is never exposed
- [x] #3 Content that has not passed safety and publication status is never shown
- [x] #4 Long content is summarised and does not obscure the main view
- [x] #5 When no publishable text exists a safe state such as in-conversation is still shown
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

`npm run check` green (155 suites, build OK). `npm run e2e` green (66 tests, desktop + Pixel 5).

### Fault injection

1. `applyConversationState` returns the conversation state unconditionally, so a WALKING
   character gets a speech bubble -> 1 failure.
2. The ellipsis appended outside the budget instead of inside -> 4 failures.
3. The card's hint stops checking `status === 'active'`, so an ended scene is quoted
   -> 1 failure.

All three restored from a backup outside the tree and re-verified green (30 tests).

### A claim of my own that was wrong, and is corrected

The first version of this work asserted "the canvas renders no text at all" and wrote a test
for it. The test failed: `MapZoneLayer` draws the eight authored location names. The claim was
false.

Corrected in the code comments, the test and the docs to the narrower and accurate one: no
WORLD-DERIVED text reaches the canvas. The location names are repository constants from
`data/mistwood.ts`, identical on every deploy and public by construction — not a leak surface.
The test now pins that `MapZoneLayer` is the only text constructor in the renderer, that it is
fed from `footprint.name`, and that no renderer file reads a summary or dialogue field at all.
That is both true and what AC#2/AC#3 actually need.

### Three exhaustive guards named this work, all correctly

- `visualReplay.boundary.test.ts` — the replay builder's dependency closure.
- `ambientMotion.boundary.test.ts` — the client bundle's closure, including type-only edges.
- `activeSceneModel.test.ts` — the panel's full display record.

Each was updated deliberately. `conversationState.ts` imports nothing but a type, so it cannot
be a route to the Canon seed; the point of those pins is that saying so is a reviewed decision.

### Not covered

Browser evidence that a speech bubble is DRAWN. The E2E fixture publishes no two-participant
active scene with idle motions, and the indicator is a Pixi vector — asserting it in a browser
means pixel comparison, which ART-137 already recorded as the wrong standard (it proves
something a blind viewer cannot use). The card's text reading, which is what a viewer and a
screen reader both get, is covered by the unit and DOM suites.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Public conversation and activity hints (FR-O004), by lighting up a contract dormant since ART-115.

`PublicAnimationState` has declared `speaking | thinking | activity` since then, the validators
accept them, and `CharacterStateIndicator` already draws the bubble and the cloud — no server code
had ever produced any of the three. So this adds no schema and no field.

The map shows STATE, never words. Choosing the existing vector indicator over a `PIXI.Text`
caption makes AC#2/#3 structural on the map surface: no projection text reaches the renderer.
Stated precisely, because my first version of this claim was wrong and its own test caught it —
the canvas is not text-free (`MapZoneLayer` draws eight authored location names, which are
repository constants). The accurate and sufficient claim is that no WORLD-DERIVED text reaches
it, and that is what the tests now pin.

State comes from PARTICIPATION and text from PUBLICATION. A character reads as `speaking` because
they are in an active scene, decided without reference to `publicationStatus` — which is AC#5
directly, and preserves FR-P004's guarantee that withholding text must not be visible as a
behaviour change on the map. `thinking` is never produced: nothing in Canon records it, and
inventing an inner state from a participant count is the RISK2-008 violation the map exists to
avoid. Only an `idle` motion is refined, because a bubble over a walking figure would claim they
are standing talking.

No second projection field: the hint is a pure function of the already-substituted `summary`, so a
withheld scene's hint is empty BY CONSTRUCTION rather than by a second check that could be written
wrongly. Adding a separately-truncated copy would have created a second place the withhold
substitution has to be applied — a second leak surface for no new information.

Verified: `npm run check` green (155 suites, build OK); `npm run e2e` green (66 tests). Three
fault injections confirm the assertions are not vacuous. Three exhaustive guards named this work
and each was updated deliberately. Docs: `docs/public-conversation-hints.md`; FR-O004 matrix row
updated.
<!-- SECTION:FINAL_SUMMARY:END -->
