/**
 * What the state indicator actually draws (ART-119 / FR-O002 AC#3/#5).
 *
 * The component is called and the element tree it returns is inspected, and its
 * `draw` callback is replayed against a recording stub, so the Pixi calls a
 * speech bubble and a thought cloud produce can be compared without a WebGL
 * context. `jsdom` is needed only to import `@pixi/react`.
 */

import type { ReactElement } from 'react';
import type * as PIXI from 'pixi.js';

import { PUBLIC_ANIMATION_STATES } from '../../../convex/publicRead/publicDynamicProjection';
import { CharacterStateIndicator } from './CharacterStateIndicator';
import {
  AMBIENT_INDICATOR_OFFSET_Y,
  INDICATOR_OFFSET_Y,
  indicatorFor,
  indicatorPrimitives,
} from './characterAnimation';
import type { PublicAnimationState } from './worldViewModel';

function render(animationState: PublicAnimationState, isAmbient = false): ReactElement | null {
  return CharacterStateIndicator({ animationState, isAmbient }) as ReactElement | null;
}

/** Every element in the tree, parents before children. */
function elements(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object') return [];
  const element = node as ReactElement;
  if (element.props === undefined) return [];
  return [element, ...elements(element.props.children)];
}

/** Records the Pixi drawing calls a `draw` callback makes. */
function recordDrawing(tree: ReactElement): string[] {
  const calls: string[] = [];
  const graphics = elements(tree).find(
    (element) => typeof (element.props as { draw?: unknown }).draw === 'function',
  );
  expect(graphics).toBeDefined();
  const stub = {
    clear: () => calls.push('clear'),
    beginFill: (fill: number, alpha: number) => calls.push(`beginFill(${fill},${alpha})`),
    endFill: () => calls.push('endFill'),
    drawRoundedRect: (...args: number[]) => calls.push(`roundedRect(${args.join(',')})`),
    drawCircle: (...args: number[]) => calls.push(`circle(${args.join(',')})`),
    drawPolygon: (points: number[]) => calls.push(`polygon(${points.join(',')})`),
  };
  (graphics!.props as { draw: (g: PIXI.Graphics) => void }).draw(stub as unknown as PIXI.Graphics);
  return calls;
}

describe('CharacterStateIndicator', () => {
  test('draws nothing for the two states the runtime produces today (AC#3)', () => {
    // A marker over every stationary resident at once would be noise, and a
    // still sprite is already the "clear static standby state" AC#3 asks for.
    expect(render('idle')).toBeNull();
    expect(render('walking')).toBeNull();
  });

  test.each(['speaking', 'thinking', 'activity'] as const)(
    '%s mounts a named, non-interactive container above the sprite',
    (animationState) => {
      const tree = render(animationState)!;
      expect(tree).not.toBeNull();
      expect(tree.props.name).toBe('character-state-indicator');
      expect(tree.props.y).toBe(INDICATOR_OFFSET_Y);
      expect(tree.props.eventMode).toBe('none');
      expect(tree.props.interactiveChildren).toBe(false);
    },
  );

  test('is total over every published animation state', () => {
    for (const state of PUBLIC_ANIMATION_STATES) {
      const tree = render(state);
      const expectedNull = indicatorPrimitives(indicatorFor(state)).length === 0;
      expect(tree === null).toBe(expectedNull);
    }
  });

  describe('the ambient dwell ring (ART-120 / FR-O011 AC#6)', () => {
    test('marks a drifting character that would otherwise show nothing', () => {
      expect(render('idle')).toBeNull();
      const tree = render('idle', true)!;
      expect(tree).not.toBeNull();
      expect(tree.props.name).toBe('character-state-indicator');
    });

    test('sits at the feet, not overhead where the narrative markers live', () => {
      // RISK2-008: ambient movement must never be mistaken for plot. The three ART-119
      // indicators all float above the head and all mean "something is happening here";
      // a fourth badge in the same place would say the opposite thing in the same voice.
      const ambient = render('idle', true)!;
      expect(ambient.props.y).toBe(AMBIENT_INDICATOR_OFFSET_Y);
      expect(ambient.props.y).toBeGreaterThan(0);
      expect(render('speaking')!.props.y).toBe(INDICATOR_OFFSET_Y);
    });

    test('never displaces a published narrative state', () => {
      // A drifting character that is also speaking is still speaking. The published state
      // wins, so ambient can only ever fill the gap where there was no marker at all.
      for (const state of ['speaking', 'thinking', 'activity'] as const) {
        expect(recordDrawing(render(state, true)!)).toEqual(recordDrawing(render(state)!));
      }
    });

    test('reads differently from all three narrative markers', () => {
      const drawings = (['speaking', 'thinking', 'activity'] as const).map((state) =>
        recordDrawing(render(state)!).join('|'),
      );
      drawings.push(recordDrawing(render('idle', true)!).join('|'));
      expect(new Set(drawings).size).toBe(4);
    });

    test('is drawn faintly, so it reads as ground shadow rather than as a badge', () => {
      const calls = recordDrawing(render('idle', true)!);
      expect(calls[0]).toBe('clear');
      const alphas = calls
        .filter((call) => call.startsWith('beginFill'))
        .map((call) => Number(call.replace(/^beginFill\([^,]+,/, '').replace(')', '')));
      expect(alphas.length).toBeGreaterThan(0);
      for (const alpha of alphas) expect(alpha).toBeLessThan(0.35);
      // Circles only: every other indicator uses at least one straight edge, so the four
      // stay apart in silhouette as well as in position.
      expect(calls.filter((call) => call.startsWith('circle')).length).toBeGreaterThan(0);
      expect(calls.some((call) => call.startsWith('roundedRect') || call.startsWith('polygon'))).toBe(false);
    });
  });

  test('the three indicators produce genuinely different drawings (AC#5)', () => {
    const drawings = (['speaking', 'thinking', 'activity'] as const).map((state) =>
      recordDrawing(render(state)!).join('|'),
    );
    expect(new Set(drawings).size).toBe(3);
  });

  test('a speech bubble and a thought cloud use different primitives, not different colours', () => {
    const speech = recordDrawing(render('speaking')!);
    const thought = recordDrawing(render('thinking')!);

    expect(speech.some((call) => call.startsWith('roundedRect'))).toBe(true);
    expect(speech.some((call) => call.startsWith('polygon'))).toBe(true);
    expect(thought.some((call) => call.startsWith('roundedRect'))).toBe(false);
    expect(thought.some((call) => call.startsWith('polygon'))).toBe(false);
    expect(thought.every((call) => !call.startsWith('roundedRect'))).toBe(true);
  });

  test('every drawing clears first and balances its fills', () => {
    for (const state of ['speaking', 'thinking', 'activity'] as const) {
      const calls = recordDrawing(render(state)!);
      expect(calls[0]).toBe('clear');
      expect(calls.filter((call) => call.startsWith('beginFill'))).toHaveLength(
        calls.filter((call) => call === 'endFill').length,
      );
    }
  });

  test('adds no handler anywhere: the indicator cannot become a click target', () => {
    // ART-113's structural no-interactivity proof is load-bearing for the whole
    // read-only guarantee, and this is the first new node in the character
    // subtree since it was written.
    for (const state of ['speaking', 'thinking', 'activity'] as const) {
      for (const element of elements(render(state)!)) {
        const offenders = Object.keys(element.props as Record<string, unknown>).filter(
          (name) => /^on[A-Z]/.test(name) || /^(pointer|click|tap|mouse)/.test(name),
        );
        expect(offenders).toEqual([]);
      }
    }
  });
});
