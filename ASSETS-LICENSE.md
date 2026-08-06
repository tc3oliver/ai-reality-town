# Third-Party Asset Licenses and Credits

AI Reality Town ships art, audio, and font assets that are **not** covered by the MIT
license in [`LICENSE`](./LICENSE). MIT covers the *code* inherited from
[`a16z-infra/ai-town`](https://github.com/a16z-infra/ai-town). Most of the bundled art and
audio were third-party works in upstream AI Town, and a16z-infra never held copyright in
them, so they could not have been — and were not — MIT-licensed by upstream. The character
sprites are the exception: upstream names no third-party source for them, and the project
owner has accepted upstream's MIT grant as their licence basis (see the decision record
below).

These works are redistributed here under their own terms. Several require attribution as a
**condition** of the license grant, independent of MIT. This file exists to satisfy that
condition.

> **History.** Originally restored by ART-62 (PRD 1.0 security/release audit) after the
> upstream credits were dropped during a rebranding commit while the credited files
> continued to ship. ART-62 recorded three items it could not verify from the repository
> alone (exact OpenGameArt license versions, font terms, `background.mp3` provenance) and
> left them explicitly open. **ART-108 (FR-N008, PRD 2.0) closes those open items** with
> licence evidence verified against live source pages (OpenGameArt, dafont) rather than
> carried-over attribution text, adds two findings ART-62's scope didn't cover (third-party
> brand-logo assets, and per-file public-bundle reachability), and adds the CI enforcement
> gate ART-62 did not have. The machine-readable register is
> [`assets/asset-licenses.json`](assets/asset-licenses.json); the enforced gate is
> [`scripts/assets/check-asset-licenses.mjs`](scripts/assets/check-asset-licenses.mjs)
> (`npm run check:asset-licenses`, wired into `npm run check` and both CI workflows).

**Scope.** "Public bundle" means reachable from the current or PRD 2.0-planned public
surface. ART-107 (`docs/upstream-visual-capability-audit.md`) established that today's
public pages read text-only projections and render no PixiJS canvas; the tileset/FX/font
assets below are in scope because PRD 2.0 Epic O (`FR-O001`, the planned `/live` animated
map) will restore the renderer ART-107 marked "reusable as-is." That renderer inventory is
the CI enforcement boundary (`PUBLIC_BUNDLE_PATHS` in the check script). The two fonts are
already live today via `src/index.css`'s `@font-face` rules. Every asset-like file in the
repository is still recorded below (68 total) so nothing can enter a public bundle
unnoticed later.

## Summary

| Status | Count | Meaning |
|---|---:|---|
| ✅ Approved | 23 | Reachable from the current/planned public bundle; licence + attribution verified and CI-enforced. |
| 🟡 Restricted | 1 | Verified provenance, but public use is not yet cleared (`background.mp3`). |
| ⛔ Quarantined | 42 | Not entered into the public bundle: unresolved provenance, third-party trademark, or editor-tool-only / unreachable from any shipped surface. |
| ⚙️ Tooling | 2 | Not a media asset (code utility / type definitions); covered by the project's own MIT `LICENSE`. |
| **Total** | **68** | Every asset-like file tracked in git, outside `node_modules` and the gitignored `dist/` build output. |

## ✅ Approved — public-bundle assets (CI-enforced)

These 23 files are exactly the set `scripts/assets/check-asset-licenses.mjs` enforces.
CI fails if any of them loses its "approved" status, its licence field, or is removed
from the manifest.

| Path | Type | Source | Licence | Attribution required |
|---|---|---|---|---|
| `public/assets/gentle-obj.png` | Tileset image | [16x16 RPG Tileset](https://opengameart.org/content/16x16-rpg-tileset) (hilau, built on [16x16 Game Assets](https://opengameart.org/content/16x16-game-assets) by George Bailey) | CC-BY-SA 3.0 / GPL 3.0 / CC-BY 4.0 | Yes |
| `data/gentle.js` | Tilemap tile-index data | Derived from `gentle-obj.png` | Follows tileset | Yes |
| `public/assets/spritesheets/campfire.png` | FX spritesheet | Same stock map asset set | Follows tileset | Yes |
| `public/assets/spritesheets/gentlesparkle32.png` | FX spritesheet | Same stock map asset set | Follows tileset | Yes |
| `public/assets/spritesheets/gentlewaterfall32.png` | FX spritesheet | Same stock map asset set (also backs `gentlesplash.json`) | Follows tileset | Yes |
| `public/assets/spritesheets/windmill.png` | FX spritesheet | Same stock map asset set | Follows tileset | Yes |
| `data/animations/campfire.json` | Animation frame data | Metadata for `campfire.png` | Follows tileset | Yes |
| `data/animations/gentlesparkle.json` | Animation frame data | Metadata for `gentlesparkle32.png` | Follows tileset | Yes |
| `data/animations/gentlesplash.json` | Animation frame data | Metadata for `gentlewaterfall32.png` | Follows tileset | Yes |
| `data/animations/gentlewaterfall.json` | Animation frame data | Metadata for `gentlewaterfall32.png` | Follows tileset | Yes |
| `data/animations/windmill.json` | Animation frame data | Metadata for `windmill.png` | Follows tileset | Yes |
| `public/assets/fonts/upheaval_pro.ttf` | Font (live via `src/index.css` `@font-face`, class `.font-display`) | [dafont: Upheaval Pro](https://www.dafont.com/upheaval-pro.font), by Aleksandr Savenkov (extends "Upheaval" by Brian Kent) | dafont "100% Free"; free for personal + commercial use, modification and redistribution allowed (corroborated by blogfonts.com / fontget.com) | No (courtesy credit below) |
| `public/assets/fonts/vcr_osd_mono.ttf` | Font (live via `src/index.css` `@font-face`, class `.font-body`) | [dafont: VCR OSD Mono](https://www.dafont.com/vcr-osd-mono.font), by Riciery Leal | dafont "100% Free"; free for personal + commercial use, modification and redistribution allowed (corroborated by blogfonts.com) | No (courtesy credit below) |
| `public/favicon.ico` | Image | a16z-infra/ai-town's own project asset (not third-party asset-pack content) | MIT (`LICENSE`) | Yes (project attribution) |
| `public/assets/32x32folk.png` | Character spritesheet | a16z-infra/ai-town at commit `dca78f5ea` (2023-08-12, PR #54); byte-identical to upstream | MIT (upstream root `LICENSE`), **accepted with residual risk** — see the decision record below | Yes (project attribution) |
| `data/spritesheets/f1.ts`–`f8.ts` (8 files) | Spritesheet frame data | Frame coordinates for `32x32folk.png`, same upstream commit | Follows `32x32folk.png` | Yes (project attribution) |

### Required attribution text

Preserve this block wherever the tileset/FX art or fonts render publicly (this document
is the current attribution surface; if `/live` (FR-O001) ships the PixiJS renderer, carry
this text into that page's credits/footer):

> Map tileset and effects: "16x16 RPG Tileset" by hilau
> (<https://opengameart.org/content/16x16-rpg-tileset>), built on "16x16 Game Assets" by
> George Bailey (<https://opengameart.org/content/16x16-game-assets>) and "LPC
> Thatched-roof Cottage" by bluecarrot16. Licensed CC-BY-SA 3.0 / GPL 3.0 / CC-BY 4.0.
>
> Fonts: "Upheaval Pro" by Aleksandr Savenkov (after "Upheaval" by Brian Kent) and "VCR
> OSD Mono" by Riciery Leal, via dafont.com.
>
> Character sprites (`32x32folk.png` and its frame data) are from
> [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town), used under the MIT Licence,
> Copyright (c) 2023 a16z-infra. MIT requires that this copyright notice and the
> permission notice in [`LICENSE`](./LICENSE) travel with the files.
>
> Built on [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) (MIT Licence).

### Decision record — character art (ART-62 open item #1 → ART-108 → ART-143)

`public/assets/32x32folk.png` and its frame-coordinate data (`data/spritesheets/f1.ts`–
`f8.ts`) are the stock a16z character sprites ART-107 marked "reusable as-is" for the
Visual Runtime (FR-N010). ART-62 attributed them generically to "OpenGameArt"; ART-108
could not confirm that and quarantined them. ART-143 re-opened the question against
primary sources and could not attribute the art either:

| Line of enquiry | Result |
|---|---|
| Upstream commit history for the path | Exactly two commits, both by `61cygni` on 2023-08-12: `a41c22089` "New 32x32 spritesheet" (16:52:25Z) and `dca78f5ea` "New 32x32 characters" (21:40:38Z, PR #54 "Martin character"). The two versions are **entirely different character art** at the same 384×256 layout — upstream swapped the whole cast within five hours. Neither commit message, the PR body, nor its single review comment names a source. |
| Upstream README credits | Upstream names a third-party source for every other art category it uses (two OpenGameArt tilesets, ansimuz, Mounir Tohami's UI pack, MusicGen audio) and **names none for the character spritesheet**. |
| The "Pixel Art Generation: Replicate, Fal.ai" line | Added 48 minutes after the spritesheet landed, by a different author, as a generic bullet in the *Stack* list (PR #50). Never linked to this file. Suggestive of AI generation, not probative. |
| PNG metadata | No author, copyright or generator fields. Only `sRGB`, an `eXIf` orientation tag, `pHYs`, and boilerplate Adobe XMP holding just `tiff:Orientation`. |
| Upstream issue tracker | Issue #202 asked where these textures come from; the maintainer answered with the directory path only, recording no licence or attribution. |
| Asset-pack matching | No visual or catalogue match against candidate 32×32 character packs (Pipoya, OpenGameArt CC0 sets, itch.io and RPG-Maker-style packs). Exact-string web search for `32x32folk` returns nothing. |

Because no further research could settle it, this became an owner-level licence decision
(H06). **Decision (owner, 2026-08-06): accept upstream's root MIT `LICENSE` as the grant
for these nine paths, accepting the residual risk that a16z-infra may not have held every
right it purported to grant.** Re-sourcing was not a cost-free alternative — PRD 2.0 §6
lists adopting an external free asset library or an image-generation model to fill out the
sprite set as an explicit v1 non-goal, so a replacement pack would have needed a PRD
exception. The nine paths are therefore approved and enforced in `PUBLIC_BUNDLE_PATHS`,
which unblocks ART-111 (Character Visual Binding).

This is a recorded risk acceptance, not a provenance finding. If upstream or a third party
later identifies the original artist, revisit these entries.

## 🟡 Restricted

| Path | Reason |
|---|---|
| `public/assets/background.mp3` | **Resolves ART-62 open item #3.** AI-generated via Meta's MusicGen (through Replicate) — per upstream README: "Background Music Generation: Replicate using MusicGen" — not third-party-authored art. Byte-identical to upstream's shipped fallback (commit "Add background music :)", 2023-08-13). Commercial/redistribution terms for MusicGen model output were not independently verified in this audit — a distinct legal question from asset-pack attribution. Not currently reachable from any public route (its only frontend consumer, `MusicButton.tsx`, has zero importers anywhere in `src/`), so this does not block current public pages. Must not enter a public bundle until MusicGen/Replicate output rights are confirmed. |

## ⛔ Quarantined — must not enter the public bundle

### Third-party trademarks (new finding, highest priority)

`assets/a16z.png`, `assets/convex.svg`, `assets/convex-bg.webp` are the Andreessen
Horowitz and Convex Inc. corporate logos, bundled by the upstream template as its own
"built with / powered by" branding. **These are trademarks, not creative-commons assets**
— the project's MIT licence covers a16z-infra's *code*, not the right to display a16z's
or Convex's brand marks in an unrelated derivative product. Currently unreachable (zero
importers for `a16z.png`; `PoweredByConvex.tsx`, the only importer of the other two,
itself has zero importers anywhere in `src/`). Any future re-introduction of "powered by"
branding requires explicit trademark-owner authorisation, not just a copyright licence
check.

### Unverifiable source page (ART-62 open item, carried by ART-108)

`assets/ui/*.svg` (the dialogue/menu chrome: `box`, `bubble-left`, `bubble-right`,
`button`, `button_pressed`, `chats`, `desc`, `frame`, `jewel_box`) were attributed by
ART-62 to Mounir Tohami's itch.io "Pixel Art GUI Elements" pack, carried over from
upstream's README text. This audit attempted to verify that page directly
(`mounirtohami.itch.io/pixel-art-gui-elements`) and it returned **HTTP 404** — the page is
no longer reachable at that URL, so the licence text could not be independently confirmed.
Per this audit's evidentiary bar (do not accept previously-recorded attribution text
without verification), these files are downgraded from ART-62's attributed entry to
quarantined pending re-verification of the source. None of these files are imported
anywhere in `src/` regardless, so this does not affect any current public page.

### Editor-tool-only / unreachable assets (35 files)

Everything under `src/editor/` (the standalone `npm run le` level-editor dev tool, not
part of the built app), plus `public/assets/player.png`, `rpg-tileset.png`,
`magecity.png`, `heart-empty.png`, `tilemap.json`, `data/spritesheets/p1.ts`–`p3.ts`/
`player.ts`, and `assets/background.webp`, `close.svg`, `help.svg`, `interact.svg`,
`star.svg`, `volume.svg`. None of these are imported by any file reachable from the
shipped app (verified by repo-wide grep), and none are part of ART-107's "reusable
renderer" inventory. Full per-file detail, including which ones share a licence with an
approved twin (e.g. `src/editor/tilesets/gentle-obj.png` duplicates the approved
`public/assets/gentle-obj.png`) versus which have no external evidence at all, is in
[`assets/asset-licenses.json`](assets/asset-licenses.json).

## ⚙️ Tooling (not media assets)

`data/convertMap.js` (offline Tiled-export converter) and `data/spritesheets/types.ts` (a
shared TypeScript interface) contain no copyrightable media content; both are covered by
the project's own MIT `LICENSE`.

## How the CI gate works

`npm run check:asset-licenses` (`scripts/assets/check-asset-licenses.mjs`) loads
`assets/asset-licenses.json` and fails if:

1. any asset in the enforced public-bundle list (`PUBLIC_BUNDLE_PATHS` in that script)
   has no manifest record;
2. that record's `status` is not `"approved"`;
3. that record has no `license` recorded, or is missing required attribution detail when
   `attributionRequired` is true;
4. the manifest itself is malformed (missing required fields, an invalid `status` value,
   or a duplicate path);
5. any record is marked `"approved"` while its `source`, `author` or `license` is still a
   placeholder such as `"Unresolved"`, `"Unknown"` or `"TBD"` (added by ART-143). Without
   this rule the gate could be satisfied by flipping `status` alone, which would admit an
   asset of unknown provenance into the public bundle — exactly what FR-N008 acceptance
   condition 3 forbids.

`npm run test:asset-licenses` (`scripts/assets/check-asset-licenses.test.mjs`) proves this
behaviourally, including a negative test that deletes a required public-bundle record and
asserts the check fails, a test pinning the nine character-art paths as approved under a
non-placeholder MIT record and present in `PUBLIC_BUNDLE_PATHS`, and two negative tests
proving a still-quarantined asset cannot reach the public bundle by a status flip or by
being added to `PUBLIC_BUNDLE_PATHS` directly. Both run in CI (`.github/workflows/ci.yml`,
`.github/workflows/bootstrap.yml`) and are part of `npm run check` / `npm run
check:offline`.

## Dependency licenses (carried forward from ART-62; not FR-N008's scope)

Code dependencies remain under their own licenses as declared in `package.json` and
`package-lock.json`. Notable non-MIT entries:

- **`convex`** — Apache-2.0 (not MIT). Apache-2.0 §4(d) carries a NOTICE-propagation
  obligation.
- **`axe-core`** (via `jest-axe`, a devDependency) — MPL-2.0. File-scoped weak copyleft;
  compatible with MIT distribution and not shipped to users.

No GPL, AGPL, or LGPL dependency was found as of ART-62. This scan was performed against
`package-lock.json` only; a full resolution requires `npm ci && npx license-checker
--summary`. Re-verify if dependencies change materially.
