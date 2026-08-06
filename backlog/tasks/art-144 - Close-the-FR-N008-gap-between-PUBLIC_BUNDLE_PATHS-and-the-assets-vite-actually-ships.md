---
id: ART-144
title: >-
  Close the FR-N008 gap between PUBLIC_BUNDLE_PATHS and the assets vite actually
  ships
status: To Do
assignee: []
created_date: '2026-08-06 08:16'
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
- [ ] #1 The licence check fails when a non-approved asset is present under public/, proven by a negative test
- [ ] #2 The licence check accounts for assets vite emits from CSS url() references, not only JavaScript/TypeScript imports
- [ ] #3 Each of the sixteen currently-shipped non-approved assets is either removed from the shipped surface or carries an approved licence record with verified provenance
- [ ] #4 npm run check passes against a fresh clone with the stricter gate in place
- [ ] #5 ASSETS-LICENSE.md reflects the corrected reachability analysis, replacing ART-108 unreachable claim for assets/ui/*.svg and assets/background.webp
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
