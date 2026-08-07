/**
 * Speaking, thinking and activity are recognisably different (ART-119 / FR-O002 AC#3/#5).
 *
 * "Recognisable" cannot be asserted from a screenshot in CI, but the property
 * underneath it can: the three indicators must be *different shapes*, not one
 * shape in three colours, and every published animation state must map to
 * exactly one of them with nothing falling through.
 */

import { PUBLIC_ANIMATION_STATES } from '../../../convex/publicRead/publicDynamicProjection';
import {
  INDICATOR_KINDS,
  indicatorFor,
  indicatorPrimitives,
  type IndicatorKind,
} from './characterAnimation';

describe('indicatorFor', () => {
  test('is total over every published animation state', () => {
    for (const state of PUBLIC_ANIMATION_STATES) {
      expect(INDICATOR_KINDS).toContain(indicatorFor(state));
    }
  });

  test('shows nothing for the two states the runtime actually produces today', () => {
    // `convex/visualRuntime/motion.ts` can only emit `idle` and `walking`; both
    // are legible from the sprite itself, so an indicator would be noise on
    // every character on the map at once.
    expect(indicatorFor('idle')).toBe('none');
    expect(indicatorFor('walking')).toBe('none');
  });

  test('gives each dormant state its own indicator', () => {
    // Dormant until FR-O004 (ART-123) produces them, which is why these are
    // driven by fixtures rather than by anything the backend emits.
    expect(indicatorFor('speaking')).toBe('speech');
    expect(indicatorFor('thinking')).toBe('thought');
    expect(indicatorFor('activity')).toBe('activity');
  });

  test('the mapping is injective over the states that show something', () => {
    const shown = PUBLIC_ANIMATION_STATES.map(indicatorFor).filter((kind) => kind !== 'none');
    expect(new Set(shown).size).toBe(shown.length);
  });
});

describe('indicatorPrimitives', () => {
  const visible: IndicatorKind[] = ['speech', 'thought', 'activity'];

  test('draws nothing at all for `none`', () => {
    expect(indicatorPrimitives('none')).toEqual([]);
  });

  test.each(visible)('%s is a non-empty shape list', (kind) => {
    expect(indicatorPrimitives(kind).length).toBeGreaterThan(0);
  });

  test('the three visible indicators are pairwise different', () => {
    const serialised = visible.map((kind) => JSON.stringify(indicatorPrimitives(kind)));
    expect(new Set(serialised).size).toBe(visible.length);
  });

  test('they differ in silhouette, not only in colour', () => {
    // A viewer glancing at a 32px sprite reads the outline before the hue, and a
    // colour-blind viewer may not read the hue at all. So the shape vocabularies
    // must not coincide.
    const shapes = (kind: IndicatorKind) =>
      [...new Set(indicatorPrimitives(kind).map((primitive) => primitive.shape))].sort();

    expect(shapes('speech')).toEqual(['circle', 'polygon', 'roundedRect']);
    expect(shapes('thought')).toEqual(['circle']);
    expect(shapes('activity')).toEqual(['polygon']);
  });

  test('every primitive is drawable: finite geometry, alpha in range', () => {
    for (const kind of INDICATOR_KINDS) {
      for (const primitive of indicatorPrimitives(kind)) {
        expect(primitive.alpha).toBeGreaterThan(0);
        expect(primitive.alpha).toBeLessThanOrEqual(1);
        expect(Number.isInteger(primitive.fill)).toBe(true);
        const numbers =
          primitive.shape === 'polygon'
            ? primitive.points
            : primitive.shape === 'circle'
              ? [primitive.x, primitive.y, primitive.radius]
              : [primitive.x, primitive.y, primitive.width, primitive.height, primitive.radius];
        expect(numbers.every((value) => Number.isFinite(value))).toBe(true);
      }
    }
  });

  test('a polygon has at least three points', () => {
    for (const kind of INDICATOR_KINDS) {
      for (const primitive of indicatorPrimitives(kind)) {
        if (primitive.shape !== 'polygon') continue;
        expect(primitive.points.length % 2).toBe(0);
        expect(primitive.points.length / 2).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test('returns the same frozen list every call, so a redraw allocates nothing', () => {
    expect(indicatorPrimitives('speech')).toBe(indicatorPrimitives('speech'));
  });
});
