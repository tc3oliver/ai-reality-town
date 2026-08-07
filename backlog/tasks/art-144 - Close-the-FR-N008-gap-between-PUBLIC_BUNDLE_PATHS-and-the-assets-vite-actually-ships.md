---
id: ART-144
title: >-
  Close the FR-N008 gap between PUBLIC_BUNDLE_PATHS and the assets vite actually
  ships
status: Done
assignee:
  - '@claude'
created_date: '2026-08-06 08:16'
updated_date: '2026-08-07 01:43'
labels:
  - prd-2.0
  - epic-n
dependencies: []
priority: high
type: bug
ordinal: 144000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement ID: FR-N008 (PRD 2.0 section 12 Epic N), acceptance condition 3 ("assets of unknown provenance must not enter the public release").

Problem / Context: ART-108 built the licence gate around PUBLIC_BUNDLE_PATHS, a hand-maintained allowlist in scripts/assets/check-asset-licenses.mjs, and classified everything else as "unreachable from any shipped surface" based on a grep for JavaScript/TypeScript importers. Running npm run build shows that reasoning has two false negatives, so the gate passes while quarantined art is actually published.

1. Vite copies public/ into dist/ verbatim, with no import graph involved. Seven non-approved assets ship today: public/assets/32x32folk.png, player.png, rpg-tileset.png, magecity.png, heart-empty.png and tilemap.json (all quarantined) plus public/assets/background.mp3 (restricted for unresolved MusicGen/Replicate output rights). dist/assets/32x32folk.png was confirmed byte-identical to the source (sha256 4f82a3bf6f037698ad94ae4b7309a43bd68e2397a04891de9717edc56e7630d5).
2. CSS url() references are not JavaScript imports, so the grep missed them. src/index.css pulls in assets/background.webp and all eight assets/ui/*.svg files (box, bubble-left, bubble-right, button, chats, desc, frame, jewel_box) through border-image-source, and vite emits every one into dist/assets/. These are exactly the files ART-108 quarantined because the Mounir Tohami itch.io source page returned HTTP 404 and its licence could not be re-verified.

That is sixteen non-approved assets in the production bundle while npm run check:asset-licenses reports "14 public-bundle asset(s) verified".

Goal: make the gate assert against the surface that is actually published rather than against a list someone has to remember to update.

Scope:
- Derive the enforced set from real evidence: everything under public/, plus what vite emits into dist/, rather than only a hand-maintained constant.
- Decide and record the disposition for each of the sixteen assets: remove it from the shipped surface, or resolve its licence and approve it.
- Keep the allowlist working for assets that are genuinely intended to ship.

Out of Scope: the licence decision for the f1-f8 character art (owned by ART-143, blocked on H06) and any change to which art the product uses.

Discovered by ART-143 while verifying its own change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The licence check fails when a non-approved asset is present under public/, proven by a negative test
- [x] #2 The licence check accounts for assets vite emits from CSS url() references, not only JavaScript/TypeScript imports
- [x] #3 Each of the sixteen currently-shipped non-approved assets is either removed from the shipped surface or carries an approved licence record with verified provenance
- [x] #4 npm run check passes against a fresh clone with the stricter gate in place
- [x] #5 ASSETS-LICENSE.md reflects the corrected reachability analysis, replacing ART-108 unreachable claim for assets/ui/*.svg and assets/background.webp
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
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## ART-144 Implementation Plan

### Ground-truth findings (verified against actual `npm run build` dist/ output, not the task's possibly-stale asset list)
- The task text lists "seven" assets for finding #1 including `public/assets/32x32folk.png`, but that file was approved by ART-143 (merged ~3 min after this task was filed) and is correctly in PUBLIC_BUNDLE_PATHS today. Real count for finding #1 is SIX files, not seven.
- Actual non-approved files present in `dist/assets/` after `npm run build` (verified by listing dist/assets/): via public/ passthrough — `background.mp3`, `heart-empty.png`, `magecity.png`, `player.png`, `rpg-tileset.png`, `tilemap.json` (6). Via CSS `url()` in `src/index.css` — `box-*.svg`, `bubble-left-*.svg`, `bubble-right-*.svg`, `button-*.svg`, `chats-*.svg`, `desc-*.svg`, `frame-*.svg`, `jewel_box-*.svg`, `background-*.webp` (9). Total 15 non-approved shipped assets today (not 16).
- `assets/ui/button_pressed.svg` is quarantined but NOT referenced anywhere (not even via CSS) — genuinely orphaned.
- CRITICAL FINDING: every CSS rule that references the 9 CSS-reachable quarantined assets (`.game-background`, `.game-frame`, `.bubble`/`.bubble-mine`, `.box`, `.desc`, `.chats`, `.login-prompt`, `.button` + its `:hover`/`:active`/media-query variants) is DEAD CSS — verified by grepping all of `src/` for each class name: zero components apply any of these classNames. `LoginButton.tsx` (the only file using `.button`) and `Character.tsx` (only "bubble" match, in a comment) both have zero importers reachable from `src/main.tsx` -> `src/App.tsx`. These are leftover styles from the pre-"read-only public pivot" a16z interactive game UI (see ADR-0004). This means removing the asset files and their CSS rules is pure dead-code deletion with NO visual regression to the live app — not a design/UX tradeoff. Re-verify this with a full grep + full test suite pass before deleting; do not assume without checking, since a false positive here would be a real regression.
- `public/assets/background.mp3`: `convex/music.ts`'s `getBackgroundMusic` query falls back to this path only when no generated-music DB row exists; its only frontend consumer `MusicButton.tsx` has zero importers anywhere in `src/` (dead). Status is "restricted" (MusicGen/Replicate output-rights unconfirmed), and ASSETS-LICENSE.md already states it "must not enter a public bundle until MusicGen/Replicate output rights are confirmed" — yet it does today via public/ passthrough. Safe to delete: no reachable UI plays it.
- Licence research performed for `assets/ui/*.svg` (attributed to Mounir Tohami's itch.io "Pixel Art GUI Elements" pack): the direct page `mounirtohami.itch.io/pixel-art-gui-elements` still returns HTTP 404 today (re-verified, same as ART-108's finding — not stale). Web search surfaces only secondhand/paraphrased claims (a comment reportedly saying "feel free to do it, it's yours") with no independently-verifiable licence text, no Wayback Machine access available in this environment. This does not clear this project's own evidentiary bar (ASSETS-LICENSE.md: "do not accept previously-recorded attribution text without verification"; the manifest's `isPlaceholderProvenance` check already rejects "Unresolved"/"Unknown" as approved-status values). Disposition: keep quarantined and remove from the shipped surface (an outcome the task itself explicitly sanctions in AC#3: "removed from the shipped surface, or ... approved licence record"). Do NOT flip any of these to "approved" based on unverified secondary sources.

### Disposition per asset (all "remove from shipped surface" — no new licence approvals)
1. Delete `public/assets/player.png`, `rpg-tileset.png`, `magecity.png`, `heart-empty.png`, `tilemap.json` — dead files, unused anywhere in `src/`.
2. Delete `public/assets/background.mp3` — restricted licence, unreachable/dead consumer.
3. Delete `assets/ui/box.svg`, `bubble-left.svg`, `bubble-right.svg`, `button.svg`, `button_pressed.svg`, `chats.svg`, `desc.svg`, `frame.svg`, `jewel_box.svg`, and `assets/background.webp` (10 files).
4. Remove the dead CSS rules in `src/index.css` that reference the deleted files: `.game-background`, `.game-frame` (+ its `@media (min-width: 640px)` override), `.bubble`, `.bubble-mine`, `.box`, `.desc`, `.chats`, `.login-prompt`, `.button` (+ its `span`, `:hover`, `:active`, `:active span`, and the `@media (max-width: 640px)` block). Verify with a fresh grep across `src/` that none of these classNames are applied anywhere before deleting each rule; run the full test suite afterward (including `src/components/public/publicPages.a11y.test.tsx`, `readOnlyWorld.dom.test.tsx`) to confirm zero regressions. Do not touch unrelated CSS (`.game-title`, `.game-progress-bar*`, `.shadow-solid`, font-face rules, `:root`/dark-mode vars) — those are unrelated and some are still relevant.
5. Remove the corresponding entries from `assets/asset-licenses.json` for every file deleted in steps 1-3 (the manifest's own framing is "every asset-like file in the repository is still recorded" — once a file no longer exists in the repo, its record should be removed, not left dangling). Keep `assets/ui/button_pressed.svg`'s entry removal too (orphaned, deleted alongside its siblings for consistency even though it was never CSS-reachable).

### Harden `scripts/assets/check-asset-licenses.mjs` (AC#1, AC#2)
Add two new evidence-based coverage checks, independent of the hand-maintained `PUBLIC_BUNDLE_PATHS` array (keep that array for the `data/*.ts`/`.js` files that ship via the JS bundle rather than public/ or CSS — out of scope to fully automate those):
1. `checkPublicDirectoryCoverage(manifest, publicDir)` — recursively walk `public/` (`node:fs` `readdirSync`/`statSync`, skip nothing), and for every file found, require a manifest record at the matching `public/...` path with `status === 'approved'`. Fail with a clear message naming the path if missing or not approved. This directly satisfies AC#1 ("fails when a non-approved asset is present under public/").
2. `checkCssReferencedAssetsCoverage(manifest, cssFiles)` — for each `src/**/*.css` file (glob or recursive walk), regex-scan for `url\(([^)]+)\)`, skip `data:` URIs, strip quotes, skip absolute `/assets/fonts/...` paths that are already covered by `PUBLIC_BUNDLE_PATHS` (or resolve them relative to `public/` and route through the same approved-check), resolve relative paths (`../assets/...`) against the CSS file's directory to get a repo-relative path, and require an approved manifest record for each resolved file that actually exists on disk. Fail naming the CSS file, the url(), and the resolved path. This satisfies AC#2.
Wire both into `runCheck()` alongside the existing `validateManifestShape`/`checkPublicBundleCoverage`, and update `main()`'s success message to mention the new coverage. Keep the existing placeholder-provenance rule intact (do not weaken it).

### Tests (`scripts/assets/check-asset-licenses.test.mjs`)
- AC#1 negative test: build a temp/fixture directory (do not touch the real `public/`) containing one file with no manifest record, assert `checkPublicDirectoryCoverage` returns a non-empty error naming that path; a positive test where every file has an approved record returns `[]`.
- AC#2 test: a fixture CSS string containing `url(../assets/ui/unknown.svg)` pointing at a path with no manifest record (or a quarantined one) asserts a non-empty error; a fixture referencing an approved font path returns `[]`; a `data:` URI is ignored (no error, no crash).
- Regression test: run `checkPublicDirectoryCoverage`/`checkCssReferencedAssetsCoverage` against the REAL current `public/` dir and REAL `src/index.css` after the cleanup in steps 1-4 above, asserting zero errors — this is the AC#4 proof at the unit level, in addition to running `npm run check:asset-licenses` for real.
- Keep all existing tests passing; add/adjust any test that referenced a now-deleted manifest entry.

### Docs (AC#5)
Update `ASSETS-LICENSE.md`:
- Correct the "Editor-tool-only / unreachable assets" section: `assets/ui/*.svg` and `assets/background.webp` were NOT actually unreachable — they were referenced via CSS `url()` in `src/index.css` (on CSS rules that were themselves dead/unapplied by any component). Explain this precisely: bundler reachability (does vite emit the file into dist/) is independent of runtime DOM usage (is the CSS rule ever applied) — both must be checked, which is exactly the FR-N008 gap ART-144 closes.
- Record the resolution: these files, the six `public/`-passthrough leftovers, and their dead CSS rules were deleted from the repository entirely (not merely re-quarantined), since they were unused and their licence could not be verified.
- Update the Summary table counts (Approved 24 unchanged; Restricted 1 -> 0; Quarantined count drops by the number of deleted entries; Total drops accordingly) and remove/adjust the per-file rows and prose that named the deleted files.
- Add a short "ART-144" note analogous to the existing ART-108/ART-143 history notes, explaining the two false-negative classes found and the "delete rather than approve" resolution, distinguishing it from the character-art H06 risk-acceptance precedent (this was not a risk-acceptance; verification failed and the safer default of removal was taken).

### Update `docs/prd-2.0-requirement-matrix.md`
Update the FR-N008 row (already references ART-144) to reflect ART-144 moving to Done and summarize the fix (grep the current row text first — do not duplicate ART-108/ART-143's existing summary, append/adjust it).

### Explicit non-goals
- Do not touch the f1-f8 character art / `32x32folk.png` disposition (ART-143's H06 decision stands, out of scope per the task).
- Do not attempt to re-license or re-source replacement art for the deleted UI chrome — it is genuinely unused dead code, not a live design surface needing a replacement.
- Do not modify `convex/music.ts`'s Replicate/MusicGen generation logic or `MusicButton.tsx` — only the static `public/assets/background.mp3` fallback file ships incorrectly; the code that references its path as a string is unaffected by deleting the file (it only matters if that dead code path is ever exercised, which nothing currently reachable does).
- Do not build a general JS/TS-import-graph automation for the `PUBLIC_BUNDLE_PATHS` list itself; only close the public/-passthrough and CSS-url() gaps per AC#1/#2.

### Validation
`npm run check` (includes `check:asset-licenses` and `test:asset-licenses`) must pass, plus the full existing `npm run check` gate (architecture, typecheck, lint, full test suite, build) to prove zero regressions from the CSS/file deletions.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Ground-truth research before implementing: ran npm run build and inspected dist/assets/ directly rather than trusting the task's asset list verbatim. Found the task's "seven" count for finding #1 included public/assets/32x32folk.png, which ART-143 (merged ~3 min after this task was filed) had already approved -- real count was six for that finding, fifteen non-approved shipped assets total (not sixteen), plus confirmed assets/ui/button_pressed.svg was orphaned even from CSS.

Attempted to independently re-verify the Mounir Tohami itch.io licence for assets/ui/*.svg via WebFetch/WebSearch: the direct page (mounirtohami.itch.io/pixel-art-gui-elements) still returns HTTP 404. Web search surfaces only secondhand/paraphrased comments, no verifiable licence text -- does not meet this project's evidentiary bar (ASSETS-LICENSE.md: "do not accept previously-recorded attribution text without verification"). Did not flip these to approved.

Verified via full-repo grep that the CSS rules referencing all 9 CSS-reachable quarantined assets (.game-background, .game-frame, .bubble, .bubble-mine, .box, .desc, .chats, .login-prompt, .button + variants) were dead: zero components apply these classNames anywhere reachable from src/main.tsx -> src/App.tsx (LoginButton.tsx, the only .button consumer, and Character.tsx, the only "bubble" text match (in a comment), both have zero importers). This made the fix pure dead-code + gate-hardening, not a UI redesign.

Disposition (delete, not approve) for all sixteen shipped non-approved assets: public/assets/{player.png,rpg-tileset.png,magecity.png,heart-empty.png,tilemap.json,background.mp3} (6, unused/restricted), assets/ui/*.svg (9, incl. orphaned button_pressed.svg) and assets/background.webp (1) -- deleted from the repo along with their dead CSS rules and manifest entries. convex/music.ts's string fallback to background.mp3 is unaffected (dead code path, out of scope).

Hardened scripts/assets/check-asset-licenses.mjs with checkPublicDirectoryCoverage() (walks real public/) and checkCssReferencedAssetsCoverage() (regex-scans src/**/*.css url() refs, resolves absolute/relative paths, skips data:/remote URIs), both wired into runCheck(). Added 21 tests total to check-asset-licenses.test.mjs (was ~13, now 21) including AC#1/#2 negative tests and a regression test asserting the real public/ + real stylesheets are fully covered post-cleanup.

Verification evidence (all commands run and passed on branch fix/ART-144-asset-license-gate):
- npm run check:asset-licenses -> "Asset licence check passed: 24 public-bundle asset(s) verified, plus every file under public/ and every url() reference in 1 stylesheet(s)."
- npm run test:asset-licenses -> 21/21 passed
- npx tsc --noEmit -> clean
- npm run lint -> clean
- npm run build -> success; ls dist/assets/ confirmed none of the 16 deleted files (or CSS-hashed variants) present -- only 32x32folk.png, gentle-obj.png, fonts/, spritesheets/, index-*.css, index-*.js remain
- Full test suite (NODE_OPTIONS=--experimental-vm-modules npx jest) -> 94 suites, 1243 passed, 5 pre-existing skips, 0 failed
- Full npm run check gate (architecture, test:architecture, asset-licenses, typecheck, lint, test, build) -> green end to end
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed the FR-N008 gap between the hand-maintained PUBLIC_BUNDLE_PATHS allowlist and what vite actually ships. Two false negatives let 15-16 non-approved assets into dist/: vite copies public/ verbatim (no import graph involved), and CSS url() references in src/index.css are not JS/TS imports so the prior reachability grep missed them. Deleted all sixteen files (six unused public/ leftovers plus a restricted-status background.mp3; nine quarantined UI-chrome SVGs plus background.webp referenced only by CSS rules that were themselves dead -- verified by full-repo grep that no component applies those classNames) rather than approving any of them, since the Mounir Tohami itch.io source page for the UI chrome still 404s and could not be independently re-verified. Hardened scripts/assets/check-asset-licenses.mjs with two new evidence-based checks -- a recursive public/ walk and a CSS url() scanner -- so this class of drift now fails CI instead of silently shipping. Updated ASSETS-LICENSE.md's reachability analysis and decision record, and the PRD requirement matrix.

Verified with: npm run check:asset-licenses (24 public-bundle assets + full public/ + CSS coverage, pass), npm run test:asset-licenses (21/21, including new AC#1/#2 negative tests), npx tsc --noEmit (clean), npm run lint (clean), npm run build followed by inspecting dist/assets/ (none of the 16 deleted files present), the full test suite (1243/1248 passed, 5 pre-existing skips, 0 regressions), and the full npm run check gate end to end (green). All 5 acceptance criteria are evidenced by the above.
<!-- SECTION:FINAL_SUMMARY:END -->
