/**
 * The character sprite catalogue (FR-N004, extended by FR-O002 / ART-119).
 *
 * These constants describe `public/assets/32x32folk.png`: which eight sprites it
 * holds, where each one's cell sits, and which frame order a cell is packed in.
 * They lived in `convex/visual/characterVisualBinding.ts` until ART-119, which
 * moved them here — beside the `f1.ts`–`f8.ts` frame data they describe — so the
 * read-only client can resolve a sprite without importing anything from
 * `convex/`. `convex/visual/characterVisualBinding.ts` re-exports every name
 * below unchanged, so the backend keeps its single import site.
 *
 * `data/` is deliberately outside the module-boundary graph (see
 * `architecture/module-boundaries.json`), which is what makes it usable from
 * both sides. That freedom is policed in the other direction by
 * `data/dataBoundary.test.ts`: nothing here may reach back into `convex/canon`,
 * `convex/visual` or `convex/publicRead`, so a private-data import can never
 * ride this edge into the browser bundle.
 *
 * Pure data. No clock, no randomness, no I/O.
 */

import { data as f1 } from './f1';
import { data as f2 } from './f2';
import { data as f3 } from './f3';
import { data as f4 } from './f4';
import { data as f5 } from './f5';
import { data as f6 } from './f6';
import { data as f7 } from './f7';
import { data as f8 } from './f8';
import type { SpritesheetData } from './types';

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

/**
 * The committed frame data per sprite key.
 *
 * Frame coordinates are absolute in the shared texture (f5's `down` sits at
 * y=128, not y=0), so one sheet definition is valid against the whole 384x256
 * image. FR-O002's palette variants rely on that: a recoloured copy of the
 * *entire* texture keeps every frame rectangle below correct, which is why
 * variants never crop to a cell.
 */
export const spriteSheetData: Readonly<Record<SpriteKey, SpritesheetData>> = {
  f1, f2, f3, f4, f5, f6, f7, f8,
};

/** The four walk cycles every sheet is packed with. There is no idle or gesture frame. */
export const SPRITE_ANIMATION_NAMES = ['down', 'left', 'right', 'up'] as const;
export type SpriteAnimationName = (typeof SPRITE_ANIMATION_NAMES)[number];
