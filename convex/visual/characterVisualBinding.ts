/**
 * Character Visual Binding — the stable, versioned mapping from a Canon
 * `characterId` to the public visual identity used by the read-only renderer
 * (FR-N004, PRD 2.0 §14.1, decision §24.23).
 *
 * Pure module: no Convex imports, no clock, no randomness, no I/O. Every export
 * is deterministic so that a redeploy can never change a character's appearance
 * (AC#2).
 *
 * ## What this module still owns, and what moved
 *
 * It owns the binding *record*: its shape, its derived identifiers and the
 * import-time validation that rejects a malformed or skin-tinting authoring set.
 *
 * The sprite catalogue and the palette recolour engine moved to
 * `data/spritesheets/catalogue.ts` and `data/spritePalette.ts` in ART-119
 * (FR-O002), because the browser has to apply a palette variant and `convex/
 * visual/` is not a dependency the read-only client may take — this module's
 * sibling `mistwoodVisualBindings.ts` imports `convex/canon/mistwoodSeed.ts`,
 * which carries private character data for all twelve residents. Everything that
 * moved is re-exported below unchanged, so every existing import site here still
 * resolves and the validation rules read exactly as they did before.
 *
 * The palette model in one paragraph, since the validators below enforce it: a
 * palette variant is a list of `PaletteRecolour` operations, each bound to one
 * **designated** `PaletteRange` — an HSV window measured from the real
 * spritesheet — and `applyPaletteVariant` rewrites only pixels inside a
 * designated window. There is no "tint the whole sprite" field, so the
 * §24.23-forbidden global tint is unrepresentable rather than merely
 * discouraged. {@link validatePaletteRanges} additionally rejects any designated
 * range that intersects {@link PROTECTED_SKIN_WINDOW}, and any recolour that
 * would *land* inside it.
 */

import {
  hueInWindow,
  hueSpan,
  hsvWindowsOverlap,
  PROTECTED_SKIN_WINDOW,
  BASE_PALETTE_VARIANT,
  type PaletteRange,
  type PaletteVariant,
} from '../../data/spritePalette';
import { isSpriteKey, SPRITE_FRAME_ORDER, type SpriteKey } from '../../data/spritesheets/catalogue';

export const CHARACTER_VISUAL_BINDING_SCHEMA_VERSION = 1;

// Relocated to `data/` in ART-119 so the client can reach them without importing
// `convex/`; re-exported here so this module stays the single backend import site.
export {
  SPRITE_KEYS,
  CHARACTER_TEXTURE_URL,
  CHARACTER_TEXTURE_WIDTH,
  CHARACTER_TEXTURE_HEIGHT,
  SPRITE_FRAME_SIZE,
  SPRITE_CELL_WIDTH,
  SPRITE_CELL_HEIGHT,
  SPRITE_CELL_ORIGINS,
  SPRITE_FRAME_ORDER,
  DEFAULT_PORTRAIT_FRAME,
  isSpriteKey,
} from '../../data/spritesheets/catalogue';
export type { SpriteKey, SpriteFrameName } from '../../data/spritesheets/catalogue';
export {
  BASE_PALETTE_VARIANT,
  PROTECTED_SKIN_WINDOW,
  rgbToHsv,
  hsvToRgb,
  isInHsvWindow,
  hsvWindowsOverlap,
  applyPaletteVariant,
} from '../../data/spritePalette';
export type {
  PaletteSlot,
  HsvWindow,
  PaletteRange,
  PaletteRecolour,
  PaletteVariant,
  Hsv,
  PaletteApplication,
} from '../../data/spritePalette';

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
