import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import { mistwoodCharacterSeed } from '../canon/mistwoodSeed';
import {
  BASE_PALETTE_VARIANT,
  CHARACTER_TEXTURE_HEIGHT,
  CHARACTER_TEXTURE_WIDTH,
  PROTECTED_SKIN_WINDOW,
  SPRITE_CELL_HEIGHT,
  SPRITE_CELL_ORIGINS,
  SPRITE_CELL_WIDTH,
  SPRITE_KEYS,
  applyPaletteVariant,
  isInHsvWindow,
  rgbToHsv,
  validateCharacterVisualBindings,
  type SpriteKey,
} from './characterVisualBinding';
import {
  MISTWOOD_PALETTE_RANGES,
  MISTWOOD_PALETTE_VARIANTS,
  buildMistwoodCharacterVisualBindings,
} from './mistwoodVisualBindings';

const TEXTURE_PATH = resolve(process.cwd(), 'public/assets/32x32folk.png');

/**
 * Minimal 8-bit RGBA PNG reader.
 *
 * Deliberately dependency-free (`node:zlib` only) so that asserting AC#4
 * against the shipped art does not add a package to the project.
 */
function decodePng(path: string): { width: number; height: number; pixels: Uint8ClampedArray } {
  const file = readFileSync(path);
  let offset = 8;
  let header: { width: number; height: number; depth: number; colourType: number; interlace: number } | null = null;
  const chunks: Buffer[] = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colourType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      chunks.push(Buffer.from(data));
    }
    offset += 12 + length;
  }
  if (!header || header.depth !== 8 || header.colourType !== 6 || header.interlace !== 0) {
    throw new Error('expected a non-interlaced 8-bit RGBA PNG');
  }
  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(chunks));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const pixels = new Uint8ClampedArray(height * stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[cursor + x];
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
      let value: number;
      if (filter === 0) value = rawByte;
      else if (filter === 1) value = rawByte + left;
      else if (filter === 2) value = rawByte + up;
      else if (filter === 3) value = rawByte + ((left + up) >> 1);
      else if (filter === 4) {
        const predictor = left + up - upLeft;
        const dLeft = Math.abs(predictor - left);
        const dUp = Math.abs(predictor - up);
        const dUpLeft = Math.abs(predictor - upLeft);
        value = rawByte + (dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft);
      } else {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
      pixels[y * stride + x] = value & 0xff;
    }
    cursor += stride;
  }
  return { width, height, pixels };
}

const texture = decodePng(TEXTURE_PATH);

/** Copy one sprite's 96x128 cell out of the shared texture as its own RGBA buffer. */
function readSpriteCell(spriteKey: SpriteKey): Uint8ClampedArray {
  const origin = SPRITE_CELL_ORIGINS[spriteKey];
  const cell = new Uint8ClampedArray(SPRITE_CELL_WIDTH * SPRITE_CELL_HEIGHT * 4);
  for (let y = 0; y < SPRITE_CELL_HEIGHT; y += 1) {
    const from = ((origin.y + y) * texture.width + origin.x) * 4;
    cell.set(texture.pixels.subarray(from, from + SPRITE_CELL_WIDTH * 4), y * SPRITE_CELL_WIDTH * 4);
  }
  return cell;
}

const seedCharacters = mistwoodCharacterSeed.characters.map(({ id, name }) => ({ id, name }));

describe('mistwood visual bindings', () => {
  it('binds every seeded character exactly once and passes import validation', () => {
    const bindings = buildMistwoodCharacterVisualBindings();
    expect(bindings).toHaveLength(seedCharacters.length);
    expect(validateCharacterVisualBindings({
      bindings,
      characters: seedCharacters,
      ranges: MISTWOOD_PALETTE_RANGES,
      variants: MISTWOOD_PALETTE_VARIANTS,
      worldId: 'mistwood',
    })).toEqual([]);
  });

  it('is deterministic, so a redeploy cannot change any appearance', () => {
    expect(buildMistwoodCharacterVisualBindings()).toEqual(buildMistwoodCharacterVisualBindings());
  });

  it('uses all eight inherited sprites and adds a variant for the four extra characters', () => {
    const bindings = buildMistwoodCharacterVisualBindings();
    const base = bindings.filter((entry) => entry.paletteVariant === BASE_PALETTE_VARIANT);
    const varied = bindings.filter((entry) => entry.paletteVariant !== BASE_PALETTE_VARIANT);

    expect(new Set(base.map((entry) => entry.spriteKey))).toEqual(new Set(SPRITE_KEYS));
    expect(varied).toHaveLength(4);
    expect(new Set(varied.map((entry) => entry.paletteVariant)))
      .toEqual(new Set(MISTWOOD_PALETTE_VARIANTS.map((variant) => variant.id)));
  });

  it('gives every character a distinct zh-TW display name that is not the seed name', () => {
    const bindings = buildMistwoodCharacterVisualBindings();
    const seedNames = new Set(seedCharacters.map((character) => character.name));
    for (const entry of bindings) {
      expect(entry.locale).toBe('zh-TW');
      expect(entry.nameplate).toBe(entry.displayName);
      expect(seedNames.has(entry.displayName)).toBe(false);
    }
    expect(new Set(bindings.map((entry) => entry.displayName)).size).toBe(bindings.length);
  });

  it('keeps every pair that shares a base sprite in different seeded locations', () => {
    const locations = new Map(mistwoodCharacterSeed.characters.map((character) => [character.id, character.initialLocationId]));
    const bySprite = new Map<string, string[]>();
    for (const entry of buildMistwoodCharacterVisualBindings()) {
      bySprite.set(entry.spriteKey, [...(bySprite.get(entry.spriteKey) ?? []), entry.characterId]);
    }
    for (const characterIds of bySprite.values()) {
      const seats = characterIds.map((id) => locations.get(id));
      expect(new Set(seats).size).toBe(seats.length);
    }
  });
});

describe('palette variants against the shipped spritesheet', () => {
  it('decodes the expected texture geometry', () => {
    expect(texture.width).toBe(CHARACTER_TEXTURE_WIDTH);
    expect(texture.height).toBe(CHARACTER_TEXTURE_HEIGHT);
    // The eight declared cells tile the texture exactly and never overlap.
    const seats = new Set(Object.values(SPRITE_CELL_ORIGINS).map(({ x, y }) => `${x}:${y}`));
    expect(seats.size).toBe(SPRITE_KEYS.length);
    expect(SPRITE_KEYS.length * SPRITE_CELL_WIDTH * SPRITE_CELL_HEIGHT).toBe(texture.width * texture.height);
  });

  it('never designates a palette range that contains a skin pixel', () => {
    for (const range of MISTWOOD_PALETTE_RANGES) {
      const cell = readSpriteCell(range.spriteKey);
      let matched = 0;
      let skinOverlap = 0;
      for (let offset = 0; offset < cell.length; offset += 4) {
        if (cell[offset + 3] < 200) continue;
        const colour = rgbToHsv(cell[offset], cell[offset + 1], cell[offset + 2]);
        if (!isInHsvWindow(colour, range.window)) continue;
        matched += 1;
        if (isInHsvWindow(colour, PROTECTED_SKIN_WINDOW)) skinOverlap += 1;
      }
      expect({ range: range.id, skinOverlap }).toEqual({ range: range.id, skinOverlap: 0 });
      // Each range must actually cover part of its sprite, or the variant would
      // be invisible; and it must stay a region rather than the whole sprite.
      expect(matched).toBeGreaterThan(200);
      expect(matched).toBeLessThan(cell.length / 4 * 0.5);
    }
  });

  it('recolours only designated pixels of the real sprite and leaves skin byte-identical', () => {
    for (const variant of MISTWOOD_PALETTE_VARIANTS) {
      const cell = readSpriteCell(variant.baseSpriteKey);
      const result = applyPaletteVariant(cell, variant, MISTWOOD_PALETTE_RANGES);
      const ranges = MISTWOOD_PALETTE_RANGES.filter((range) => range.spriteKey === variant.baseSpriteKey);

      let changed = 0;
      let skinPixels = 0;
      let changedOutsideDesignatedRange = 0;
      let changedSkinPixels = 0;
      let rewrittenAlpha = 0;
      for (let offset = 0; offset < cell.length; offset += 4) {
        const before = rgbToHsv(cell[offset], cell[offset + 1], cell[offset + 2]);
        const wasDesignated = cell[offset + 3] > 0 && ranges.some((range) => isInHsvWindow(before, range.window));
        const differs =
          result.pixels[offset] !== cell[offset] ||
          result.pixels[offset + 1] !== cell[offset + 1] ||
          result.pixels[offset + 2] !== cell[offset + 2];

        if (differs) {
          changed += 1;
          if (!wasDesignated) changedOutsideDesignatedRange += 1;
        }
        if (cell[offset + 3] >= 200 && isInHsvWindow(before, PROTECTED_SKIN_WINDOW)) {
          skinPixels += 1;
          if (differs) changedSkinPixels += 1;
        }
        if (result.pixels[offset + 3] !== cell[offset + 3]) rewrittenAlpha += 1;
      }

      expect({ variant: variant.id, changedOutsideDesignatedRange, changedSkinPixels, rewrittenAlpha })
        .toEqual({ variant: variant.id, changedOutsideDesignatedRange: 0, changedSkinPixels: 0, rewrittenAlpha: 0 });
      // The sprite really does contain skin, so the assertion above is not vacuous.
      expect(skinPixels).toBeGreaterThan(100);
      expect(changed).toBe(result.recolouredPixels);
      expect(changed).toBeGreaterThan(200);
      // Far short of a whole-sprite tint.
      expect(changed).toBeLessThan(cell.length / 4 * 0.5);
    }
  });

  it('produces a visibly different palette for each variant of a shared base sprite', () => {
    for (const variant of MISTWOOD_PALETTE_VARIANTS) {
      const cell = readSpriteCell(variant.baseSpriteKey);
      const result = applyPaletteVariant(cell, variant, MISTWOOD_PALETTE_RANGES);
      const target = variant.recolours[0].targetHue;
      let recoloured = 0;
      let chromaticPixels = 0;
      let offTargetHues = 0;
      for (let offset = 0; offset < cell.length; offset += 4) {
        const red = result.pixels[offset];
        const green = result.pixels[offset + 1];
        const blue = result.pixels[offset + 2];
        if (red === cell[offset] && green === cell[offset + 1] && blue === cell[offset + 2]) continue;
        recoloured += 1;
        // Deep shadow pixels carry too little chroma for 8-bit RGB to encode a
        // hue precisely, so only judge pixels that can actually express one.
        if (Math.max(red, green, blue) - Math.min(red, green, blue) < 24) continue;
        chromaticPixels += 1;
        if (Math.abs(rgbToHsv(red, green, blue).hue - target) >= 3) offTargetHues += 1;
      }
      expect(recoloured).toBeGreaterThan(0);
      expect({ variant: variant.id, offTargetHues }).toEqual({ variant: variant.id, offTargetHues: 0 });
      expect(chromaticPixels).toBeGreaterThan(recoloured * 0.5);
    }
  });
});
