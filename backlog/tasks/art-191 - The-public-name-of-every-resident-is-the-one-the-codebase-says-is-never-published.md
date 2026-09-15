---
id: ART-191
title: >-
  The public name of every resident is the one the codebase says is never
  published
status: Done
assignee: []
created_date: '2026-09-15 14:26'
updated_date: '2026-09-15 16:51'
labels: []
dependencies: []
priority: high
ordinal: 189000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
data/mistwoodCharacters.ts:111 states the rule as a docblock on the field itself:

    /** The canonical public zh-TW label. The seed's romanised name is never published. */
    displayName: string;

MISTWOOD_CHARACTER_VISUALS carries a zh-TW name for all twelve residents — 何俊, 趙銘, 裴嵐, 林映雪, 高文睿, 蘇美珍, 邱安, 羅山, 唐若曦, 沈凱, 吳臻, 方悅. That field is read in exactly one place, convex/visual/mistwoodVisualBindings.ts, and only to bind a sprite. Nothing renders it. Its stated purpose is not honoured anywhere in the product.

What every public surface renders instead is convex/canon/mistwoodSeed.ts's romanised name: He Jun, Zhao Ming, Pei Lan. It reaches a viewer through the published character:<id> projection, whose CHARACTER_ALLOWED_FIELDS includes name, and from there through characterDisplayName in convex/publicRead/displayNames.ts into liveState.displayName, into the onboarding summary, and into the prose substitution ART-183 built.

So ART-183 removed the slugs by substituting precisely the string this codebase says is never published, and ART-186 then spread that string to five more surfaces. Both were right about the mechanism and wrong about the table.

This is not the product decision in ART-190. A name has already been chosen, authored for all twelve residents, and documented as canonical; the defect is that the chosen name is not the one used. Occupations, public profiles, goals, traits, organizations, historical events and location names are all still English and all still ART-190's question.

The fix belongs at the boundary ART-183 already established: convex/publicRead/displayNames.ts is where a public surface asks what a character is called, so that is where the authored zh-TW label must win over the projection's seed name. Resolving it there rather than per-component means the onboarding summary, the prose substitution, liveState and every ART-186 surface all change together and cannot disagree.

convex/visual already imports data/mistwoodCharacters and passes the boundary check, so the import is precedented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every public surface renders a resident's authored zh-TW name: home page, character page, live map chrome, floor plan, character card, scene panel, text live view, relationship graph, onboarding primer
- [x] #2 The romanised seed name appears on no public surface, and a NAMED test scans the resolved output for it rather than trusting the call sites
- [x] #3 A character with no authored label still resolves to the published projection name, and then to the id — no blank, no invented placeholder
- [x] #4 The substitution ART-183 performs inside published prose uses the same table, so a name embedded in a sentence and a name in a list agree
- [x] #5 Fault injection: removing the authored table fails a named test rather than silently reverting to the seed name
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
## Where it was resolved, and why there

`buildCharacterProjection` in `convex/publicRead/worldCharacterProjection.ts`, not in the components and not in `displayNames.ts`.

The seed name reached viewers through TWO paths, and only one of them goes through `characterDisplayName`. The published `character:<id>` projection carries `name` in CHARACTER_ALLOWED_FIELDS, and three clients read that field directly — CharacterPage's h1, the live map's character card, and RelationshipGraphView's per-node useQueries. Fixing `displayNames.ts` would have corrected `liveState.displayName`, the onboarding primer and ART-183's prose substitution while leaving those three showing 「He Jun」. The projection is the single public source of what a character is called, so that is where the authored label has to win.

Keyed on (worldId, characterId), not characterId alone. Character ids are unique within a world, not across them; a second world's `he-jun` is a different person. `visualRuntimeForWorld` in liveStateFunctions.ts gates on the same constant for the same reason. A character the roster does not cover keeps the projection's own name — null rather than a guess.

## Fault injection — four run, three bit first time

1. Canonical lookup removed, back to the seed name — 14 named failures across the whole roster.
2. World gate dropped — failed 'does not reach across worlds, because a character id is unique only within one'.
3. One resident's label replaced with their id (趙銘 -> zhao-ming) — DID NOT BITE. 19/19 passed. The `it.each` derives its expectation FROM `MISTWOOD_CHARACTER_VISUALS` and then asserts against the same table, so the injection changed what was expected as well as what was produced: a validator handed its own input (CLAUDE.md section 9). Fixed by adding an INDEPENDENT property — the field is documented as a zh-TW label, so it may not equal its own id and may contain no ASCII letters. Re-run failed by name.
4. A label reverted to the seed's romanised form (趙銘 -> Zhao Ming) — three named failures, including the roster-wide 'publishes no resident under a name the seed romanised'.

## Two spellings already in the repo

`worldCharacterProjection.test.ts` used 趙明; the authored roster has 趙銘. Both were in the tree before this task. The roster is canonical by its own docblock, so the assertion moved to 趙銘 and the drift is noted there. Roughly twenty other fixture strings across test files spell it 趙明 — test prose, not production output, and rewriting them would be the cosmetic cleanup this batch is told not to do.

## What this does NOT decide

Occupations, public profiles, public goals, traits, organization names, historical events and location footprint names are all still English, and all still ART-190. Only the NAME was already decided; this makes the product use the decision it had already recorded.
<!-- SECTION:NOTES:END -->
