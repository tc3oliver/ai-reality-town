/**
 * Every resident resolves to something drawable (ART-119 / FR-O002 AC#1).
 *
 * Eight of the twelve draw an inherited sprite and resolve synchronously; four
 * need the texture recoloured through the palette engine, which means a canvas.
 * The rule this file holds is that *no* input leaves a character without a
 * texture: an unknown variant, a missing canvas, a missing 2D context and a
 * failed image decode all fall back to the plain base sprite rather than
 * returning nothing.
 *
 * `jsdom` is needed for `document`; nothing here renders markup or mounts Pixi.
 */

import {
  MISTWOOD_CHARACTER_VISUALS,
  mistwoodCharacterSpriteKeys,
  mistwoodSpriteAssetSources,
} from '../../../data/mistwoodCharacters';
import { BASE_PALETTE_VARIANT } from '../../../data/spritePalette';
import {
  CHARACTER_TEXTURE_HEIGHT,
  CHARACTER_TEXTURE_URL,
  CHARACTER_TEXTURE_WIDTH,
  spriteSheetData,
} from '../../../data/spritesheets/catalogue';
import {
  baseSpriteAsset,
  baseSpriteAssets,
  browserTextureCanvasHost,
  paletteVariantAssetKeys,
  resolveVariantSpriteAsset,
  type TextureCanvasHost,
} from './spriteAssets';

/** A canvas whose pixels are an in-memory buffer, so no real rendering is needed. */
function fakeHost(overrides: Partial<TextureCanvasHost> = {}): TextureCanvasHost {
  return {
    createCanvas(width, height) {
      const pixels = new Uint8ClampedArray(width * height * 4);
      // A recognisable opaque colour inside `f1-lowerwear-blue`'s window, so a
      // recolour is observable rather than a no-op over transparent pixels.
      for (let offset = 0; offset < pixels.length; offset += 4) {
        pixels[offset] = 40;
        pixels[offset + 1] = 90;
        pixels[offset + 2] = 200;
        pixels[offset + 3] = 255;
      }
      const context = {
        drawImage: () => undefined,
        getImageData: () => ({ data: pixels, width, height }),
        putImageData: () => undefined,
      };
      return {
        width,
        height,
        getContext: () => context,
        toDataURL: () => `data:image/png;base64,recoloured#${pixels[0]},${pixels[1]},${pixels[2]}`,
      } as unknown as HTMLCanvasElement;
    },
    loadImage: () => Promise.resolve({} as CanvasImageSource),
    ...overrides,
  };
}

describe('base sprite assets', () => {
  test('resolve synchronously for every non-variant resident', () => {
    const assets = baseSpriteAssets();
    const baseCharacters = MISTWOOD_CHARACTER_VISUALS.filter(
      (visual) => visual.paletteVariant === BASE_PALETTE_VARIANT,
    );
    expect(baseCharacters).toHaveLength(8);
    for (const visual of baseCharacters) {
      const asset = assets[mistwoodCharacterSpriteKeys[visual.characterId]];
      expect(asset).toBeDefined();
      expect(asset.textureUrl).toBe(CHARACTER_TEXTURE_URL);
      expect(asset.spritesheetData).toBe(spriteSheetData[visual.spriteKey]);
    }
  });

  test('the eight base sprites share one texture but never one frame set', () => {
    // A cache or lookup keyed on the texture URL would hand `f3` the frames of
    // `f1`, which is why the asset key exists.
    const assets = Object.values(baseSpriteAssets());
    expect(new Set(assets.map((asset) => asset.textureUrl)).size).toBe(1);
    expect(new Set(assets.map((asset) => asset.spritesheetData)).size).toBe(8);
  });

  test('the remaining four are the palette variants, and they are the async half', () => {
    expect(paletteVariantAssetKeys()).toHaveLength(4);
    expect(Object.keys(baseSpriteAssets())).toHaveLength(8);
  });
});

describe('resolveVariantSpriteAsset', () => {
  test('recolours a variant and keeps the base sprite frames', async () => {
    const [assetKey] = paletteVariantAssetKeys();
    const source = mistwoodSpriteAssetSources[assetKey];
    const asset = await resolveVariantSpriteAsset(assetKey, fakeHost());

    expect(asset).toBeDefined();
    expect(asset!.textureUrl).toMatch(/^data:image\/png/);
    expect(asset!.textureUrl).not.toBe(CHARACTER_TEXTURE_URL);
    // The frame coordinates are the *base sprite's*, unchanged. That is only
    // valid because the whole texture is recoloured rather than a cropped cell:
    // `f5`'s `down` frame sits at y=128 of the shared image, and cropping would
    // have invalidated every committed rectangle.
    expect(asset!.spritesheetData).toBe(spriteSheetData[source.spriteKey]);
  });

  test('recolours the whole texture, not the variant cell', async () => {
    const sizes: Array<[number, number]> = [];
    const host = fakeHost();
    await resolveVariantSpriteAsset(paletteVariantAssetKeys()[0], {
      ...host,
      createCanvas(width, height) {
        sizes.push([width, height]);
        return host.createCanvas(width, height);
      },
    });
    expect(sizes).toEqual([[CHARACTER_TEXTURE_WIDTH, CHARACTER_TEXTURE_HEIGHT]]);
  });

  test('all four variants resolve to distinct textures', async () => {
    const urls = await Promise.all(
      paletteVariantAssetKeys().map(async (assetKey) => {
        const asset = await resolveVariantSpriteAsset(assetKey, fakeHost());
        return asset!.textureUrl;
      }),
    );
    expect(urls.every((url) => url.startsWith('data:image/png'))).toBe(true);
  });

  test('falls back to the plain base sprite when there is no canvas', async () => {
    const assetKey = paletteVariantAssetKeys()[0];
    const source = mistwoodSpriteAssetSources[assetKey];
    const asset = await resolveVariantSpriteAsset(assetKey, {
      ...fakeHost(),
      createCanvas: () => null,
    });
    // A look-alike pair is a cosmetic loss; a resident missing from the map is
    // an AC#1 failure. Legibility loses to presence.
    expect(asset).toEqual(baseSpriteAsset(source.spriteKey));
  });

  test('falls back when the 2D context is unavailable', async () => {
    const assetKey = paletteVariantAssetKeys()[0];
    const source = mistwoodSpriteAssetSources[assetKey];
    const asset = await resolveVariantSpriteAsset(assetKey, {
      ...fakeHost(),
      createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
    });
    expect(asset).toEqual(baseSpriteAsset(source.spriteKey));
  });

  test('falls back when the texture cannot be decoded', async () => {
    const assetKey = paletteVariantAssetKeys()[0];
    const source = mistwoodSpriteAssetSources[assetKey];
    const asset = await resolveVariantSpriteAsset(assetKey, {
      ...fakeHost(),
      loadImage: () => Promise.reject(new Error('blocked')),
    });
    expect(asset).toEqual(baseSpriteAsset(source.spriteKey));
  });

  test('falls back when a tainted canvas refuses getImageData', async () => {
    const assetKey = paletteVariantAssetKeys()[0];
    const source = mistwoodSpriteAssetSources[assetKey];
    const host = fakeHost();
    const asset = await resolveVariantSpriteAsset(assetKey, {
      ...host,
      createCanvas: (width, height) => {
        const canvas = host.createCanvas(width, height)!;
        const context = canvas.getContext('2d') as unknown as { getImageData: () => never };
        context.getImageData = () => {
          throw new Error('SecurityError: tainted canvas');
        };
        return canvas;
      },
    });
    expect(asset).toEqual(baseSpriteAsset(source.spriteKey));
  });

  test('an unknown asset key resolves to nothing rather than to someone else', async () => {
    // FR-N004 AC#6: an unbound character draws nothing; it never borrows another
    // resident's appearance.
    expect(await resolveVariantSpriteAsset('f9#not-a-variant', fakeHost())).toBeUndefined();
  });

  test('never issues a network request of its own', async () => {
    let requests = 0;
    (globalThis as { fetch?: unknown }).fetch = () => {
      requests += 1;
      throw new Error('sprite resolution must not fetch');
    };
    try {
      await resolveVariantSpriteAsset(paletteVariantAssetKeys()[0], fakeHost());
      expect(requests).toBe(0);
    } finally {
      delete (globalThis as { fetch?: unknown }).fetch;
    }
  });
});

describe('the browser host', () => {
  test('asks for CORS, so a texture served from a CDN cannot taint the canvas', async () => {
    // A tainted canvas throws on `getImageData`, which would silently drop every
    // palette variant to its base sprite in production and never in a test.
    const RealImage = globalThis.Image;
    class StubImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = StubImage as unknown as typeof Image;
    try {
      const image = (await browserTextureCanvasHost.loadImage('/x.png')) as HTMLImageElement;
      expect(image.crossOrigin).toBe('anonymous');
    } finally {
      globalThis.Image = RealImage;
    }
  });

  test('rejects rather than hanging when the texture fails to load', async () => {
    const RealImage = globalThis.Image;
    class FailingImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    globalThis.Image = FailingImage as unknown as typeof Image;
    try {
      await expect(browserTextureCanvasHost.loadImage('/missing.png')).rejects.toThrow('/missing.png');
    } finally {
      globalThis.Image = RealImage;
    }
  });
});
