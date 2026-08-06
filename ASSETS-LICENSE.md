# Third-Party Asset Licenses and Credits

AI Reality Town ships art, audio, and font assets that are **not** covered by the MIT
license in [`LICENSE`](./LICENSE). MIT covers the *code* inherited from
[`a16z-infra/ai-town`](https://github.com/a16z-infra/ai-town). The bundled art and audio
were third-party works in upstream AI Town, and a16z-infra never held copyright in them,
so they could not have been — and were not — MIT-licensed by upstream.

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
| ✅ Approved | 15 | Reachable from the current/planned public bundle; licence + attribution verified and CI-enforced. |
| 🟡 Restricted | 1 | Verified provenance, but public use is not yet cleared (`background.mp3`). |
| ⛔ Quarantined | 51 | Not entered into the public bundle: unresolved provenance, third-party trademark, or editor-tool-only / unreachable from any shipped surface. |
| ⚙️ Tooling | 2 | Not a media asset (code utility / type definitions); covered by the project's own MIT `LICENSE`. |
| **Total** | **69** | Every asset-like file tracked in git, outside `node_modules` and the gitignored `dist/` build output. |

## ✅ Approved — public-bundle assets (CI-enforced)

These 15 files are exactly the set `scripts/assets/check-asset-licenses.mjs` enforces.
CI fails if any of them loses its "approved" status, its licence field, or is removed
from the manifest.

| Path | Type | Source | Licence | Attribution required |
|---|---|---|---|---|
| `public/assets/gentle-obj.png` | Tileset image | [16x16 RPG Tileset](https://opengameart.org/content/16x16-rpg-tileset) (hilau, built on [16x16 Game Assets](https://opengameart.org/content/16x16-game-assets) by George Bailey) | CC-BY-SA 3.0 / GPL 3.0 / CC-BY 4.0 | Yes |
| `data/gentle.js` | Tilemap tile-index data | Derived from `gentle-obj.png` | Follows tileset | Yes |
| `data/mistwood.ts` | Tilemap tile-index data | Mistwood-specific layout derived from `gentle-obj.png` (FR-N009) | Follows tileset | Yes |
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
> Built on [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) (MIT Licence).

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

### Unresolved-provenance character art (resolves ART-62 open item #1, narrower than previously recorded)

`public/assets/32x32folk.png` and its frame-coordinate data (`data/spritesheets/f1.ts`–
`f8.ts`) are the stock a16z character sprite ART-107 marked "reusable as-is" for a future
Visual Runtime (FR-N010). ART-62's table optimistically attributed this file to "OpenGameArt"
generically; this audit could not confirm that — upstream's README credits three named
OpenGameArt sources collectively for its tileset art but does not attribute this specific
character texture to any of them, and its separate "Pixel Art Generation: Replicate,
Fal.ai" credit line is not conclusively linked to this file either. Downgraded from
ART-62's unverified attribution to quarantined pending a definitive source or a rebuilt
character-art path.

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
   or a duplicate path).

`npm run test:asset-licenses` (`scripts/assets/check-asset-licenses.test.mjs`) proves this
behaviourally, including a negative test that deletes a required public-bundle record and
asserts the check fails. Both run in CI (`.github/workflows/ci.yml`,
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
