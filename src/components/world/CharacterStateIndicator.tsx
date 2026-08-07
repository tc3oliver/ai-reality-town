import { Container, Graphics } from '@pixi/react';
import type * as PIXI from 'pixi.js';

import {
  INDICATOR_KINDS,
  indicatorFor,
  indicatorOffsetY,
  indicatorPrimitives,
  type IndicatorKind,
  type IndicatorPrimitive,
} from './characterAnimation';
import type { PublicAnimationState } from './worldViewModel';

/**
 * The speech / thought / activity marker above a character (ART-119 / FR-O002 AC#5), and the
 * dwell ring beneath one that is drifting inside its zone (ART-120 / FR-O011 AC#6).
 *
 * Draws the shape list {@link ./characterAnimation} decides on, and decides
 * nothing itself — which is why "the three indicators are visually distinct" is
 * a unit test over data rather than a screenshot review.
 *
 * Hook-free and a pure function of its props, the same way `ReadOnlyWorldScene`
 * is, so `characterStateIndicator.dom.test.tsx` can call it and replay its draw
 * callback without mounting a Pixi application.
 *
 * Static by construction: the shapes carry no motion of their own, so there is
 * no Reduced Motion branch to get wrong. Like every other node in this module it
 * is `eventMode="none"` with `interactiveChildren={false}` and takes no `on*`
 * prop, so it cannot become the click target ART-113 removed.
 */
export function CharacterStateIndicator({
  animationState,
  isAmbient = false,
}: {
  animationState: PublicAnimationState;
  /** Whether this frame's position came from in-zone drift (FR-O011). */
  isAmbient?: boolean;
}) {
  const kind = indicatorFor(animationState, isAmbient);
  if (indicatorPrimitives(kind).length === 0) return null;

  return (
    <Container
      name="character-state-indicator"
      y={indicatorOffsetY(kind)}
      eventMode="none"
      interactiveChildren={false}
    >
      <Graphics draw={DRAW_BY_KIND[kind]} eventMode="none" />
    </Container>
  );
}

function drawPrimitive(g: PIXI.Graphics, primitive: IndicatorPrimitive): void {
  g.beginFill(primitive.fill, primitive.alpha);
  switch (primitive.shape) {
    case 'roundedRect':
      g.drawRoundedRect(primitive.x, primitive.y, primitive.width, primitive.height, primitive.radius);
      break;
    case 'circle':
      g.drawCircle(primitive.x, primitive.y, primitive.radius);
      break;
    case 'polygon':
      g.drawPolygon([...primitive.points]);
      break;
  }
  g.endFill();
}

/**
 * One draw callback per indicator kind, built once at module load.
 *
 * Identity matters: `Graphics` re-runs its `draw` prop whenever that prop
 * changes, so a closure built per render would repaint every character on every
 * frame the clock ticks. There are four possible drawings in total, so there are
 * four callbacks in total.
 */
const DRAW_BY_KIND: Record<IndicatorKind, (g: PIXI.Graphics) => void> = Object.fromEntries(
  INDICATOR_KINDS.map((kind) => [
    kind,
    (g: PIXI.Graphics) => {
      g.clear();
      for (const primitive of indicatorPrimitives(kind)) drawPrimitive(g, primitive);
    },
  ]),
) as Record<IndicatorKind, (g: PIXI.Graphics) => void>;
