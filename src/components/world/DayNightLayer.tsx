import { Graphics } from '@pixi/react';
import type * as PIXI from 'pixi.js';

import { dayNightTintFor } from './dayNightTint';

/**
 * The full-map day/night wash (ART-120 / FR-O012).
 *
 * Draws what {@link ./dayNightTint} decides and decides nothing itself, the same split
 * {@link ./CharacterStateIndicator} has with {@link ./characterAnimation} — so "evening looks
 * different from noon" is a unit test over data rather than a screenshot review.
 *
 * Hook-free and a pure function of its props. `eventMode="none"` like every other node in this
 * module: a rectangle covering the entire map would otherwise swallow every pointer event on
 * the canvas, which would be a novel way to break the viewport's pan and zoom.
 */
export function DayNightLayer({
  timeSlot,
  worldWidth,
  worldHeight,
}: {
  /** The Canon slot of the last accepted event; `undefined` for a world with no history. */
  timeSlot: string | undefined;
  worldWidth: number;
  worldHeight: number;
}) {
  const tint = dayNightTintFor(timeSlot);
  if (tint.alpha <= 0) return null;

  return (
    <Graphics
      name="day-night-layer"
      eventMode="none"
      draw={(g: PIXI.Graphics) => {
        g.clear();
        g.beginFill(tint.colour, tint.alpha);
        g.drawRect(0, 0, worldWidth, worldHeight);
        g.endFill();
      }}
    />
  );
}
