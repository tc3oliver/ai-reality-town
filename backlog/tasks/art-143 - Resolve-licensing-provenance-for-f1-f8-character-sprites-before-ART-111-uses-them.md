---
id: ART-143
title: >-
  Resolve licensing/provenance for f1-f8 character sprites before ART-111 uses
  them
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-05 06:50'
updated_date: '2026-08-06 08:31'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Record the owner's H06 decision (accept upstream MIT, residual risk accepted) as the licence basis for the nine character-art paths, replacing the placeholder 'Unresolved' provenance in assets/asset-licenses.json with the real grant: source = a16z-infra/ai-town commit dca78f5ea, author = a16z-infra/ai-town contributors (spritesheet committed by 61cygni), license = MIT (upstream root LICENSE, Copyright (c) 2023 a16z-infra), status = approved, redistribution/modification true, attributionRequired true. Keep the full ART-143 provenance evidence chain in notes so the residual risk stays visible rather than being erased by the approval.
2. Add the nine paths to PUBLIC_BUNDLE_PATHS in scripts/assets/check-asset-licenses.mjs so ART-111 can wire the sprites into the public visual bundle without tripping the FR-N008 gate.
3. Rework the ART-143 regression tests: replace the 'stays out of the public bundle' pin with one asserting the nine paths are approved, MIT-licensed, non-placeholder and enforced by PUBLIC_BUNDLE_PATHS; re-point the two negative tests (status-flip laundering, direct PUBLIC_BUNDLE_PATHS insertion) at an asset that is still quarantined with placeholder provenance so the loophole guard added earlier keeps a live subject.
4. Update ASSETS-LICENSE.md: move the character-art section from Quarantined to Approved, update the status counts, add the MIT attribution requirement to the required-attribution block, and rewrite the section to record the decision (accepted grant + residual risk + why) rather than the blocker.
5. Update docs/prd-2.0-requirement-matrix.md FR-N008 row: ART-143 Done, note the accepted-MIT basis, keep ART-144 listed as the open follow-up.
6. Verify with npm run check:offline (asset-licence check, its test suite, lint, typecheck, unit tests) and npm run build, then open a PR with auto-merge and finalize ART-143 to Done.
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

PR #161 merged into main after CI and Bootstrap workflows both completed successfully (auto-merge, branch deleted). Task remains Blocked: DoD #1 (all acceptance criteria satisfied) stays unchecked because AC #1-#3 depend on the H06 licence decision recorded in the comment above.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-06 08:20
---
HUMAN ACTION REQUIRED — H06 (legal licence acceptance)

Blocker: H06. Redistribution/modification rights for public/assets/32x32folk.png cannot be confirmed from primary evidence, and PRD 2.0 section 6 closes the replacement route. Acceptance criteria #1, #2 and #3 cannot be satisfied without an owner-level licence decision. AC #4 forbids promoting the asset regardless.

Evidence: see Implementation Notes for the six primary-source lines of enquiry (upstream git history and the two-version swap, README credits, credit-line timing, PNG metadata, upstream issue #202, asset-pack matching). Upstream itself holds no record; the maintainer answered a direct question about this exact file without a licence or attribution.

Work already completed: evidence chain recorded in assets/asset-licenses.json and ASSETS-LICENSE.md; the approved-status placeholder loophole closed in scripts/assets/check-asset-licenses.mjs with four regression tests; PRD traceability matrix updated; ART-144 filed for the separate finding that sixteen non-approved assets already ship in dist/. Merged via PR #161.

Exact human action — choose one:
1. Accept upstream a16z-infra/ai-town's MIT LICENSE as a sufficient grant for these nine paths and accept the residual risk that upstream may not have held the rights it granted. Then flip them to approved with the accepted rationale recorded, add them to PUBLIC_BUNDLE_PATHS, and ART-111 proceeds as designed.
2. Grant a PRD 2.0 section 6 exception so a verifiably-licensed replacement sprite set (for example a CC0 pack with a primary licence source) can be sourced at the same 384x256 twelve-by-eight layout, keeping f1-f8.ts frame data valid.
3. Obtain a written provenance/licence statement from a16z for public/assets/32x32folk.png.

Until then the nine paths stay quarantined and ART-111 stays blocked. Note that option 1 or 3 still leaves ART-144 to fix, because the asset is already being published from public/ regardless of the manifest.

Verification: whichever option is chosen, npm run check:asset-licenses plus npm run test:asset-licenses must pass with the nine paths in their new state, and the ART-143 regression test in scripts/assets/check-asset-licenses.test.mjs must be updated to match the decision.

Work continuing elsewhere: none from this agent; ART-144 is filed and unassigned.
---

author: @claude
created: 2026-08-06 08:31
---
Owner decision received on the H06 blocker (2026-08-06): Option 1 -- accept upstream a16z-infra/ai-town's root MIT LICENSE (Copyright (c) 2023 a16z-infra) as a sufficient grant for the nine f1-f8 paths, explicitly accepting the residual risk that upstream may not have held all rights it purported to grant. Unblocking ART-143 and resuming: approve the nine paths with the accepted-MIT-with-residual-risk rationale recorded in place of the placeholder provenance, add them to PUBLIC_BUNDLE_PATHS, and update ASSETS-LICENSE.md and the PRD 2.0 traceability matrix. ART-144 (public/ and CSS url() bundle-detection gap) stays a separate task and is not folded into this change.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Re-opened the f1-f8 provenance question against primary sources rather than re-reading ART-108's conclusion, and confirmed it is unresolvable: upstream a16z-infra/ai-town touched public/assets/32x32folk.png in exactly two commits five hours apart on 2023-08-12 (a41c22089, dca78f5ea via PR #54), swapping the entire cast for different art without naming a source; its README credits a third-party source for every other art category but none for character art; the 'Pixel Art Generation: Replicate, Fal.ai' line was added 48 minutes later by a different author as a generic Stack bullet and is never linked to the file; the PNG carries no author/copyright/generator metadata; upstream issue #202 asked this exact question and the maintainer answered with a directory path only; and no match exists against candidate 32x32 character packs. Upstream's MIT LICENSE conveys only rights upstream actually held, which nothing establishes. Acceptance criteria #1-#3 therefore cannot be met, AC #4 forbids promoting the asset anyway, and the AC #2 replacement route is closed by PRD 2.0 section 6's v1 non-goal on external asset libraries and image-generation models. Raised as H06 with three concrete options for the owner.

Shipped regardless of that decision: the full evidence chain is now recorded in assets/asset-licenses.json and ASSETS-LICENSE.md so it is not re-investigated; and a real loophole is closed — validateManifestShape accepted the literal string 'Unresolved' as a non-empty licence, so an unknown-provenance asset could reach the public bundle by flipping status alone. isPlaceholderProvenance() now rejects approved records with placeholder source/author/licence, matched only as a whole value or leading term plus separator so genuine text such as 'CC-BY 4.0, attribution unknown for one contributing pack' still passes.

Verification evidence: npm run check:asset-licenses passed ('14 public-bundle asset(s) verified'); npm run test:asset-licenses 13/13 pass including four new regression tests, one pinning the nine character-art paths as non-approved and absent from PUBLIC_BUNDLE_PATHS; npm run check:offline fully green (check:architecture, test:architecture, asset licence check and tests, typecheck, lint, 33 suites / 359 tests, vite build). Negative proof against a temp manifest copy: flipping 32x32folk.png to approved and appending it to the bundle list returns two errors naming the path and 'unresolved provenance'. Delivered in PR #161.

Also discovered while verifying and filed as ART-144 rather than expanding scope: the FR-N008 gate has two false negatives (vite copies public/ verbatim into dist/, and CSS url() references are not JS imports), so sixteen non-approved assets — including dist/assets/32x32folk.png, byte-identical to source — already ship while the check reports '14 verified'.
<!-- SECTION:FINAL_SUMMARY:END -->
