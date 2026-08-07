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
> gate ART-62 did not have. **ART-144 corrects ART-108's reachability analysis** — which
> had two false negatives that let sixteen non-approved files ship — and deletes the files
> it could not clear (see the ART-144 decision record below). The machine-readable register
> is [`assets/asset-licenses.json`](assets/asset-licenses.json); the enforced gate is
> [`scripts/assets/check-asset-licenses.mjs`](scripts/assets/check-asset-licenses.mjs)
> (`npm run check:asset-licenses`, wired into `npm run check` and both CI workflows).

**Scope.** "Public bundle" means reachable from the current or PRD 2.0-planned public
surface. ART-107 (`docs/upstream-visual-capability-audit.md`) established that today's
public pages read text-only projections and render no PixiJS canvas; the tileset/FX/font
assets below are in scope because PRD 2.0 Epic O (`FR-O001`, the planned `/live` animated
map) will restore the renderer ART-107 marked "reusable as-is." That renderer inventory is
the *starting point* of the CI enforcement boundary (`PUBLIC_BUNDLE_PATHS` in the check
script); ART-144 added two further checks that derive the boundary from real evidence
rather than that hand-maintained list (see "How the CI gate works"). The two fonts are
already live today via `src/index.css`'s `@font-face` rules. Every asset-like file in the
repository is still recorded below (53 total) so nothing can enter a public bundle
unnoticed later.

## Summary

| Status | Count | Meaning |
|---|---:|---|
| ✅ Approved | 24 | Reachable from the current/planned public bundle; licence + attribution verified and CI-enforced. |
| 🟡 Restricted | 0 | Verified provenance, but public use not yet cleared. `background.mp3` was the only entry; ART-144 deleted it rather than leave it shipping. |
| ⛔ Quarantined | 27 | Not entered into the public bundle: unresolved provenance, third-party trademark, or editor-tool-only / unreachable from any shipped surface. |
| ⚙️ Tooling | 2 | Not a media asset (code utility / type definitions); covered by the project's own MIT `LICENSE`. |
| **Total** | **53** | Every asset-like file tracked in git, outside `node_modules` and the gitignored `dist/` build output. ART-144 deleted 16 previously-recorded files. |

## ✅ Approved — public-bundle assets (CI-enforced)

These 24 files are exactly the set `scripts/assets/check-asset-licenses.mjs` enforces.
CI fails if any of them loses its "approved" status, its licence field, or is removed
from the manifest.

| Path | Type | Source | Licence | Attribution required |
|---|---|---|---|---|
| `public/assets/gentle-obj.png` | Tileset image | [16x16 RPG Tileset](https://opengameart.org/content/16x16-rpg-tileset) (hilau, built on [16x16 Game Assets](https://opengameart.org/content/16x16-game-assets) by George Bailey) | CC-BY-SA 3.0 / GPL 3.0 / CC-BY 4.0 | Yes |
| `data/gentle.js` | Tilemap tile-index data | Derived from `gentle-obj.png` | Follows tileset | Yes |
| `data/mistwood.ts` | Tilemap tile-index data | Mistwood-specific layout derived from `gentle-obj.png` (FR-N009) | Follows tileset | Yes |
| `public/assets/spritesheets/campfire.png` | FX spritesheet | Same stock map asset set (in the bundle since ART-120 — inn, square and hall hearths) | Follows tileset | Yes |
| `public/assets/spritesheets/gentlesparkle32.png` | FX spritesheet | Same stock map asset set (in the bundle since ART-120 — orchard and Chronicle accents) | Follows tileset | Yes |
| `public/assets/spritesheets/gentlewaterfall32.png` | FX spritesheet | Same stock map asset set (also backs `gentlesplash.json`; `gentlewaterfall.json` itself entered the bundle in ART-120) | Follows tileset | Yes |
| `public/assets/spritesheets/windmill.png` | FX spritesheet | Same stock map asset set | Follows tileset | Yes |
| `data/animations/campfire.json` | Animation frame data | Metadata for `campfire.png`; placed on the map by ART-120 (FR-O012) | Follows tileset | Yes |
| `data/animations/gentlesparkle.json` | Animation frame data | Metadata for `gentlesparkle32.png`; placed on the map by ART-120 (FR-O012) | Follows tileset | Yes |
| `data/animations/gentlesplash.json` | Animation frame data | Metadata for `gentlewaterfall32.png` | Follows tileset | Yes |
| `data/animations/gentlewaterfall.json` | Animation frame data | Metadata for `gentlewaterfall32.png`; placed on the map by ART-120 (FR-O012) | Follows tileset | Yes |
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

No asset currently holds this status.

`public/assets/background.mp3` held it from ART-108 until ART-144. **It resolved ART-62
open item #3:** AI-generated via Meta's MusicGen (through Replicate) — per upstream README,
"Background Music Generation: Replicate using MusicGen" — not third-party-authored art, and
byte-identical to upstream's shipped fallback (commit "Add background music :)",
2023-08-13). Commercial/redistribution terms for MusicGen model output were never
independently verified, a distinct legal question from asset-pack attribution. ART-108
recorded that it "must not enter a public bundle until MusicGen/Replicate output rights are
confirmed" — but because it sat in `public/`, vite was publishing it to `dist/` the whole
time. **ART-144 deleted the file.** Nothing reachable played it: `MusicButton.tsx`, its only
frontend consumer, has zero importers anywhere in `src/`. `convex/music.ts` still names the
path as a string fallback, which is harmless — no reachable route exercises it.

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

### Unverifiable source page — deleted by ART-144 (ART-62 open item, carried by ART-108)

The dialogue/menu chrome `assets/ui/*.svg` (`box`, `bubble-left`, `bubble-right`, `button`,
`button_pressed`, `chats`, `desc`, `frame`, `jewel_box`) and the menu background
`assets/background.webp` were attributed by ART-62 to Mounir Tohami's itch.io "Pixel Art
GUI Elements" pack, carried over from upstream's README text. ART-108 attempted to verify
that page directly (`mounirtohami.itch.io/pixel-art-gui-elements`) and it returned **HTTP
404**; ART-144 re-checked and it still does. Web search surfaces only secondhand,
paraphrased permission claims with no independently-verifiable licence text. That does not
meet this document's evidentiary bar (do not accept previously-recorded attribution text
without verification), so the licence remained unconfirmed.

**ART-144 deleted all ten files**, along with the dead CSS rules in `src/index.css` that
referenced them. See the ART-144 decision record below for why they were shipping despite
ART-108 marking them unreachable.

### Editor-tool-only / unreachable assets (24 files)

Everything under `src/editor/` (the standalone `npm run le` level-editor dev tool, not
part of the built app), plus `data/spritesheets/p1.ts`–`p3.ts`/`player.ts`, and
`assets/close.svg`, `help.svg`, `interact.svg`, `star.svg`, `volume.svg`. None of these are
imported by any file reachable from the shipped app, none is referenced by a CSS `url()`,
and none sits under `public/` — so none reaches `dist/`, and CI now proves the last two of
those three claims rather than asserting them. None is part of ART-107's "reusable
renderer" inventory either. Full per-file detail, including which ones share a licence with
an approved twin (e.g. `src/editor/tilesets/gentle-obj.png` duplicates the approved
`public/assets/gentle-obj.png`) versus which have no external evidence at all, is in
[`assets/asset-licenses.json`](assets/asset-licenses.json).

### Decision record — the FR-N008 reachability gap (ART-108 → ART-144)

ART-108 classified an asset as "unreachable from any shipped surface" by grepping for
JavaScript/TypeScript importers. That test was too narrow in two ways, and `npm run build`
showed sixteen non-approved files reaching `dist/` while the gate reported success:

| False negative | Why the grep missed it | Files affected |
|---|---|---|
| **`public/` passthrough** | Vite copies `public/` into `dist/` verbatim. No import graph is involved at all, so no importer grep — and no allowlist — can describe what actually ships from it. | `public/assets/player.png`, `rpg-tileset.png`, `magecity.png`, `heart-empty.png`, `tilemap.json`, `background.mp3` (6) |
| **CSS `url()` references** | A `url()` in a stylesheet is not a JS/TS import, but vite resolves and emits it just the same. `src/index.css` pulled in all nine `assets/ui/*.svg` files and `assets/background.webp` through `border-image-source` / `background`. | `assets/ui/*.svg` (9, of which `button_pressed.svg` was orphaned even from CSS) and `assets/background.webp` |

The precise correction to ART-108's claim: **bundler reachability and runtime DOM usage are
different properties, and ART-108 conflated them.** The CSS rules referencing
`assets/ui/*.svg` (`.game-background`, `.game-frame`, `.bubble`, `.box`, `.desc`, `.chats`,
`.login-prompt`, `.button`, …) were genuinely dead in the DOM sense — leftovers from the
pre-pivot interactive game UI (ADR-0004), applied by no component reachable from
`src/main.tsx` → `src/App.tsx`. ART-108 was right that nothing *rendered* them. But vite
emits an asset because a stylesheet *references* it, not because a component applies the
class. Dead CSS still ships its art. Closing that gap is exactly what FR-N008 acceptance
condition 3 requires.

**Resolution (ART-144): delete, do not approve.** All sixteen files were removed from the
repository outright, together with the dead CSS rules that referenced them and their
manifest records. None was in use; none had a verifiable licence; no replacement art was
sought, because none is needed. The gate was then rewritten to derive its enforced set from
the real `public/` directory and the real `url()` references in `src/**/*.css`, so this
class of drift fails CI instead of passing it.

**This is not a risk acceptance.** It is the opposite of the `32x32folk.png` H06 decision
above: there, an in-use asset with no verifiable provenance was knowingly kept under an
accepted residual risk, because the product needs character art and PRD 2.0 §6 rules out
re-sourcing. Here, verification failed on assets nothing uses, so the safer default —
removal — was taken and no owner decision was required.

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
   condition 3 forbids;
6. **any file under `public/` lacks an approved record** (added by ART-144). The check
   walks the directory recursively rather than consulting a list, because vite copies
   `public/` into `dist/` verbatim — dropping a file in there ships it, allowlist or not;
7. **any asset referenced by a `url()` in `src/**/*.css` lacks an approved record** (added
   by ART-144). Each reference is resolved against the stylesheet's own directory (or
   against `public/` for root-absolute paths) and checked on disk; `data:` URIs and remote
   URLs are skipped. Vite emits these assets even when the CSS rule is never applied by any
   component.

Rules 6 and 7 need no maintenance: they read the repository, not a constant.
`PUBLIC_BUNDLE_PATHS` is still hand-maintained, but now only carries its own weight for the
`data/*.ts` / `data/*.js` files that ship through the JS bundle.

`npm run test:asset-licenses` (`scripts/assets/check-asset-licenses.test.mjs`) proves this
behaviourally, including a negative test that deletes a required public-bundle record and
asserts the check fails, a test pinning the nine character-art paths as approved under a
non-placeholder MIT record and present in `PUBLIC_BUNDLE_PATHS`, two negative tests proving
a still-quarantined asset cannot reach the public bundle by a status flip or by being added
to `PUBLIC_BUNDLE_PATHS` directly, and (ART-144) fixture-driven negative tests for an
unlisted file under `public/` and for a CSS `url()` pointing at an unapproved asset, plus a
regression test running both new checks against the real `public/` directory and
`src/index.css`. Both commands run in CI (`.github/workflows/ci.yml`,
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
