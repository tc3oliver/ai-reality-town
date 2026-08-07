/**
 * The palette-variant recolour engine (FR-N004, relocated by FR-O002 / ART-119).
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
 * eight sprites. `validatePaletteRanges` (still in `convex/visual/`, because it
 * is import-time authoring validation rather than render-time work) rejects any
 * designated range that intersects it, and rejects any recolour that would
 * *land* inside it.
 *
 * ## Why this module moved out of `convex/visual/`
 *
 * ART-119 has to apply a variant in the browser, and `convex/visual/` is not a
 * dependency the read-only client may take: `mistwoodVisualBindings.ts` imports
 * `convex/canon/mistwoodSeed.ts`, which carries `privateProfile`, `privateGoal`,
 * `fear` and `secretContents` for all twelve residents. The engine was
 * *relocated* rather than duplicated: a drift test on an algorithm is only a
 * second implementation of the algorithm, which is not a safe way to hold a
 * skin-protection guarantee. `convex/visual/characterVisualBinding.ts`
 * re-exports every name below, so no existing caller changed.
 *
 * Pure module: no clock, no randomness, no I/O, no DOM.
 */

import type { SpriteKey } from './spritesheets/catalogue';

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

/** True when a hue in degrees falls inside a (possibly wrapping) window. */
export function hueInWindow(hue: number, window: HsvWindow): boolean {
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

/** Hue degrees a window covers, accounting for the wrap at 360. */
export function hueSpan(window: HsvWindow): number {
  return window.hueStart <= window.hueEnd
    ? window.hueEnd - window.hueStart
    : 360 - window.hueStart + window.hueEnd;
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
 *
 * The buffer is whatever the caller hands over. FR-O002 hands over the whole
 * 384x256 texture rather than the variant's 96x128 cell, so the absolute frame
 * coordinates in `f1.ts`–`f8.ts` stay valid against the recoloured copy. A
 * variant's HSV window can then incidentally match pixels in another sprite's
 * cell, which is harmless: a variant texture is only ever drawn with its own
 * base sprite's frames.
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
