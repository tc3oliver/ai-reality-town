/**
 * Character Visual Binding — the stable, versioned mapping from a Canon
 * `characterId` to the public visual identity used by the read-only renderer
 * (FR-N004, PRD 2.0 §14.1, decision §24.23).
 *
 * Pure module: no Convex imports, no clock, no randomness, no I/O. Every export
 * is deterministic so that a redeploy can never change a character's appearance
 * (AC#2).
 *
 * ## Why palette *ranges* and not a tint
 *
 * Mistwood seeds twelve characters but the inherited art only ships eight
 * character sprites (`f1`–`f8`, all cells of `public/assets/32x32folk.png`), and
 * PRD 2.0 §6 forbids introducing new art in v1. The remaining four characters
 * therefore reuse a base sprite with a **palette variant**.
 *
 * A palette variant is a list of {@link PaletteRecolour} operations, each bound
 * to one **designated** {@link PaletteRange} — an HSV window measured from the
 * real spritesheet. {@link applyPaletteVariant} only rewrites pixels that fall
 * inside a designated window; every other pixel is copied byte for byte. There
 * is deliberately no "tint the whole sprite" field in this model, so the
 * §24.23-forbidden global tint (which would recolour skin, hair and clothing
 * together) is structurally unrepresentable rather than merely discouraged.
 *
 * {@link PROTECTED_SKIN_WINDOW} is the HSV window occupied by skin across all
 * eight sprites. {@link validatePaletteRanges} rejects any designated range that
 * intersects it, and rejects any recolour that would *land* inside it.
 */

// --- sprite catalogue -------------------------------------------------------

export const CHARACTER_VISUAL_BINDING_SCHEMA_VERSION = 1;

/** The eight inherited character sprites (ART-107 inventory, ART-143 licence). */
export const SPRITE_KEYS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'] as const;
export type SpriteKey = (typeof SPRITE_KEYS)[number];

/** Every sprite key indexes into this one 384x256 texture. */
export const CHARACTER_TEXTURE_URL = '/ai-town/assets/32x32folk.png';
export const CHARACTER_TEXTURE_WIDTH = 384;
export const CHARACTER_TEXTURE_HEIGHT = 256;

/** One 32x32 frame; a sprite cell is 3 frames wide and 4 frames tall. */
export const SPRITE_FRAME_SIZE = 32;
export const SPRITE_CELL_WIDTH = 96;
export const SPRITE_CELL_HEIGHT = 128;

/**
 * Top-left corner of each sprite's cell inside the shared texture. Mirrors the
 * frame coordinates already committed in `data/spritesheets/f1.ts`–`f8.ts`;
 * `mistwoodVisualBindings.test.ts` cross-checks the two so they cannot drift.
 */
export const SPRITE_CELL_ORIGINS: Readonly<Record<SpriteKey, { x: number; y: number }>> = {
  f1: { x: 0, y: 0 },
  f2: { x: 96, y: 0 },
  f3: { x: 192, y: 0 },
  f4: { x: 288, y: 0 },
  f5: { x: 0, y: 128 },
  f6: { x: 96, y: 128 },
  f7: { x: 192, y: 128 },
  f8: { x: 288, y: 128 },
};

/** Frame order inside a cell; `portraitFrame` indexes into this list. */
export const SPRITE_FRAME_ORDER = [
  'down', 'down2', 'down3',
  'left', 'left2', 'left3',
  'right', 'right2', 'right3',
  'up', 'up2', 'up3',
] as const;
export type SpriteFrameName = (typeof SPRITE_FRAME_ORDER)[number];

/** Front-facing frame; the default portrait for a character card. */
export const DEFAULT_PORTRAIT_FRAME = 0;

export function isSpriteKey(value: unknown): value is SpriteKey {
  return typeof value === 'string' && (SPRITE_KEYS as readonly string[]).includes(value);
}

// --- palette model ----------------------------------------------------------

/**
 * Which part of the sprite a designated range covers. Several inherited sprites
 * dye hair and garment from one colour family, so `hair-and-clothing` is a real
 * case rather than a fallback.
 */
export type PaletteSlot = 'hair' | 'clothing' | 'hair-and-clothing';

/**
 * An HSV window. `hue` is degrees in `[0, 360]` and wraps when
 * `hueStart > hueEnd`; saturation and value are `[0, 1]`. Bounds are inclusive.
 */
export type HsvWindow = {
  hueStart: number;
  hueEnd: number;
  minSaturation: number;
  maxSaturation: number;
  minValue: number;
  maxValue: number;
};

/** A designated, recolourable region of one sprite's palette. */
export type PaletteRange = {
  id: string;
  spriteKey: SpriteKey;
  slot: PaletteSlot;
  /** Human-readable provenance, including the measurement it came from. */
  description: string;
  window: HsvWindow;
};

/**
 * One recolour operation. The matched pixels are moved onto `targetHue` while
 * keeping their own saturation and value shading, which is what preserves the
 * sprite's form. `minSaturation` lets an achromatic range (white hair) be dyed.
 */
export type PaletteRecolour = {
  rangeId: string;
  /** Absolute target hue in degrees, `[0, 360)`. */
  targetHue: number;
  /** Multiplier on the pixel's saturation, clamped into `[0, 1]`. */
  saturationScale: number;
  /** Saturation floor applied after scaling, `[0, 1]`. */
  minSaturation: number;
  /** Multiplier on the pixel's value, clamped into `[0, 1]`. */
  valueScale: number;
};

export type PaletteVariant = {
  id: string;
  baseSpriteKey: SpriteKey;
  /** Public, zh-TW label for operators and documentation. */
  label: string;
  recolours: readonly PaletteRecolour[];
};

/** Identity variant: the sprite is used exactly as inherited. */
export const BASE_PALETTE_VARIANT = 'base';

/**
 * Skin occupies this window across all eight inherited sprites (measured by
 * per-cell HSV histogram of `public/assets/32x32folk.png`). No designated
 * palette range may intersect it and no recolour may target it, which is how
 * §24.23 ("never tint the whole sprite") is enforced mechanically.
 */
export const PROTECTED_SKIN_WINDOW: HsvWindow = {
  hueStart: 8,
  hueEnd: 38,
  minSaturation: 0.14,
  maxSaturation: 0.7,
  minValue: 0.55,
  maxValue: 1,
};

// --- colour conversion ------------------------------------------------------

export type Hsv = { hue: number; saturation: number; value: number };

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** 8-bit RGB to HSV. Hue is degrees in `[0, 360)`; achromatic pixels get hue 0. */
export function rgbToHsv(red: number, green: number, blue: number): Hsv {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: max === 0 ? 0 : delta / max, value: max };
}

/** HSV back to 8-bit RGB. Inputs are clamped; hue is taken modulo 360. */
export function hsvToRgb(hue: number, saturation: number, value: number): { red: number; green: number; blue: number } {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp01(saturation);
  const v = clamp01(value);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] =
    sector === 0 ? [c, x, 0]
      : sector === 1 ? [x, c, 0]
        : sector === 2 ? [0, c, x]
          : sector === 3 ? [0, x, c]
            : sector === 4 ? [x, 0, c]
              : [c, 0, x];
  return {
    red: Math.round((r + m) * 255),
    green: Math.round((g + m) * 255),
    blue: Math.round((b + m) * 255),
  };
}

function hueInWindow(hue: number, window: HsvWindow): boolean {
  const { hueStart, hueEnd } = window;
  return hueStart <= hueEnd
    ? hue >= hueStart && hue <= hueEnd
    : hue >= hueStart || hue <= hueEnd;
}

/** True when an HSV sample falls inside the window (bounds inclusive). */
export function isInHsvWindow(colour: Hsv, window: HsvWindow): boolean {
  return (
    hueInWindow(colour.hue, window) &&
    colour.saturation >= window.minSaturation &&
    colour.saturation <= window.maxSaturation &&
    colour.value >= window.minValue &&
    colour.value <= window.maxValue
  );
}

function hueSpansOverlap(a: HsvWindow, b: HsvWindow): boolean {
  const spans = (window: HsvWindow): Array<[number, number]> =>
    window.hueStart <= window.hueEnd
      ? [[window.hueStart, window.hueEnd]]
      : [[window.hueStart, 360], [0, window.hueEnd]];
  return spans(a).some(([aStart, aEnd]) =>
    spans(b).some(([bStart, bEnd]) => aStart <= bEnd && bStart <= aEnd));
}

/** True when two HSV windows share at least one colour. */
export function hsvWindowsOverlap(a: HsvWindow, b: HsvWindow): boolean {
  return (
    hueSpansOverlap(a, b) &&
    a.minSaturation <= b.maxSaturation &&
    b.minSaturation <= a.maxSaturation &&
    a.minValue <= b.maxValue &&
    b.minValue <= a.maxValue
  );
}

// --- recolouring ------------------------------------------------------------

export type PaletteApplication = {
  /** New RGBA buffer; the input is never mutated. */
  pixels: Uint8ClampedArray;
  /** Pixels whose RGB bytes changed. */
  recolouredPixels: number;
  /** Pixels left byte-identical (including every fully transparent pixel). */
  untouchedPixels: number;
};

/**
 * Apply a palette variant to an RGBA buffer.
 *
 * Only pixels matching a designated range of the variant's own base sprite are
 * rewritten, and alpha is never modified. Fully transparent pixels are skipped
 * so the sprite's cutout stays byte-identical. The base (identity) variant and
 * a variant with no matching pixels both return an exact copy.
 */
export function applyPaletteVariant(
  pixels: Uint8ClampedArray | Uint8Array,
  variant: PaletteVariant,
  ranges: readonly PaletteRange[],
): PaletteApplication {
  const output = new Uint8ClampedArray(pixels);
  const byId = new Map(ranges.map((range) => [range.id, range]));
  const operations = variant.recolours
    .map((recolour) => ({ recolour, range: byId.get(recolour.rangeId) }))
    .filter((entry): entry is { recolour: PaletteRecolour; range: PaletteRange } =>
      entry.range !== undefined && entry.range.spriteKey === variant.baseSpriteKey);

  let recoloured = 0;
  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] === 0) continue;
    const colour = rgbToHsv(output[offset], output[offset + 1], output[offset + 2]);
    const operation = operations.find(({ range }) => isInHsvWindow(colour, range.window));
    if (!operation) continue;
    const { recolour } = operation;
    const next = hsvToRgb(
      recolour.targetHue,
      Math.max(clamp01(colour.saturation * recolour.saturationScale), recolour.minSaturation),
      colour.value * recolour.valueScale,
    );
    if (next.red === output[offset] && next.green === output[offset + 1] && next.blue === output[offset + 2]) {
      continue;
    }
    output[offset] = next.red;
    output[offset + 1] = next.green;
    output[offset + 2] = next.blue;
    recoloured += 1;
  }
  return {
    pixels: output,
    recolouredPixels: recoloured,
    untouchedPixels: output.length / 4 - recoloured,
  };
}

// --- binding shape ----------------------------------------------------------

export const SUPPORTED_BINDING_LOCALES = ['zh-TW'] as const;
export type BindingLocale = (typeof SUPPORTED_BINDING_LOCALES)[number];

/** Binding record lifecycle; `retired` rows are kept for audit. */
export type VisualBindingStatus = 'active' | 'retired';

/**
 * Public visual state of the character itself (PRD 2.0 FR-N004 AC#7): the
 * renderer switches presentation when a character is deactivated or dies
 * without rewriting the binding's identity fields.
 */
export type PublicVisualVariant = 'default' | 'inactive' | 'memorial';

/**
 * The authored, deterministic part of a binding. Persistence adds `createdAt`
 * and `updatedAt` (see `convex/visual/schema.ts`); those are clock values and
 * therefore deliberately absent from the pure shape.
 */
export type CharacterVisualBindingV1 = {
  schemaVersion: typeof CHARACTER_VISUAL_BINDING_SCHEMA_VERSION;
  id: string;
  worldId: string;
  characterId: string;
  runtimeId: string;
  spriteKey: SpriteKey;
  paletteVariant: string;
  /** Label rendered above the sprite on the map. Always equals `displayName`. */
  nameplate: string;
  portraitFrame: number;
  /** Canonical public name, in `locale`. Never the seed's romanised name. */
  displayName: string;
  locale: BindingLocale;
  publicVariant: PublicVisualVariant;
  status: VisualBindingStatus;
  version: number;
};

/** Stable id of a binding row. */
export function deriveVisualBindingId(worldId: string, characterId: string): string {
  return `${worldId}#visual#${characterId}`;
}

/** Stable runtime handle the renderer addresses a character by. */
export function deriveRuntimeId(worldId: string, characterId: string): string {
  return `${worldId}#runtime#${characterId}`;
}

// --- validation -------------------------------------------------------------

export type VisualBindingErrorCode =
  | 'PALETTE_RANGE_INVALID_WINDOW'
  | 'PALETTE_RANGE_DUPLICATE_ID'
  | 'PALETTE_RANGE_OVERLAPS_PROTECTED_SKIN'
  | 'PALETTE_RANGE_TOO_BROAD'
  | 'PALETTE_VARIANT_DUPLICATE_ID'
  | 'PALETTE_VARIANT_RESERVED_ID'
  | 'PALETTE_VARIANT_HAS_NO_RECOLOUR'
  | 'PALETTE_VARIANT_UNKNOWN_SPRITE_KEY'
  | 'PALETTE_RECOLOUR_UNKNOWN_RANGE'
  | 'PALETTE_RECOLOUR_RANGE_SPRITE_MISMATCH'
  | 'PALETTE_RECOLOUR_TARGETS_PROTECTED_SKIN'
  | 'PALETTE_RECOLOUR_INVALID_SCALE'
  | 'VISUAL_BINDING_UNKNOWN_CHARACTER'
  | 'VISUAL_BINDING_MISSING_CHARACTER'
  | 'VISUAL_BINDING_DUPLICATE_CHARACTER'
  | 'VISUAL_BINDING_UNKNOWN_SPRITE_KEY'
  | 'VISUAL_BINDING_UNKNOWN_PALETTE_VARIANT'
  | 'VISUAL_BINDING_PALETTE_VARIANT_SPRITE_MISMATCH'
  | 'VISUAL_BINDING_DUPLICATE_RUNTIME_ID'
  | 'VISUAL_BINDING_DUPLICATE_DISPLAY_NAME'
  | 'VISUAL_BINDING_NAMEPLATE_MISMATCH'
  | 'VISUAL_BINDING_UNSUPPORTED_LOCALE'
  | 'VISUAL_BINDING_DISPLAY_NAME_NOT_LOCALISED'
  | 'VISUAL_BINDING_INVALID_PORTRAIT_FRAME'
  | 'VISUAL_BINDING_INVALID_VERSION'
  | 'VISUAL_BINDING_INVALID_IDENTIFIER';

export type VisualBindingError = {
  code: VisualBindingErrorCode;
  message: string;
  path: string;
};

const error = (code: VisualBindingErrorCode, message: string, path: string): VisualBindingError =>
  ({ code, message, path });

/**
 * A window this wide in every axis would behave as a whole-sprite tint, which
 * §24.23 forbids. Ranges stay narrow in at least one axis by construction.
 */
const GLOBAL_TINT_HUE_SPAN = 340;
const GLOBAL_TINT_SATURATION_SPAN = 0.95;
const GLOBAL_TINT_VALUE_SPAN = 0.95;

function hueSpan(window: HsvWindow): number {
  return window.hueStart <= window.hueEnd
    ? window.hueEnd - window.hueStart
    : 360 - window.hueStart + window.hueEnd;
}

/** Validate the designated palette ranges themselves. */
export function validatePaletteRanges(ranges: readonly PaletteRange[]): VisualBindingError[] {
  const errors: VisualBindingError[] = [];
  const seen = new Set<string>();
  for (const range of ranges) {
    const path = `paletteRanges.${range.id}`;
    if (seen.has(range.id)) {
      errors.push(error('PALETTE_RANGE_DUPLICATE_ID', `duplicate palette range id ${range.id}`, path));
    }
    seen.add(range.id);
    if (!isSpriteKey(range.spriteKey)) {
      errors.push(error('PALETTE_VARIANT_UNKNOWN_SPRITE_KEY', `unknown sprite key ${String(range.spriteKey)}`, path));
    }
    const { window } = range;
    const bounded = [window.minSaturation, window.maxSaturation, window.minValue, window.maxValue]
      .every((bound) => Number.isFinite(bound) && bound >= 0 && bound <= 1);
    if (
      !bounded ||
      window.minSaturation > window.maxSaturation ||
      window.minValue > window.maxValue ||
      !Number.isFinite(window.hueStart) || window.hueStart < 0 || window.hueStart > 360 ||
      !Number.isFinite(window.hueEnd) || window.hueEnd < 0 || window.hueEnd > 360
    ) {
      errors.push(error('PALETTE_RANGE_INVALID_WINDOW', 'palette range window bounds are out of order or out of range', path));
      continue;
    }
    if (hsvWindowsOverlap(window, PROTECTED_SKIN_WINDOW)) {
      errors.push(error(
        'PALETTE_RANGE_OVERLAPS_PROTECTED_SKIN',
        'palette range intersects the protected skin window; recolouring it would tint skin',
        path,
      ));
    }
    if (
      hueSpan(window) >= GLOBAL_TINT_HUE_SPAN &&
      window.maxSaturation - window.minSaturation >= GLOBAL_TINT_SATURATION_SPAN &&
      window.maxValue - window.minValue >= GLOBAL_TINT_VALUE_SPAN
    ) {
      errors.push(error('PALETTE_RANGE_TOO_BROAD', 'palette range covers the whole colour space and is a disguised global tint', path));
    }
  }
  return errors;
}

/** Validate palette variants against the designated ranges. */
export function validatePaletteVariants(
  variants: readonly PaletteVariant[],
  ranges: readonly PaletteRange[],
): VisualBindingError[] {
  const errors: VisualBindingError[] = [];
  const byId = new Map(ranges.map((range) => [range.id, range]));
  const seen = new Set<string>();
  for (const variant of variants) {
    const path = `paletteVariants.${variant.id}`;
    if (variant.id === BASE_PALETTE_VARIANT) {
      errors.push(error('PALETTE_VARIANT_RESERVED_ID', `${BASE_PALETTE_VARIANT} is the reserved identity variant`, path));
    }
    if (seen.has(variant.id)) {
      errors.push(error('PALETTE_VARIANT_DUPLICATE_ID', `duplicate palette variant id ${variant.id}`, path));
    }
    seen.add(variant.id);
    if (!isSpriteKey(variant.baseSpriteKey)) {
      errors.push(error('PALETTE_VARIANT_UNKNOWN_SPRITE_KEY', `unknown sprite key ${String(variant.baseSpriteKey)}`, path));
    }
    if (variant.recolours.length === 0) {
      errors.push(error('PALETTE_VARIANT_HAS_NO_RECOLOUR', 'a palette variant must recolour at least one designated range', path));
    }
    for (const recolour of variant.recolours) {
      const recolourPath = `${path}.recolours.${recolour.rangeId}`;
      const range = byId.get(recolour.rangeId);
      if (!range) {
        errors.push(error('PALETTE_RECOLOUR_UNKNOWN_RANGE', `unknown palette range ${recolour.rangeId}`, recolourPath));
        continue;
      }
      if (range.spriteKey !== variant.baseSpriteKey) {
        errors.push(error(
          'PALETTE_RECOLOUR_RANGE_SPRITE_MISMATCH',
          `range ${range.id} belongs to ${range.spriteKey} but the variant is based on ${variant.baseSpriteKey}`,
          recolourPath,
        ));
      }
      if (
        !Number.isFinite(recolour.saturationScale) || recolour.saturationScale < 0 ||
        !Number.isFinite(recolour.valueScale) || recolour.valueScale < 0 ||
        !Number.isFinite(recolour.minSaturation) || recolour.minSaturation < 0 || recolour.minSaturation > 1 ||
        !Number.isFinite(recolour.targetHue) || recolour.targetHue < 0 || recolour.targetHue >= 360
      ) {
        errors.push(error('PALETTE_RECOLOUR_INVALID_SCALE', 'recolour hue or scale is out of range', recolourPath));
        continue;
      }
      if (hueInWindow(recolour.targetHue, PROTECTED_SKIN_WINDOW)) {
        errors.push(error(
          'PALETTE_RECOLOUR_TARGETS_PROTECTED_SKIN',
          'recolour would move designated pixels into the protected skin hue window',
          recolourPath,
        ));
      }
    }
  }
  return errors;
}

/** A seed character as far as binding validation is concerned. */
export type BindableCharacter = { id: string; name: string };

/** zh-TW display names must be Han characters, never the romanised seed name. */
const LOCALISED_DISPLAY_NAME = /^[㐀-䶿一-鿿豈-﫿·]{2,8}$/u;

export type ValidateBindingsInput = {
  bindings: readonly CharacterVisualBindingV1[];
  characters: readonly BindableCharacter[];
  ranges: readonly PaletteRange[];
  variants: readonly PaletteVariant[];
  worldId: string;
};

/**
 * Import-time validation for a complete binding set.
 *
 * Rejects unknown character ids and unknown sprite keys (AC#6), enforces the
 * one-public-label rule that keeps map nameplate, character card and Episode
 * surfaces in agreement (AC#9), and enforces that every display name is a
 * localised name distinct from the seed's romanised `name` (AC#8, AC#10).
 */
export function validateCharacterVisualBindings(input: ValidateBindingsInput): VisualBindingError[] {
  const errors: VisualBindingError[] = [
    ...validatePaletteRanges(input.ranges),
    ...validatePaletteVariants(input.variants, input.ranges),
  ];
  const charactersById = new Map(input.characters.map((character) => [character.id, character]));
  const variantsById = new Map(input.variants.map((variant) => [variant.id, variant]));
  const seenCharacters = new Set<string>();
  const seenRuntimeIds = new Set<string>();
  const seenDisplayNames = new Set<string>();

  for (const binding of input.bindings) {
    const path = `bindings.${binding.characterId}`;
    const character = charactersById.get(binding.characterId);
    if (!character) {
      errors.push(error('VISUAL_BINDING_UNKNOWN_CHARACTER', `no seeded character ${binding.characterId}`, path));
    }
    if (seenCharacters.has(binding.characterId)) {
      errors.push(error('VISUAL_BINDING_DUPLICATE_CHARACTER', `duplicate binding for ${binding.characterId}`, path));
    }
    seenCharacters.add(binding.characterId);

    if (
      binding.id !== deriveVisualBindingId(input.worldId, binding.characterId) ||
      binding.runtimeId !== deriveRuntimeId(input.worldId, binding.characterId) ||
      binding.worldId !== input.worldId
    ) {
      errors.push(error('VISUAL_BINDING_INVALID_IDENTIFIER', 'binding id, runtime id and world id must be derived from the world and character', path));
    }
    if (seenRuntimeIds.has(binding.runtimeId)) {
      errors.push(error('VISUAL_BINDING_DUPLICATE_RUNTIME_ID', `duplicate runtime id ${binding.runtimeId}`, path));
    }
    seenRuntimeIds.add(binding.runtimeId);

    if (!isSpriteKey(binding.spriteKey)) {
      errors.push(error('VISUAL_BINDING_UNKNOWN_SPRITE_KEY', `unknown sprite key ${String(binding.spriteKey)}`, path));
    }
    if (binding.paletteVariant !== BASE_PALETTE_VARIANT) {
      const variant = variantsById.get(binding.paletteVariant);
      if (!variant) {
        errors.push(error('VISUAL_BINDING_UNKNOWN_PALETTE_VARIANT', `unknown palette variant ${binding.paletteVariant}`, path));
      } else if (variant.baseSpriteKey !== binding.spriteKey) {
        errors.push(error(
          'VISUAL_BINDING_PALETTE_VARIANT_SPRITE_MISMATCH',
          `variant ${variant.id} is based on ${variant.baseSpriteKey} but the binding uses ${binding.spriteKey}`,
          path,
        ));
      }
    }

    if (!(SUPPORTED_BINDING_LOCALES as readonly string[]).includes(binding.locale)) {
      errors.push(error('VISUAL_BINDING_UNSUPPORTED_LOCALE', `unsupported locale ${binding.locale}`, path));
    }
    if (!LOCALISED_DISPLAY_NAME.test(binding.displayName) || (character && binding.displayName === character.name)) {
      errors.push(error(
        'VISUAL_BINDING_DISPLAY_NAME_NOT_LOCALISED',
        'displayName must be a localised public name distinct from the seed name',
        path,
      ));
    }
    if (seenDisplayNames.has(binding.displayName)) {
      errors.push(error('VISUAL_BINDING_DUPLICATE_DISPLAY_NAME', `duplicate display name ${binding.displayName}`, path));
    }
    seenDisplayNames.add(binding.displayName);
    if (binding.nameplate !== binding.displayName) {
      errors.push(error('VISUAL_BINDING_NAMEPLATE_MISMATCH', 'nameplate must equal displayName so every public surface shows one label', path));
    }

    if (
      !Number.isInteger(binding.portraitFrame) ||
      binding.portraitFrame < 0 ||
      binding.portraitFrame >= SPRITE_FRAME_ORDER.length
    ) {
      errors.push(error('VISUAL_BINDING_INVALID_PORTRAIT_FRAME', `portraitFrame ${binding.portraitFrame} is not a frame index`, path));
    }
    if (!Number.isInteger(binding.version) || binding.version < 1) {
      errors.push(error('VISUAL_BINDING_INVALID_VERSION', 'version must be a positive integer', path));
    }
  }

  for (const character of input.characters) {
    if (!seenCharacters.has(character.id)) {
      errors.push(error('VISUAL_BINDING_MISSING_CHARACTER', `no visual binding for ${character.id}`, `bindings.${character.id}`));
    }
  }
  return errors;
}
