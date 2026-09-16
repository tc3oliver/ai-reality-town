---
id: ART-190
title: Decide the language of the authored Mistwood world content
status: In Progress
assignee: []
created_date: '2026-09-15 14:12'
updated_date: '2026-09-16 00:06'
labels: []
dependencies: []
priority: high
ordinal: 188000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This is a PRODUCT DECISION, recorded so it is not made by accident inside a presentation fix. Nothing in it is a repository defect, and no part of it should be implemented before the decision is made.

The public UI is zh-Hant with no i18n framework (CLAUDE.md section 9). The world it describes is authored in English. ART-183 and its successors remove the internal identifiers a viewer was being shown; what is left underneath is English prose that was written deliberately, by a person, as world content.

## Inventory — production-visible English authored content

convex/canon/mistwoodSeed.ts
- Every resident's name: He Jun, Zhao Ming, Pei Lan, Lin Yingxue, Gao Wenrui, Su Meizhen, Qiu An, Luo Shan, Tang Ruoxi, Shen Kai, Wu Zhen, Fang Yue. Published through CHARACTER_ALLOWED_FIELDS, so this is the string every surface renders once the ids are gone.
- occupation, publicProfile, publicGoal, personality traits and values — all allowlisted, all rendered on the character page and the live map's character card.
- World name Mistwood, plus description, background, era, technologyLevel, geographyRules, socialRules, laws and taboos.
- Organizations: Mistwood Council, Mistwood Chronicle, Northwater Cooperative, with English descriptions.
- Historical events: The Station Flood, Northwater Rescue, Archive Room Fire.

data/mistwood.ts
- Location footprint names: Mistwood Station, Town Hall, Mistwood Chronicle, Lantern Square, Juniper Clinic, Northwater Mill, Bellweather Orchard, Foxglove Inn. These are drawn on the live map and are the names the text surfaces fall back to.

The product has already half-decided the other way in one place: the home page heads its first screen 「現在的霧林鎮」, a Chinese name for a town whose seed calls it Mistwood. Those two cannot both be right.

## NOT in this task

- Product UI and presentation strings. Already localized, and covered by ART-183, ART-186, ART-187 and ART-188.
- Fixtures and deterministic stand-ins that never reach a viewer: convex/simulation/fakeProvider.ts, src/e2e/fixtureWorld.ts and the test fixtures. Their language is irrelevant to a reader and changing it would only make the diffs harder to follow.
- LLM-authored narrative. The provider is prompted in the deployment environment; that is configuration, not seed data, and it is a separate question from what the seed says.

## Why it is blocked rather than done

Translating the seed changes what the world IS, not how it is shown. Character names are cited in accepted Canon events, in published read models and in the closure record; renaming a resident is a content migration across an append-only history, not a string edit. The three coherent answers — keep the world English and accept a bilingual product, translate the seed and migrate, or keep English names and translate only the prose around them — are all defensible, and picking one is not a technical decision.

Release-blocker assessment: NO for the presentation defects, which are fixed independently. The remaining question is whether a zh-Hant product may ship a world whose residents are named in English.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A product decision is recorded: keep the seed English, translate it, or translate prose but not names
- [ ] #2 If translation is chosen, the migration path for names already cited in accepted Canon is stated before any edit
- [ ] #3 The home page's 霧林鎮 and the seed's Mistwood are reconciled either way
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
REVISED 2026-09-16, after ART-191.

The NAME half of this question was never open. data/mistwoodCharacters.ts had already recorded the decision on the field itself — 「The canonical public zh-TW label. The seed romanised name is never published.」 — and authored a zh-TW name for all twelve residents. Nothing rendered it; every public surface showed the seed romanised form instead. ART-191 made the product use the decision it had already made, so 何俊, 趙銘 and 裴嵐 are what a viewer now reads.

What remains genuinely open, and what this task is now only about:

- occupation, publicProfile, publicGoal, personality traits and values — all allowlisted, all rendered on the character page and the live map character card, all English prose.
- The world name Mistwood, plus description, background, era, technologyLevel, geographyRules, socialRules, laws and taboos.
- Organizations: Mistwood Council, Mistwood Chronicle, Northwater Cooperative.
- Historical events: The Station Flood, Northwater Rescue, Archive Room Fire.
- data/mistwood.ts location footprint names: Mistwood Station, Town Hall, Lantern Square, Juniper Clinic, Northwater Mill, Bellweather Orchard, Foxglove Inn. These are drawn on the live map and are what the text surfaces now fall back to, so 「所在地:Northwater Mill」 is what the character page reads today.

The 霧林鎮 / Mistwood contradiction on the home page stands.

Release-blocker assessment is unchanged and now firmer: NO. Every presentation defect is fixed and none of them depended on this. What is left is a product question about what the world IS, and a resident name — the part that would have needed a Canon migration — is already settled.
<!-- SECTION:NOTES:END -->
