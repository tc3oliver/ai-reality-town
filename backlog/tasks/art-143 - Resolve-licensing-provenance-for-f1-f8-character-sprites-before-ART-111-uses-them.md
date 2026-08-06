---
id: ART-143
title: >-
  Resolve licensing/provenance for f1-f8 character sprites before ART-111 uses
  them
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-05 06:50'
updated_date: '2026-08-06 08:17'
labels:
  - prd-2.0
  - v2-b
  - epic-n
dependencies: []
priority: high
ordinal: 143000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ART-108's asset-licence audit (assets/asset-licenses.json) found that public/assets/32x32folk.png and data/spritesheets/f1.ts through f8.ts have unresolved provenance and are marked 'quarantined' — no verifiable OpenGameArt/dafont/itch source could be matched to the actual texture, so they are excluded from the CI-enforced public-bundle allowlist (PUBLIC_BUNDLE_PATHS in scripts/assets/check-asset-licenses.mjs). ART-111 (Character Visual Binding) assumes these eight sprites are usable as-is for eight of the twelve Mistwood characters. That assumption is currently false: the asset-licence CI gate will reject any change that wires a quarantined asset into the public bundle. This task must resolve the provenance (find and verify a matching real source with an acceptable licence) or replace/re-source the sprites through an in-scope means, and then flip their status to approved in assets/asset-licenses.json with verified evidence, before ART-111's binding work can ship a public-facing character sprite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 public/assets/32x32folk.png and data/spritesheets/f1.ts-f8.ts each have a verified source, author and licence recorded in assets/asset-licenses.json
- [ ] #2 Their status in assets/asset-licenses.json is 'approved' (or they are replaced by assets that are), with redistribution and modification permissions confirmed from primary evidence, not inferred from filename or prior attribution text
- [ ] #3 npm run check:asset-licenses passes with these sprites included in PUBLIC_BUNDLE_PATHS
- [ ] #4 No quarantined asset is added to the public bundle to unblock this task
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Re-open the provenance question with primary sources rather than re-reading ART-108's conclusion: upstream git history for public/assets/32x32folk.png, the PR that introduced it, upstream README credit history and its timing, PNG chunk metadata, upstream issue tracker, GitHub code search, and reverse-lookup against candidate 32x32 character packs (Pipoya, OpenGameArt, itch.io, RPG Maker style packs).
2. Decide against the recorded evidence, not against convenience: if a verifiable source/author/licence exists, record it and promote the nine paths (32x32folk.png + f1..f8.ts) to approved and into PUBLIC_BUNDLE_PATHS. If it does not exist, do NOT promote them (AC #4).
3. Check whether the replacement route in AC #2 is actually open: PRD 2.0 section 6 non-goals and FR-N004 acceptance condition 5 both forbid introducing external free asset libraries or image-generation models in v1, so re-sourcing is out of scope without a PRD exception.
4. Ship the enforcement work that is in scope regardless of the outcome: close the loophole where an unknown-provenance asset can be laundered into the public bundle by flipping status to approved while source/author/licence still hold placeholder text such as Unresolved. Add a placeholder-value rule to scripts/assets/check-asset-licenses.mjs so FR-N008 acceptance condition 3 is machine-enforced, plus a regression test pinning the nine character-art paths as quarantined and absent from PUBLIC_BUNDLE_PATHS.
5. Record the full evidence chain in assets/asset-licenses.json and ASSETS-LICENSE.md so the next agent inherits findings rather than repeating the investigation.
6. If provenance is unresolvable, raise the documented H06 (legal licence acceptance) blocker with the exact decision the owner has to make, and note the knock-on effect on ART-111.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## ART-143 provenance investigation — result: unresolvable from primary evidence

ART-108 had already quarantined these nine paths, but on the strength of an absence of evidence. ART-143 re-opened the question against primary sources and reached the same answer with a much stronger basis. Every line below is a primary source, not a re-reading of ART-108.

1. Upstream git history. Exactly two commits ever touched public/assets/32x32folk.png: a41c22089 'New 32x32 spritesheet' (2023-08-12T16:52:25Z) and dca78f5ea 'New 32x32 characters' (2023-08-12T21:40:38Z), both by 61cygni, the second merged as PR #54 'Martin character'. I fetched both blob versions and rendered them: they are entirely different character art at the same 384x256 layout (v1 fantasy/medieval, v2 modern anime), so upstream replaced the whole cast within five hours. Neither commit message, the PR body, nor its one review comment ('lgtm! thanks for adding more folks!!!') names any source.
2. Upstream README credits. Upstream names a third-party source for every other art category it ships — two OpenGameArt tilesets, ansimuz, Mounir Tohami's UI pack, MusicGen for audio — and names none for the character spritesheet.
3. The 'Pixel Art Generation: Replicate, Fal.ai' line. Often assumed to cover these sprites. It was added 48 minutes after the spritesheet landed, by a different author, as a generic bullet in the Stack list (PR #50). Nothing links it to this file. Suggestive of AI generation, not probative — and if it were probative it would land the file in the same unresolved-model-output-rights bucket that already keeps background.mp3 at 'restricted'.
4. File metadata. The PNG carries no author, copyright or generator fields: sRGB, an eXIf orientation tag, pHYs, and boilerplate Adobe XMP holding only tiff:Orientation.
5. Upstream issue tracker. Issue #202 asked exactly where these textures come from. Maintainer 61cygni answered with the directory path and nothing else — no licence, no attribution.
6. Asset-pack matching. No visual or catalogue match against candidate 32x32 character packs (Pipoya, OpenGameArt CC0 sets, itch.io and RPG-Maker-style packs). Exact-string web search for '32x32folk' returns nothing.

Conclusion. Upstream's root MIT LICENSE is a genuine grant, but it conveys only rights upstream actually held, and nothing establishes that for this file. AC #1 and #2 require permissions 'confirmed from primary evidence, not inferred' — that bar is not met, and AC #4 forbids promoting the asset anyway to unblock the task. The replacement route in AC #2 is also closed: PRD 2.0 section 6 lists adopting an external free asset library or an image-generation model to fill out the sprite set as an explicit v1 non-goal, and FR-N004 acceptance condition 5 repeats it. So this is an owner-level licence decision, not a research gap — raised as H06.

## Enforcement hardening shipped anyway

Independent of the licence decision, the gate had a real loophole: validateManifestShape required author and license to be non-empty for an approved asset, but the literal string 'Unresolved' is non-empty, so an unknown-provenance asset could be moved into the public bundle by flipping status alone. Added isPlaceholderProvenance() to scripts/assets/check-asset-licenses.mjs and a rule rejecting any approved record whose source, author or license is a placeholder (Unresolved / Unknown / Undetermined / Unverified / TBD / TODO / Pending / N/A / None), matched only as a whole value or as a leading term followed by a separator so real text such as 'CC-BY 4.0, attribution unknown for one contributing pack' is unaffected. Four regression tests added, including one pinning the nine character-art paths as non-approved and absent from PUBLIC_BUNDLE_PATHS so a later ART-111 cannot quietly wire them in.

## Discovered while verifying: quarantined assets are already shipping (ART-144)

npm run build shows the FR-N008 gate has two false negatives, both from ART-108 deriving reachability from a JS/TS importer grep. Vite copies public/ into dist/ verbatim with no import graph involved, and CSS url() references are not JS imports. Sixteen non-approved assets are in the production bundle today while check:asset-licenses reports '14 public-bundle asset(s) verified': seven under public/ (32x32folk.png, player.png, rpg-tileset.png, magecity.png, heart-empty.png, tilemap.json, plus restricted background.mp3) and nine reached from src/index.css (assets/background.webp and all eight assets/ui/*.svg — the very files ART-108 quarantined after the Mounir Tohami source page 404'd). dist/assets/32x32folk.png was confirmed byte-identical to the source. Out of scope here, so filed as ART-144 rather than silently expanding this task — but it means the disputed character art is not merely 'planned' for the bundle, it is already published, which raises the urgency of the H06 decision.
<!-- SECTION:NOTES:END -->
