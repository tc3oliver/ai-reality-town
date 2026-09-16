# Public world naming

How a world is named for a viewer, and what is deliberately left in English.

Decided under ART-190. Applied in `convex/shared/publicWorldNames.ts`, which is the only place the
policy is expressed; nothing else in the client or the read models writes a localized world name.

## The policy

| | |
| --- | --- |
| `mistwood` | internal `worldId` — routes, read-model refs, Canon, every stored identifier |
| `Mistwood` | canonical/internal English world name — `convex/canon/mistwoodSeed.ts`, `convex/canon/publicWorldRegistry.ts` |
| `霧林鎮` | public display name — every zh-Hant viewer surface |

A viewer surface must never mix the two. Internal, operator, debug and test evidence keep the
canonical name.

## Where the translation happens

Once, at the public read boundary:

- `buildWorldProjection` (`convex/publicRead/worldCharacterProjection.ts`) resolves `name` through
  `worldDisplayName`, so the published `world:<worldId>` projection already carries 霧林鎮 and every
  reader of it is correct without knowing the policy exists.
- Two client surfaces resolve it directly because they read no projection: the home page heads
  itself from the world id before the read lands, and the watch guide (`#help`) has no projection at
  all.

This is the shape ART-191 used for a resident's name, for the same reason: the projection is the
single public source of what something is called.

`worldDisplayName(worldId, canonicalName?)` resolves in three steps — the registered display name,
then the canonical name the caller passed, then `null` so the caller chooses its own placeholder. An
unregistered world therefore keeps whatever Canon calls it rather than being renamed to a
placeholder.

## What this did NOT do

Canon was not migrated, no world state was rewritten, `worldId` is unchanged, and the seed was not
translated. `publicWorldNames.test.ts` asserts each of those directly, so a later "consistency" pass
cannot quietly do them under this policy's banner.

## Authored seed content still in English

Published to viewers, and **not** covered by this policy. Marked **Post-MVP / Content Localization**.
Not a production-qualification blocker: every presentation defect around it is fixed, and a
resident's name — the part that would have needed a Canon migration — was settled by ART-191.

| Where | What |
| --- | --- |
| `convex/canon/mistwoodSeed.ts` | `occupation`, `publicProfile`, `publicGoal`, personality traits, values — all allowlisted by `CHARACTER_ALLOWED_FIELDS` and rendered on the character page and the live map's character card |
| `convex/canon/mistwoodSeed.ts` | world `description`, `background`, `era`, `technologyLevel`, `geographyRules`, `socialRules`, `laws`, `taboos` |
| `convex/canon/mistwoodSeed.ts` | organizations — Mistwood Council, Mistwood Chronicle, Northwater Cooperative — with English descriptions |
| `convex/canon/mistwoodSeed.ts` | historical events — The Station Flood, Northwater Rescue, Archive Room Fire |
| `convex/canon/mistwoodSeed.ts`, `data/mistwood.ts` | location names — Mistwood Station, Town Hall, Mistwood Chronicle, Lantern Square, Juniper Clinic, Northwater Mill, Bellweather Orchard, Foxglove Inn |

The location names are the most visible of these: they are drawn on the live map and are what the
text surfaces fall back to, so the character page reads 「所在地:Northwater Mill」.

Two of them contain the word `Mistwood` and are deliberately left alone — they name a *place inside*
the town, not the town. The browser scan in `e2e/worldDisplayName.spec.ts` matches `Mistwood` only
when it is not followed by another capitalised word, for exactly that reason.

## Already decided elsewhere

A resident's public name is **not** part of this question. `data/mistwoodCharacters.ts` records that
decision on the field itself — 「The canonical public zh-TW label. The seed's romanised name is never
published.」 — and ART-191 made the product apply it. See `convex/publicRead/canonicalPublicNames.test.ts`.
