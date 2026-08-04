# Third-Party Asset Licenses and Credits

AI Reality Town ships art, audio, and font assets that are **not** covered by the MIT
license in [`LICENSE`](./LICENSE). MIT covers the *code* inherited from
[`a16z-infra/ai-town`](https://github.com/a16z-infra/ai-town). The bundled art and audio
were third-party works in upstream AI Town, and a16z-infra never held copyright in them,
so they could not have been — and were not — MIT-licensed by upstream.

These works are redistributed here under their own terms. Several require attribution as a
**condition** of the license grant, independent of MIT. This file exists to satisfy that
condition.

> **Restored by ART-62 (security and release audit).** The credits below were present in
> upstream AI Town's `README.md` but were dropped from this repository during the
> rebranding commit `7744d88` while the credited files continued to ship. Restoring them
> resolves audit finding C-2.

## Credits retained from upstream AI Town

Reproduced from upstream `README.md` at baseline commit
`7b242334bfbfef02f7718bded120d431e8f307df` (local tag `upstream-baseline-20260802`):

- **Tilesheets**
  - <https://opengameart.org/content/16x16-game-assets> by George Bailey
  - <https://opengameart.org/content/16x16-rpg-tileset> by hilau
- **Original environment art** by
  [ansimuz](https://opengameart.org/content/tiny-rpg-forest)
- **UI art** based on original assets by
  [Mounir Tohami](https://mounirtohami.itch.io/pixel-art-gui-elements)
- **Background music** generated with
  [MusicGen](https://huggingface.co/spaces/facebook/MusicGen) via
  [Replicate](https://replicate.com/)
- **Pixel art generation** via [Replicate](https://replicate.com/) and
  [Fal.ai](https://serverless.fal.ai/lora)
- **Rendering** by [PixiJS](https://pixijs.com/)
- The original proof of concept started from
  [phaser3-simple-rpg](https://github.com/pierpo/phaser3-simple-rpg)

## Files covered

| Path | Kind | Attributed source |
|---|---|---|
| `public/assets/rpg-tileset.png` | tileset | OpenGameArt (hilau / George Bailey) |
| `public/assets/32x32folk.png` | character sprites | OpenGameArt |
| `public/assets/magecity.png` | tileset | OpenGameArt |
| `public/assets/gentle-obj.png` | environment art | ansimuz |
| `public/assets/tilemap.json` | tilemap referencing the above | derived |
| `public/assets/spritesheets/*.png` | animated sprites | ansimuz / OpenGameArt |
| `assets/ui/*.svg` | UI frames, buttons, bubbles | Mounir Tohami |
| `public/assets/background.mp3` | background music | MusicGen via Replicate |
| `public/assets/fonts/upheaval_pro.ttf` | font | see open item below |
| `public/assets/fonts/vcr_osd_mono.ttf` | font | see open item below |
| `data/spritesheets/*.ts`, `data/animations/*.json` | sprite metadata | derived |

## Open items (unresolved — ART-62 findings)

These are recorded rather than asserted, because this project cannot verify them from the
repository alone:

1. **Exact license versions are unconfirmed.** OpenGameArt hosts works under CC0, CC-BY
   3.0/4.0, and CC-BY-SA; itch.io assets carry per-author terms. The requirement to
   attribute is well established, but the precise license version and any
   author-specified credit wording must be confirmed at each source URL before this file
   is treated as complete. If any asset proves to be CC-BY-SA, its share-alike obligation
   needs separate assessment.
2. **Font terms are undocumented.** `upheaval_pro.ttf` and `vcr_osd_mono.ttf` are loaded
   at `src/index.css:6-12`. They are third-party freeware fonts with their own
   redistribution terms; no license file or EULA accompanies them here.
3. **`background.mp3` provenance is unconfirmed.** Upstream credited MusicGen/Replicate
   for background music generation, but nothing in this repository states whether this
   specific binary is that generated output or a third-party track.

## Dependency licenses

Code dependencies remain under their own licenses as declared in `package.json` and
`package-lock.json`. Notable non-MIT entries:

- **`convex`** — Apache-2.0 (not MIT). Apache-2.0 §4(d) carries a NOTICE-propagation
  obligation.
- **`axe-core`** (via `jest-axe`, a devDependency) — MPL-2.0. File-scoped weak copyleft;
  compatible with MIT distribution and not shipped to users.

No GPL, AGPL, or LGPL dependency was found. This scan was performed against
`package-lock.json` only; roughly 88% of lockfile entries do not declare a license field,
so a full resolution requires `npm ci && npx license-checker --summary` in CI.
