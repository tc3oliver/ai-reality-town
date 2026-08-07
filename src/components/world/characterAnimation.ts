/**
 * Animation state to what the viewer actually sees (ART-119 / FR-O002 AC#3/#4/#5).
 *
 * Pure: no Pixi import, no DOM, no clock. The indicator above a character is
 * described here as a list of shapes and drawn by
 * {@link ./CharacterStateIndicator}, which means "speech and thought are
 * distinguishable" is assertable in the plain `unit` Jest project rather than
 * only by looking at a screenshot.
 *
 * ## Why vector shapes and not emoji or sprite frames
 *
 * The inherited version drew `💬` and `💭` as `Text`. Emoji render from whatever
 * font the OS supplies: this repo bundles no emoji font, so the glyph is a
 * colour emoji on macOS, a flat monochrome one on most Linux, and tofu wherever
 * neither exists — the same world state would look like three different things,
 * or like nothing.
 *
 * Sprite frames are not available either: `data/spritesheets/f1.ts`–`f8.ts` each
 * hold exactly four walk cycles of three frames. There is no talk frame, no
 * gesture frame, not even an idle blink, and PRD 2.0 §6 forbids introducing new
 * art. So a drawn overlay is the only option that renders identically everywhere
 * and adds no asset.
 *
 * ## Three of the five states are dormant
 *
 * `convex/visualRuntime/motion.ts` can only produce `idle` and `walking`;
 * `speaking`, `thinking` and `activity` exist in the published union but nothing
 * emits them yet. FR-O004 (ART-123) is the task that will. Building the
 * rendering now, driven by fixtures, follows the precedent
 * `PUBLIC_MOTION_TYPES` already set with `ambient` and `replay`: the contract is
 * widened once, by the task that owns it, rather than redefined later.
 */

import type { PublicAnimationState } from './worldViewModel';

export const INDICATOR_KINDS = ['none', 'speech', 'thought', 'activity'] as const;
export type IndicatorKind = (typeof INDICATOR_KINDS)[number];

/**
 * Which indicator a state shows.
 *
 * A total `Record`, not a `switch` with a default: adding a sixth animation
 * state to the published union then fails to compile here, rather than silently
 * falling through to "no indicator" and shipping an invisible state.
 */
const INDICATOR_BY_STATE: Record<PublicAnimationState, IndicatorKind> = {
  idle: 'none',
  walking: 'none',
  speaking: 'speech',
  thinking: 'thought',
  activity: 'activity',
};

export function indicatorFor(state: PublicAnimationState): IndicatorKind {
  return INDICATOR_BY_STATE[state];
}

/**
 * Frames per tick for the walk cycle.
 *
 * Only `walking` animates: the sheets carry no other cycle, so every other state
 * holds frame 0 of its facing — which is the "clear static standby state" AC#3
 * asks for, and is what a still sprite has always meant in this art style.
 */
export const WALK_ANIMATION_SPEED = 0.12;

/** One drawing instruction. Deliberately not a Pixi type, so this module stays pure. */
export type IndicatorPrimitive =
  | { shape: 'roundedRect'; x: number; y: number; width: number; height: number; radius: number; fill: number; alpha: number }
  | { shape: 'circle'; x: number; y: number; radius: number; fill: number; alpha: number }
  | { shape: 'polygon'; points: readonly number[]; fill: number; alpha: number };

const BUBBLE_FILL = 0xfdfbf4;
const BUBBLE_INK = 0x2f2a26;
const ACTIVITY_FILL = 0xffd45e;

const NO_PRIMITIVES: readonly IndicatorPrimitive[] = [];

/**
 * A speech bubble: a wide rounded rectangle with a tail pointing down-left at
 * the speaker, and three ink dots.
 */
const SPEECH_PRIMITIVES: readonly IndicatorPrimitive[] = [
  { shape: 'roundedRect', x: -11, y: -9, width: 22, height: 14, radius: 5, fill: BUBBLE_FILL, alpha: 0.95 },
  { shape: 'polygon', points: [-5, 4, -1, 4, -6, 10], fill: BUBBLE_FILL, alpha: 0.95 },
  { shape: 'circle', x: -5, y: -2, radius: 1.5, fill: BUBBLE_INK, alpha: 1 },
  { shape: 'circle', x: 0, y: -2, radius: 1.5, fill: BUBBLE_INK, alpha: 1 },
  { shape: 'circle', x: 5, y: -2, radius: 1.5, fill: BUBBLE_INK, alpha: 1 },
];

/**
 * A thought cloud: three overlapping circles with two small trailing ones. Round
 * everywhere the speech bubble is straight, so the two read apart at 32px even
 * in silhouette.
 */
const THOUGHT_PRIMITIVES: readonly IndicatorPrimitive[] = [
  { shape: 'circle', x: -6, y: -3, radius: 5, fill: BUBBLE_FILL, alpha: 0.95 },
  { shape: 'circle', x: 1, y: -6, radius: 6, fill: BUBBLE_FILL, alpha: 0.95 },
  { shape: 'circle', x: 7, y: -2, radius: 4.5, fill: BUBBLE_FILL, alpha: 0.95 },
  { shape: 'circle', x: -7, y: 5, radius: 2.2, fill: BUBBLE_FILL, alpha: 0.9 },
  { shape: 'circle', x: -10, y: 9, radius: 1.4, fill: BUBBLE_FILL, alpha: 0.85 },
];

/**
 * A four-point star for "doing something": all straight edges and sharp points,
 * the opposite silhouette to both bubbles, and a warmer colour so it does not
 * read as another kind of talking.
 */
const ACTIVITY_PRIMITIVES: readonly IndicatorPrimitive[] = [
  {
    shape: 'polygon',
    points: [0, -11, 2.6, -2.6, 11, 0, 2.6, 2.6, 0, 11, -2.6, 2.6, -11, 0, -2.6, -2.6],
    fill: ACTIVITY_FILL,
    alpha: 0.95,
  },
];

const PRIMITIVES_BY_KIND: Record<IndicatorKind, readonly IndicatorPrimitive[]> = {
  none: NO_PRIMITIVES,
  speech: SPEECH_PRIMITIVES,
  thought: THOUGHT_PRIMITIVES,
  activity: ACTIVITY_PRIMITIVES,
};

/** The shapes an indicator is drawn from, back to front. Empty for `none`. */
export function indicatorPrimitives(kind: IndicatorKind): readonly IndicatorPrimitive[] {
  return PRIMITIVES_BY_KIND[kind];
}

/** How far above the sprite's centre an indicator is drawn. */
export const INDICATOR_OFFSET_Y = -24;
