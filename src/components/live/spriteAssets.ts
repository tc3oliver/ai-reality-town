/**
 * Resolving an asset key to something the renderer can draw (ART-119 / FR-O002 AC#1).
 *
 * Two kinds of asset key exist (see `data/mistwoodCharacters.ts`):
 *
 * - a **base sprite** (`f1`…`f8`) resolves synchronously — it is the inherited
 *   texture plus the committed frame data, both compile-time constants;
 * - a **palette variant** (`f1#mistwood-jade-lowerwear`) needs the texture
 *   recoloured first, which means decoding an image, so it resolves
 *   asynchronously.
 *
 * ## Why the whole texture is recoloured, not the variant's cell
 *
 * The frame rectangles committed in `data/spritesheets/f1.ts`–`f8.ts` are
 * absolute in the shared 384x256 image (f5's `down` frame sits at y=128). Cutting
 * a 96x128 cell out first would invalidate every one of them and force a second,
 * variant-only set of frame coordinates to be maintained. Recolouring a copy of
 * the whole image keeps the committed coordinates correct unchanged.
 *
 * The cost is that a variant's HSV window can incidentally match pixels in some
 * *other* sprite's cell of the copy. That is harmless: a variant texture is only
 * ever drawn with its own base sprite's frames, so the touched pixels are never
 * sampled. `spriteAssets.dom.test.tsx` pins that reasoning.
 *
 * ## Degradation
 *
 * Where no canvas or no 2D context exists, a variant resolves to the plain base
 * texture. Two characters then look alike, which is a cosmetic loss; failing to
 * resolve would drop a resident off the map entirely, which is an AC#1 failure.
 * Legibility loses to presence.
 */

import type { ISpritesheetData } from 'pixi.js';

import {
  mistwoodSpriteAssetSources,
  paletteVariantById,
  MISTWOOD_PALETTE_RANGES,
} from '../../../data/mistwoodCharacters';
import { applyPaletteVariant, BASE_PALETTE_VARIANT } from '../../../data/spritePalette';
import {
  CHARACTER_TEXTURE_HEIGHT,
  CHARACTER_TEXTURE_URL,
  CHARACTER_TEXTURE_WIDTH,
  spriteSheetData,
  type SpriteKey,
} from '../../../data/spritesheets/catalogue';
import type { ReadOnlySpriteAsset } from '../world/worldViewModel';

/** The inherited texture and the frame data for one base sprite. */
export function baseSpriteAsset(spriteKey: SpriteKey): ReadOnlySpriteAsset {
  return {
    textureUrl: CHARACTER_TEXTURE_URL,
    spritesheetData: spriteSheetData[spriteKey] as ISpritesheetData,
  };
}

/**
 * Every asset key that needs no image work, resolved now.
 *
 * The map is rendered from this the moment it mounts, so eight of the twelve
 * residents are on screen before any decoding has started.
 */
export function baseSpriteAssets(): Record<string, ReadOnlySpriteAsset> {
  const assets: Record<string, ReadOnlySpriteAsset> = {};
  for (const [assetKey, source] of Object.entries(mistwoodSpriteAssetSources)) {
    if (source.paletteVariant !== BASE_PALETTE_VARIANT) continue;
    assets[assetKey] = baseSpriteAsset(source.spriteKey);
  }
  return assets;
}

/** The asset keys that still need a recoloured texture. */
export function paletteVariantAssetKeys(): string[] {
  return Object.entries(mistwoodSpriteAssetSources)
    .filter(([, source]) => source.paletteVariant !== BASE_PALETTE_VARIANT)
    .map(([assetKey]) => assetKey);
}

/** The browser APIs this module needs, injected so the failure modes are testable. */
export interface TextureCanvasHost {
  createCanvas(width: number, height: number): HTMLCanvasElement | null;
  loadImage(url: string): Promise<CanvasImageSource>;
}

export const browserTextureCanvasHost: TextureCanvasHost = {
  createCanvas(width, height) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      // The texture is same-origin, but the canvas is tainted by anything the
      // browser *thinks* is cross-origin, and a tainted canvas throws on
      // `getImageData`. Asking for CORS up front keeps that from happening
      // behind a CDN.
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`could not load ${url}`));
      image.src = url;
    });
  },
};

/**
 * Produce the recoloured texture for one palette-variant asset key.
 *
 * Returns the plain base asset — never `undefined` — when the variant is
 * unknown, when there is no canvas, or when decoding fails, so the caller has no
 * "character with no texture" case to handle.
 */
export async function resolveVariantSpriteAsset(
  assetKey: string,
  host: TextureCanvasHost = browserTextureCanvasHost,
): Promise<ReadOnlySpriteAsset | undefined> {
  const source = mistwoodSpriteAssetSources[assetKey];
  if (source === undefined) return undefined;

  const fallback = baseSpriteAsset(source.spriteKey);
  const variant = paletteVariantById(source.paletteVariant);
  if (variant === undefined) return fallback;

  try {
    const canvas = host.createCanvas(CHARACTER_TEXTURE_WIDTH, CHARACTER_TEXTURE_HEIGHT);
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (canvas === null || context === null || context === undefined) return fallback;

    const image = await host.loadImage(CHARACTER_TEXTURE_URL);
    context.drawImage(image, 0, 0, CHARACTER_TEXTURE_WIDTH, CHARACTER_TEXTURE_HEIGHT);
    const pixels = context.getImageData(0, 0, CHARACTER_TEXTURE_WIDTH, CHARACTER_TEXTURE_HEIGHT);
    const recoloured = applyPaletteVariant(pixels.data, variant, MISTWOOD_PALETTE_RANGES);
    pixels.data.set(recoloured.pixels);
    context.putImageData(pixels, 0, 0);

    return {
      textureUrl: canvas.toDataURL('image/png'),
      spritesheetData: spriteSheetData[source.spriteKey] as ISpritesheetData,
    };
  } catch {
    // A blocked, tainted or unsupported canvas is indistinguishable from an
    // absent one as far as the viewer is concerned: both mean "draw the sprite
    // in its inherited colours".
    return fallback;
  }
}
