import {
  BASE_PALETTE_VARIANT,
  CHARACTER_VISUAL_BINDING_SCHEMA_VERSION,
  PROTECTED_SKIN_WINDOW,
  SPRITE_FRAME_ORDER,
  applyPaletteVariant,
  deriveRuntimeId,
  deriveVisualBindingId,
  hsvToRgb,
  hsvWindowsOverlap,
  isInHsvWindow,
  rgbToHsv,
  validateCharacterVisualBindings,
  validatePaletteRanges,
  validatePaletteVariants,
  type CharacterVisualBindingV1,
  type PaletteRange,
  type PaletteVariant,
} from './characterVisualBinding';

const WORLD_ID = 'testworld';

const RANGE: PaletteRange = {
  id: 'test-coat-blue',
  spriteKey: 'f1',
  slot: 'clothing',
  description: 'test range',
  window: { hueStart: 200, hueEnd: 260, minSaturation: 0.15, maxSaturation: 0.8, minValue: 0.55, maxValue: 1 },
};

const VARIANT: PaletteVariant = {
  id: 'test-jade-coat',
  baseSpriteKey: 'f1',
  label: '測試變體',
  recolours: [{ rangeId: RANGE.id, targetHue: 152, saturationScale: 1, minSaturation: 0.2, valueScale: 0.9 }],
};

function binding(overrides: Partial<CharacterVisualBindingV1> = {}): CharacterVisualBindingV1 {
  const characterId = overrides.characterId ?? 'lin-yingxue';
  return {
    schemaVersion: CHARACTER_VISUAL_BINDING_SCHEMA_VERSION,
    id: deriveVisualBindingId(WORLD_ID, characterId),
    worldId: WORLD_ID,
    characterId,
    runtimeId: deriveRuntimeId(WORLD_ID, characterId),
    spriteKey: 'f1',
    paletteVariant: BASE_PALETTE_VARIANT,
    nameplate: '林映雪',
    portraitFrame: 0,
    displayName: '林映雪',
    locale: 'zh-TW',
    publicVariant: 'default',
    status: 'active',
    version: 1,
    ...overrides,
  };
}

const validate = (bindings: CharacterVisualBindingV1[], characters = [{ id: 'lin-yingxue', name: 'Lin Yingxue' }]) =>
  validateCharacterVisualBindings({ bindings, characters, ranges: [RANGE], variants: [VARIANT], worldId: WORLD_ID })
    .map((issue) => issue.code);

/** Build an RGBA buffer from `[r, g, b, a]` tuples. */
const buffer = (pixels: number[][]) => new Uint8ClampedArray(pixels.flat());

describe('colour conversion', () => {
  it('round-trips every sampled sprite colour through HSV', () => {
    // Real colours read out of public/assets/32x32folk.png: skin, f1 slate,
    // f1 blue lowerwear, f6 rose, f4 white, f5 blonde.
    const samples = [
      [0xf8, 0xd8, 0x88], [0x61, 0x67, 0x60], [0x6f, 0x8e, 0xd8],
      [0xeb, 0x7c, 0x8b], [0xff, 0xff, 0xff], [0xcf, 0x99, 0x52], [0x00, 0x00, 0x00],
    ];
    for (const [red, green, blue] of samples) {
      const hsv = rgbToHsv(red, green, blue);
      expect(hsvToRgb(hsv.hue, hsv.saturation, hsv.value)).toEqual({ red, green, blue });
    }
  });

  it('detects hue windows that wrap past 360', () => {
    const wrapping = { hueStart: 340, hueEnd: 20, minSaturation: 0, maxSaturation: 1, minValue: 0, maxValue: 1 };
    expect(isInHsvWindow({ hue: 350, saturation: 0.5, value: 0.5 }, wrapping)).toBe(true);
    expect(isInHsvWindow({ hue: 10, saturation: 0.5, value: 0.5 }, wrapping)).toBe(true);
    expect(isInHsvWindow({ hue: 180, saturation: 0.5, value: 0.5 }, wrapping)).toBe(false);
  });

  it('reports overlap only when hue, saturation and value all intersect', () => {
    const skinHueButDarker = { ...PROTECTED_SKIN_WINDOW, minValue: 0, maxValue: 0.2 };
    expect(hsvWindowsOverlap(PROTECTED_SKIN_WINDOW, skinHueButDarker)).toBe(false);
    expect(hsvWindowsOverlap(PROTECTED_SKIN_WINDOW, PROTECTED_SKIN_WINDOW)).toBe(true);
  });
});

describe('applyPaletteVariant', () => {
  // Skin, in-range blue coat, transparent padding.
  const skin = [0xf8, 0xd8, 0x88, 255];
  const coat = [0x6f, 0x8e, 0xd8, 255];
  const hidden = [0x6f, 0x8e, 0xd8, 0];

  it('rewrites designated pixels and leaves every other byte identical', () => {
    const input = buffer([skin, coat, hidden]);
    const result = applyPaletteVariant(input, VARIANT, [RANGE]);

    expect(result.recolouredPixels).toBe(1);
    expect(Array.from(result.pixels.slice(0, 4))).toEqual(skin);
    expect(Array.from(result.pixels.slice(8, 12))).toEqual(hidden);
    expect(Array.from(result.pixels.slice(4, 8))).not.toEqual(coat);
    // Alpha is never touched.
    expect(result.pixels[7]).toBe(255);
  });

  it('moves designated pixels onto the target hue while keeping their shading', () => {
    const result = applyPaletteVariant(buffer([coat]), VARIANT, [RANGE]);
    const before = rgbToHsv(coat[0], coat[1], coat[2]);
    const after = rgbToHsv(result.pixels[0], result.pixels[1], result.pixels[2]);

    expect(Math.round(after.hue)).toBe(152);
    expect(after.saturation).toBeCloseTo(before.saturation, 2);
    expect(after.value).toBeCloseTo(before.value * 0.9, 2);
  });

  it('never mutates the input buffer', () => {
    const input = buffer([coat]);
    applyPaletteVariant(input, VARIANT, [RANGE]);
    expect(Array.from(input)).toEqual(coat);
  });

  it('returns an exact copy for a variant with no recolours', () => {
    const input = buffer([skin, coat]);
    const result = applyPaletteVariant(input, { ...VARIANT, recolours: [] }, [RANGE]);
    expect(Array.from(result.pixels)).toEqual(Array.from(input));
    expect(result.recolouredPixels).toBe(0);
  });

  it('ignores recolours whose range belongs to another sprite', () => {
    const foreign: PaletteRange = { ...RANGE, id: 'other-sprite-range', spriteKey: 'f3' };
    const result = applyPaletteVariant(buffer([coat]), { ...VARIANT, recolours: [{ ...VARIANT.recolours[0], rangeId: foreign.id }] }, [foreign]);
    expect(result.recolouredPixels).toBe(0);
  });
});

describe('validatePaletteRanges', () => {
  it('accepts a range disjoint from skin', () => {
    expect(validatePaletteRanges([RANGE])).toEqual([]);
  });

  it('rejects a range that intersects the protected skin window', () => {
    const skinRange: PaletteRange = { ...RANGE, id: 'skin-ish', window: { ...PROTECTED_SKIN_WINDOW } };
    expect(validatePaletteRanges([skinRange]).map((issue) => issue.code))
      .toContain('PALETTE_RANGE_OVERLAPS_PROTECTED_SKIN');
  });

  it('rejects a whole-colour-space range as a disguised global tint', () => {
    const everything: PaletteRange = {
      ...RANGE,
      id: 'everything',
      window: { hueStart: 0, hueEnd: 360, minSaturation: 0, maxSaturation: 1, minValue: 0, maxValue: 1 },
    };
    expect(validatePaletteRanges([everything]).map((issue) => issue.code))
      .toEqual(expect.arrayContaining(['PALETTE_RANGE_TOO_BROAD']));
  });

  it('rejects duplicate ids and inverted bounds', () => {
    const inverted: PaletteRange = { ...RANGE, window: { ...RANGE.window, minValue: 0.9, maxValue: 0.1 } };
    const codes = validatePaletteRanges([RANGE, inverted]).map((issue) => issue.code);
    expect(codes).toContain('PALETTE_RANGE_DUPLICATE_ID');
    expect(codes).toContain('PALETTE_RANGE_INVALID_WINDOW');
  });
});

describe('validatePaletteVariants', () => {
  it('accepts the reference variant', () => {
    expect(validatePaletteVariants([VARIANT], [RANGE])).toEqual([]);
  });

  it('rejects a variant with no recolour, an unknown range, or the reserved id', () => {
    const codes = validatePaletteVariants(
      [
        { ...VARIANT, id: 'empty', recolours: [] },
        { ...VARIANT, id: 'dangling', recolours: [{ ...VARIANT.recolours[0], rangeId: 'nope' }] },
        { ...VARIANT, id: BASE_PALETTE_VARIANT },
      ],
      [RANGE],
    ).map((issue) => issue.code);
    expect(codes).toContain('PALETTE_VARIANT_HAS_NO_RECOLOUR');
    expect(codes).toContain('PALETTE_RECOLOUR_UNKNOWN_RANGE');
    expect(codes).toContain('PALETTE_VARIANT_RESERVED_ID');
  });

  it('rejects a recolour that would land inside the protected skin hue window', () => {
    const skinTinted: PaletteVariant = {
      ...VARIANT,
      recolours: [{ ...VARIANT.recolours[0], targetHue: 20 }],
    };
    expect(validatePaletteVariants([skinTinted], [RANGE]).map((issue) => issue.code))
      .toContain('PALETTE_RECOLOUR_TARGETS_PROTECTED_SKIN');
  });

  it('rejects a recolour bound to a range from a different sprite', () => {
    const foreign: PaletteRange = { ...RANGE, spriteKey: 'f7' };
    expect(validatePaletteVariants([VARIANT], [foreign]).map((issue) => issue.code))
      .toContain('PALETTE_RECOLOUR_RANGE_SPRITE_MISMATCH');
  });
});

describe('validateCharacterVisualBindings', () => {
  it('accepts a well-formed binding', () => {
    expect(validate([binding()])).toEqual([]);
  });

  it('rejects an unknown characterId', () => {
    expect(validate([binding({ characterId: 'not-seeded' })]))
      .toEqual(expect.arrayContaining(['VISUAL_BINDING_UNKNOWN_CHARACTER']));
  });

  it('rejects an unknown spriteKey', () => {
    expect(validate([binding({ spriteKey: 'f99' as never })]))
      .toContain('VISUAL_BINDING_UNKNOWN_SPRITE_KEY');
  });

  it('rejects an unknown palette variant', () => {
    expect(validate([binding({ paletteVariant: 'not-authored' })]))
      .toContain('VISUAL_BINDING_UNKNOWN_PALETTE_VARIANT');
  });

  it('rejects a palette variant built on a different sprite', () => {
    expect(validate([binding({ spriteKey: 'f3', paletteVariant: VARIANT.id })]))
      .toContain('VISUAL_BINDING_PALETTE_VARIANT_SPRITE_MISMATCH');
  });

  it('rejects a nameplate that diverges from the display name', () => {
    expect(validate([binding({ nameplate: '映雪' })]))
      .toContain('VISUAL_BINDING_NAMEPLATE_MISMATCH');
  });

  it('rejects a romanised or non-localised display name', () => {
    expect(validate([binding({ displayName: 'Lin Yingxue', nameplate: 'Lin Yingxue' })]))
      .toContain('VISUAL_BINDING_DISPLAY_NAME_NOT_LOCALISED');
  });

  it('rejects an unsupported locale', () => {
    expect(validate([binding({ locale: 'en-US' as never })]))
      .toContain('VISUAL_BINDING_UNSUPPORTED_LOCALE');
  });

  it('rejects an out-of-range portrait frame and a non-positive version', () => {
    const codes = validate([binding({ portraitFrame: SPRITE_FRAME_ORDER.length, version: 0 })]);
    expect(codes).toContain('VISUAL_BINDING_INVALID_PORTRAIT_FRAME');
    expect(codes).toContain('VISUAL_BINDING_INVALID_VERSION');
  });

  it('rejects a hand-written runtime id that is not derived from the world and character', () => {
    expect(validate([binding({ runtimeId: 'runtime-1' })]))
      .toContain('VISUAL_BINDING_INVALID_IDENTIFIER');
  });

  it('rejects duplicate bindings and duplicate display names', () => {
    const codes = validate([binding(), binding()]);
    expect(codes).toContain('VISUAL_BINDING_DUPLICATE_CHARACTER');
    expect(codes).toContain('VISUAL_BINDING_DUPLICATE_RUNTIME_ID');
    expect(codes).toContain('VISUAL_BINDING_DUPLICATE_DISPLAY_NAME');
  });

  it('rejects a seeded character that has no binding', () => {
    const codes = validate([], [{ id: 'lin-yingxue', name: 'Lin Yingxue' }]);
    expect(codes).toEqual(['VISUAL_BINDING_MISSING_CHARACTER']);
  });
});
