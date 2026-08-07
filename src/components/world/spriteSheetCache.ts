import { BaseTexture, SCALE_MODES, Spritesheet, type ISpritesheetData } from 'pixi.js';

/**
 * One parsed spritesheet per asset key, shared by every character drawing with
 * it (ART-119 / FR-O002 AC#1).
 *
 * `Character.tsx` used to build a `Spritesheet` in its own effect, so mounting
 * twelve residents meant twelve `BaseTexture.from` calls and twelve `parse()`
 * runs over the same 384x256 image — and each remount started again. Eight of
 * the twelve share a texture outright, so the work was almost entirely
 * duplicated.
 *
 * The cache is keyed on the *asset key*, not the texture URL: all eight base
 * sprites are cut from one URL and differ only in their frame data, so a URL key
 * would hand `f3` the frames of `f1`.
 *
 * The stored value is the in-flight promise rather than the parsed sheet, so N
 * simultaneous mounts share one parse instead of racing to start N. A failed
 * parse is evicted, so a transient texture error does not permanently blank a
 * character.
 */
const parsedSheets = new Map<string, Promise<Spritesheet>>();

export function loadSpriteSheet(
  assetKey: string,
  textureUrl: string,
  spritesheetData: ISpritesheetData,
): Promise<Spritesheet> {
  const cached = parsedSheets.get(assetKey);
  if (cached !== undefined) return cached;

  const parsing = (async () => {
    // NEAREST, not the Pixi default: bilinear filtering turns 32px pixel art
    // into mush at any zoom the camera can reach.
    const sheet = new Spritesheet(
      BaseTexture.from(textureUrl, { scaleMode: SCALE_MODES.NEAREST }),
      spritesheetData,
    );
    await sheet.parse();
    return sheet;
  })();

  parsing.catch(() => parsedSheets.delete(assetKey));
  parsedSheets.set(assetKey, parsing);
  return parsing;
}

/** Drop every parsed sheet. Exists so a test can start from a known cache state. */
export function clearSpriteSheetCache(): void {
  parsedSheets.clear();
}
