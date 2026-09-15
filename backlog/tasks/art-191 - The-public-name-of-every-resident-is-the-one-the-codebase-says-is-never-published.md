---
id: ART-191
title: >-
  The public name of every resident is the one the codebase says is never
  published
status: To Do
assignee: []
created_date: '2026-09-15 14:26'
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
- [ ] #1 Every public surface renders a resident's authored zh-TW name: home page, character page, live map chrome, floor plan, character card, scene panel, text live view, relationship graph, onboarding primer
- [ ] #2 The romanised seed name appears on no public surface, and a NAMED test scans the resolved output for it rather than trusting the call sites
- [ ] #3 A character with no authored label still resolves to the published projection name, and then to the id — no blank, no invented placeholder
- [ ] #4 The substitution ART-183 performs inside published prose uses the same table, so a name embedded in a sentence and a name in a list agree
- [ ] #5 Fault injection: removing the authored table fails a named test rather than silently reverting to the seed name
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
