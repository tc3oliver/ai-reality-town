---
id: ART-108
title: Audit and enforce visual asset licensing and attribution
status: Done
assignee:
  - '@claude'
created_date: '2026-08-04 15:57'
updated_date: '2026-08-05 06:10'
labels:
  - prd-2.0
  - v2-a
  - epic-n
dependencies:
  - ART-107
priority: high
type: feature
ordinal: 108000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N008 (PRD 2.0 §12 Epic N)

**Problem / Context:** The public Dynamic Viewing MVP ships inherited third-party pixel-art tilesets, spritesheets, fonts and audio. PRD 2.0 §22 makes complete licence and attribution records a public-release acceptance criterion. No licence inventory or release-time check exists today.

**Goal:** Establish a verified licence record for every asset that reaches the public build, plus an automated check that prevents releasing without it.

**Scope:**
- Enumerate every image, audio, font and map asset reachable from the public bundle.
- Record the licence, source and required attribution text for each.
- Add product-visible or documented attribution where the licence requires it.
- Add a CI or release check asserting required licence files exist.
- Flag and quarantine any asset with no clear provenance.

**Out of Scope:** Introducing new external assets (PRD 2.0 §6 forbids it in v1); palette-variant art work (owned by FR-N004).

**Dependencies:** FR-N001 audit (asset inventory).

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** None directly; reduces legal/compliance risk on public release.

**Test Requirements:** An automated check (CI step or test) asserting the presence of required licence/attribution files, failing when absent.

**Validation Commands:**
- `npm run check`
- The new licence check command must fail when a required licence file is removed.

**Documentation Impact:** New or updated asset licence register; attribution surface in product or docs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every asset reachable from the public bundle has a recorded licence source
- [x] #2 Required attribution is preserved in the product or documentation
- [x] #3 No asset with unclear provenance remains in the public build
- [x] #4 An automated CI or release check verifies required licence files exist and fails when one is missing
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
- [ ] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Build a verified asset inventory from ART-107's renderer/asset audit plus a fresh repo-wide scan of data/ and public/ (35 files total).
2. Verify provenance per asset via: byte-diff against upstream a16z-infra/ai-town (confirms unmodified stock assets), upstream README's own "Other credits" section (fetched from upstream/main), live OpenGameArt license pages (WebFetch) for the 3 named tileset sources, dafont license-category pages for the 2 fonts, and code-reachability grep to determine which assets are wired into ART-107's "reusable renderer" path vs orphaned/editor-tool-only.
3. Classify each asset: Approved (tileset/FX art + tilemap data + fonts, verified permissive licenses), Restricted (background.mp3 -- AI-generated via Replicate/MusicGen, distinct licensing question, currently unreachable from any public route), Quarantined (character folk sprites and editor-only assets with no conclusive per-file source match).
4. Create assets/asset-licenses.json as the machine-readable manifest (source of truth), matching the existing architecture/module-boundaries.json + scripts/architecture/check-boundaries.mjs pattern already used in this repo.
5. Create scripts/assets/check-asset-licenses.mjs (testable pure functions + CLI entry) and scripts/assets/check-asset-licenses.test.mjs (node:test, including a required negative test that removes a manifest record and asserts the check fails).
6. Add npm scripts check:asset-licenses / test:asset-licenses, wire into npm run check and check:offline, and add explicit steps to .github/workflows/ci.yml and bootstrap.yml so the gate is actually enforced (neither workflow currently calls npm run check as an aggregate).
7. Write ASSETS-LICENSE.md at repo root as the human-readable register + attribution text (documentation attribution surface, since no public page currently renders these assets).
8. Validate from a genuinely fresh clone: npm ci, npm run check, the negative test, and a repo-wide grep confirming no new asset was silently added.
9. Commit, push, open PR against main, enable auto-merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full 68-file asset census (git ls-files, asset-like extensions) built from ART-107's renderer inventory plus a repo-wide scan -- ART-107's own table only covered renderer-reachable files, so this audit additionally discovered a previously-unlisted root assets/ directory (18 files: game HUD chrome + a16z/Convex brand logos) and 19 files under src/editor/ (the standalone level-editor dev tool), none of which appeared in the original inventory.

Provenance verified per file, not inferred from filename/location:
- Byte-diffed all 68 files against upstream a16z-infra/ai-town (fetched live): 68/68 identical -- this repo has never modified an inherited asset.
- Fetched upstream README's own 'Other credits' section (commit 7b24233) for the tileset/font/music source list.
- WebFetched live licence pages: opengameart.org/content/16x16-game-assets (CC-BY 4.0, George Bailey), opengameart.org/content/16x16-rpg-tileset (CC-BY-SA 3.0 / GPL 3.0, hilau), opengameart.org/content/tiny-rpg-forest (CC0, ansimuz), dafont.com/upheaval-pro.font and dafont.com/vcr-osd-mono.font (both '100% Free', author names cross-checked against embedded TTF name-table metadata).
- mounirtohami.itch.io/pixel-art-gui-elements (cited by upstream for assets/ui/*.svg) returned HTTP 404 during verification -- could not confirm, so those files are downgraded from ART-62's carried-over attribution to quarantined rather than accepted on trust.
- Code-reachability grep across src/ and convex/ to determine which assets are actually wired into a live import path vs. editor-tool-only vs. fully orphaned (data/characters.ts and Player.tsx, which wired 32x32folk.png into the renderer, were already removed by ART-112, so that texture is now unreachable by any current code even though ART-107 flagged its spritesheet data 'reusable as-is' for the future FR-N010 Visual Runtime).

New finding beyond FR-N008's literal checklist: assets/a16z.png and assets/convex.svg + convex-bg.webp are the Andreessen Horowitz and Convex Inc. corporate logos (bundled 'powered by' branding from the upstream template), not creative-commons art. Flagged as a trademark question distinct from copyright licensing; quarantined, and currently unreachable (zero importers -- PoweredByConvex.tsx and MusicButton.tsx, the only consumers of several root assets/ files, are themselves unreferenced anywhere in src/).

Classification: 14 approved (the exact ART-107 'reusable renderer' set: gentle-obj.png tileset, 4 FX spritesheets, 5 animation JSONs, gentle.js, the 2 live fonts loaded via src/index.css @font-face, favicon.ico), 1 restricted (background.mp3 -- AI-generated via MusicGen/Replicate per upstream README, a distinct legal question from asset-pack attribution, and currently unreachable since its only consumer MusicButton.tsx has zero importers), 51 quarantined (character folk sprites with unresolved art provenance, editor-tool-only duplicates/tilesets, the brand logos, and the now-unverifiable Mounir Tohami UI credit), 2 tooling (convertMap.js, types.ts -- not media).

Built assets/asset-licenses.json (machine-readable register, mirrors the existing architecture/module-boundaries.json + scripts/architecture/check-boundaries.mjs pattern already used in this repo) and scripts/assets/check-asset-licenses.mjs (+ check-asset-licenses.test.mjs, node:test, 9 tests including a required negative test asserting the check fails when a public-bundle record is removed). Wired into npm run check / check:offline, and added explicit steps to both .github/workflows/ci.yml and .github/workflows/bootstrap.yml since neither workflow previously called npm run check as an aggregate (both call typecheck/lint/test/build individually) -- without this the new gate would exist but never actually run in CI.

Rewrote ASSETS-LICENSE.md to close out all three items ART-62 (PRD 1.0 security/release audit) had explicitly left open (OpenGameArt licence versions, font terms, background.mp3 provenance) with verified evidence, and to narrow one of ART-62's carried-over attributions (assets/ui/*.svg) that could not be re-verified.

Validation from a genuinely fresh clone (/tmp/art108-fresh, git clone + npm ci, deleted after): npm run check passed in full (check:architecture, test:architecture, check:asset-licenses, test:asset-licenses, typecheck, lint, 85/85 test suites / 1113/1118 tests with the same 5 pre-existing skips as the ART-112 baseline, build). Explicit negative-test proof per requirement: removed the public/assets/gentle-obj.png record from the fresh clone's assets/asset-licenses.json and re-ran npm run check:asset-licenses -- it failed with exit code 1 and the expected 'reachable from the public bundle but has no licence record' message.

Pushed feat/art-108-asset-license-audit and opened PR #156 against main. Auto-merge enabled (gh pr merge 156 --auto --merge --delete-branch); status BLOCKED pending required CI checks, not block-watched per repo workflow -- will complete asynchronously. DoD #14 remains unchecked until the merge actually lands.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Audited every image, tilemap, spritesheet, animation, font and audio asset in the repository (68 files -- broader than ART-107's original renderer-only inventory, since this audit also found a previously-uncatalogued root assets/ directory and the standalone level-editor's asset set). Verified provenance for each via byte-diff against upstream a16z-infra/ai-town, live OpenGameArt/dafont licence pages, and code-reachability analysis -- not filename inference. Result: 14 approved (CI-enforced), 1 restricted (AI-generated background music, unresolved MusicGen output-rights terms), 51 quarantined (unresolved-provenance character art, editor-only duplicates, and -- new finding -- a16z/Convex brand-logo trademark assets that must not enter any public bundle without authorisation), 2 non-media tooling files.

Deliverables: assets/asset-licenses.json (machine-readable register), scripts/assets/check-asset-licenses.mjs + test (CI gate, 9 tests incl. required negative test), ASSETS-LICENSE.md (closes ART-62's three open items with verified evidence), and explicit CI steps added to both .github/workflows/ci.yml and .github/workflows/bootstrap.yml (neither previously ran an aggregate check, so the new gate needed its own steps to actually execute).

Verified via genuinely fresh clone + npm ci: npm run check passes in full (architecture, asset-licence check + its test suite, typecheck, lint, 85/85 test suites, build), and an explicit negative test confirms the gate fails (exit 1) when a required public-bundle licence record is removed.
<!-- SECTION:FINAL_SUMMARY:END -->
